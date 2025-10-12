// server.js - patched full server file
// Replaces your existing server.js. Includes:
// - flag persistence fixes (avoidNextResonance / skipNextDamage / reflectNext consumed only when used)
// - safe server-side target validation
// - disconnected players return hand to discard to avoid card loss
// - reconnect by name handling
// - max players per room (4), min players (2) noted for start logic
// - max hand size (6) enforced on draws and initial deal
// - READY / COUNTDOWN (10s) / RANDOM STARTER system added
//   emits: readyState, countdownStarted, countdownCancelled, diceRolling, diceResults, gameStarted

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { cards } = require('./cards'); // your patched cards module
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = {};

// Health check route (used by keep-alive)
app.get('/health', (req, res) => res.status(200).send('OK'));

// Keep-alive ping (optional)
const PORT = process.env.PORT || 3001;
setInterval(() => {
  fetch(`http://localhost:${PORT}/health`).catch(() => {});
}, 5 * 60 * 1000);

// --- Config ---
const DRAW_COST = 1;       // resonance cost to draw
const MAX_PLAYERS = 4;     // maximum players per room
const MIN_PLAYERS = 2;     // minimum players (for starting logic)
const MAX_HAND_SIZE = 6;   // max cards allowed in hand
const COUNTDOWN_MS = 10000; // 10 second countdown for ready/start

// --- Utilities ---
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const generateDeck = () => shuffle([...cards]);

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

// Draw helper that respects MAX_HAND_SIZE and reshuffles discard if needed
function drawCard(room, playerId, roomCode) {
  const player = room.players[playerId];
  if (!player) return null;

  // Respect max hand size
  if (!Array.isArray(player.hand)) player.hand = [];
  if (player.hand.length >= MAX_HAND_SIZE) return null;

  if (!room.deck || room.deck.length === 0) {
    if (!room.discard || room.discard.length === 0) return null;
    room.deck = shuffle([...room.discard]);
    room.discard = [];
    if (roomCode) io.to(roomCode).emit('deckShuffled');
    if (roomCode) io.to(roomCode).emit('info', 'Deck reshuffled!');
  }

  const card = room.deck.pop();
  if (card) {
    player.hand.push(card);
    // notify player-specific draw event
    io.to(playerId).emit('cardDrawn', { playerId });
    return card;
  }
  return null;
}

// --- Helpers for applying effects ---

function applyStability(target, amount, room, sourceName = '') {
  if (!target || !target.alive) return;

  // Phase Cloak: ignore all damage
  if (target.phaseCloak) {
    io.to(getRoomCodeByPlayer(room, target.id)).emit('info', `${target.name} is cloaked and ignores the damage.`);
    target.phaseCloak = false;
    return;
  }

  // Reversal: convert next damage into resonance
  if (target.reversalNext && amount < 0) {
    target.reversalNext = false;
    target.resonance = clamp(target.resonance + 2, 0, 999);
    io.to(getRoomCodeByPlayer(room, target.id)).emit('info', `${target.name}'s Reversal turns damage into +2 Resonance!`);
    return;
  }

  // Shield: blocks this damage instance
  if (target.skipNextDamage && amount < 0) {
    target.skipNextDamage = false;
    io.to(getRoomCodeByPlayer(room, target.id)).emit('info', `${target.name}'s shield blocked the hit!`);
    return;
  }

  target.stability = clamp(target.stability + amount, 0, 999);
  if (amount < 0)
    io.to(getRoomCodeByPlayer(room, target.id)).emit('info', `${target.name} takes ${Math.abs(amount)} damage${sourceName ? ' from ' + sourceName : ''}.`);
  // emit playerDamaged so clients can play SFX
  if (amount < 0) io.to(target.id).emit('playerDamaged', { targetId: target.id, amount: Math.abs(amount) });
}

function applyResonance(target, amount, room, sourceName = '') {
  if (!target || !target.alive) return;

  // Avoid next resonance loss
  if (target.avoidNextResonance && amount < 0) {
    target.avoidNextResonance = false;
    io.to(getRoomCodeByPlayer(room, target.id)).emit('info', `${target.name} avoids resonance loss.`);
    return;
  }

  // Reflect resonance effect
  if (target.reflectResonanceNext && amount < 0) {
    target.reflectResonanceNext = false;
    io.to(getRoomCodeByPlayer(room, target.id)).emit('info', `${target.name} reflects the resonance drain!`);
    // send reversed effect to all enemies (simplified)
    Object.values(room.players).forEach(p => {
      if (p.id !== target.id && p.alive) {
        p.resonance = clamp(p.resonance - Math.abs(amount), 0, 999);
      }
    });
    return;
  }

  // Anchored: cannot drop below 1
  if (target.anchored && target.resonance + amount <= 0) {
    target.resonance = 1;
    io.to(getRoomCodeByPlayer(room, target.id)).emit('info', `${target.name}'s resonance cannot fall below 1 due to Anchored.`);
    return;
  }

  // Pulse Conduit: extra gain
  if (target.pulseConduit && amount > 0) {
    amount += 1;
  }

  target.resonance = clamp(target.resonance + amount, 0, 999);
  if (amount > 0)
    io.to(getRoomCodeByPlayer(room, target.id)).emit('info', `${target.name} gains ${amount} resonance${sourceName ? ' from ' + sourceName : ''}.`);
  else if (amount < 0)
    io.to(getRoomCodeByPlayer(room, target.id)).emit('info', `${target.name} loses ${Math.abs(amount)} resonance${sourceName ? ' from ' + sourceName : ''}.`);

  // emit resonanceGained or resonanceLost
  if (amount > 0) io.to(target.id).emit('resonanceGained', { targetId: target.id, amount });
  if (amount < 0) io.to(target.id).emit('resonanceLost', { targetId: target.id, amount: Math.abs(amount) });
}

function getRoomCodeByPlayer(room, playerId) {
  for (const [code, r] of Object.entries(rooms)) {
    if (r === room) return code;
  }
  return null;
}

// --- Room list helper
const getRoomList = () =>
  Object.keys(rooms).map(code => ({
    code,
    playerCount: Object.keys(rooms[code].players).length
  }));

// --- Update room: emit per-player view
function updateRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const turnId = room.order && room.order.length ? room.order[room.turnIndex] : null;

  for (const id in room.players) {
    const player = room.players[id];
    if (!player) continue;

    const others = {};
    for (const pid in room.players) {
      if (pid !== id) {
        const p = room.players[pid];
        others[pid] = {
          name: p.name,
          handCount: (p.hand || []).length,
          resonance: p.resonance,
          stability: p.stability,
          alive: p.alive,
          drinkCount: p.drinkCount || 0,
        };
      }
    }

    io.to(id).emit('update', {
      yourData: {
        id: player.id,
        name: player.name,
        hand: player.hand || [],
        resonance: player.resonance,
        stability: player.stability,
        potionUsed: player.potionUsed,
        potionCharges: player.potionCharges,
        locked: player.locked,
        shield: player.shield,
        reflectNext: player.reflectNext,
        skipNextDamage: player.skipNextDamage,
        avoidNextResonance: player.avoidNextResonance,
        preventOverload: player.preventOverload,
        nextDiscard: player.nextDiscard,
        alive: player.alive,
        disconnected: player.disconnected || false,
        drinkCount: player.drinkCount || 0,
      },
      table: room.table || [],
      otherPlayers: others,
      turnId,
      deckSize: room.deck ? room.deck.length : 0,
      ready: room.ready || {}
    });
  }
}

// --- Advance turn (patched)
function advanceTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const currentIndex = room.turnIndex;
  const currentPlayerId = room.order[currentIndex];
  const current = room.players[currentPlayerId];

  // Reset only flags that explicitly expire at end of this player's own turn.
  // DO NOT reset flags that should persist until consumed:
  // - skipNextDamage and avoidNextResonance should be consumed by applyStability/applyResonance
  // - reflectNext is consumed when a card is reflected (handled in playCard)
  if (current) {
    current.locked = false;
    current.shield = false;
    current.preventOverload = false;
  //   current.potionUsed = current.potionUsed || false;
    // intentionally do NOT reset:
    // current.skipNextDamage = false;
    // current.avoidNextResonance = false;
    // current.reflectNext = false;
  }

  // Advance to next alive player; skip players not alive or disconnected
  if (!room.order || room.order.length === 0) return;
  let attempts = 0;
  while (true) {
    room.turnIndex = (room.turnIndex + 1) % room.order.length;
    attempts++;
    if (attempts > room.order.length + 5) break;

    const candidateId = room.order[room.turnIndex];
    const candidate = room.players[candidateId];

    if (!candidate || !candidate.alive || candidate.disconnected) continue;

    // If candidate flagged to skip turn, consume flag and continue
    if (candidate.skipTurn) {
      candidate.skipTurn = false;
      io.to(roomCode).emit('info', `${candidate.name} skips their turn due to Timeline Lock.`);
      continue;
    }
    // found valid candidate
    break;
  }

  const nextId = room.order[room.turnIndex];
  const next = room.players[nextId];

  // set potion usage & ensure charges
  if (next) {
    next.potionUsed = false;
    next.potionCharges = Math.max(next.potionCharges || 0, 1);
  }

  // Apply any pending nextDiscard effect to the next player (trigger at start of their turn)
  if (next && next.nextDiscard > 0 && next.hand && next.hand.length > 0) {
    // discard one random or last card
    next.hand.pop();
    next.nextDiscard = 0;
    io.to(roomCode).emit('info', `${next.name} discards a card due to an Echo Trap!`);
  }

  // Draw 1 card at start of turn (respecting MAX_HAND_SIZE)
  if (next && next.alive && !next.disconnected) {
    drawCard(room, nextId, roomCode);
  }

  // Clear Silence Field when the silencer's turn comes back around
  if (room.silencedBy === nextId) {
    room.silencedBy = null;
    io.to(roomCode).emit('info', `Silence Field fades — players can act again.`);
  }

  // Handle end-of-turn effects (current player)
  if (current) {
    // Shard Totem: +1 stability at end of turn
    if (current.shardTotem) {
      current.stability = clamp(current.stability + 1, 0, 999);
      io.to(roomCode).emit('info', `${current.name}'s Shard Totem restores 1 stability.`);
    }

    // Echo Catalyst: no persistent effect, handled on play
    // Extra Turn: if flagged, don't rotate turn order
    if (current.extraTurn) {
      current.extraTurn = false;
      io.to(roomCode).emit('info', `${current.name} gains an extra turn!`);
      // return early so turn doesn’t advance
      updateRoom(roomCode);
      return;
    }

    // Reset short-term flags
    current.phaseCloak = false;
    current.reversalNext = false;
    current.reflectResonanceNext = false;
  }

  io.to(roomCode).emit('turnChanged', {
    currentTurnIndex: room.turnIndex,
    currentPlayerId: nextId
  });

  updateRoom(roomCode);
}

// --- START: READY / COUNTDOWN / RANDOM STARTER SYSTEM ---
// Adds per-room ready map, countdown handles, and startMatch to pick a random ready player.

function broadcastReadyState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit('readyState', { ready: room.ready || {} });
}

function cancelCountdown(roomCode, reason) {
  const room = rooms[roomCode];
  if (!room) return;
  if (room._startCountdownHandle) {
    clearTimeout(room._startCountdownHandle);
    room._startCountdownHandle = null;
    room.countdownEndsAt = null;
    room.waitingForStart = false;
    io.to(roomCode).emit('countdownCancelled', { reason });
  }
}


// startMatch: pick one random ready player as first player and start game
function startMatch(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const players = Object.values(room.players || {}).filter(p => p && !p.disconnected && p.alive !== false);
  const readyPlayers = players.filter(p => room.ready && room.ready[p.id]);

  if (readyPlayers.length < MIN_PLAYERS) {
    room.waitingForStart = false;
    io.to(roomCode).emit('info', { msg: 'Not enough players to start' });
    return;
  }

  // 🎲 Step 1: tell clients to show dice animation
  io.to(roomCode).emit('diceRolling');

  // 🎲 Step 2: generate fake dice results for fun
  const rolls = {};
  readyPlayers.forEach(p => {
    rolls[p.id] = Math.floor(Math.random() * 6) + 1;
  });

  // Pick random winner (for turn order)
  const winner = readyPlayers[Math.floor(Math.random() * readyPlayers.length)];
  const winnerId = winner.id;

  // 🎲 Step 3: broadcast results
  io.to(roomCode).emit('diceResults', { rolls, winnerId });
  console.log(`🎲 Dice rolled in ${roomCode}: winner ${winner.name}`);

  // ✅ Step 4: after short delay, actually start game
  setTimeout(() => {
    // Reorder players so winner goes first
    const orderedPlayers = (room.order && room.order.slice()) || players.map(p => p.id);
    const startIndex = orderedPlayers.indexOf(winnerId);
    if (startIndex === -1) {
      const others = orderedPlayers.filter(id => id !== winnerId);
      room.order = [winnerId, ...others];
    } else {
      room.order = orderedPlayers.slice(startIndex).concat(orderedPlayers.slice(0, startIndex));
    }

    room.turnIndex = 0;
    room.waitingForStart = false;
    room.ready = {};

    // ✅ Step 5: tell clients the game officially begins
    io.to(roomCode).emit('gameStarted', { firstPlayerId: winnerId, order: room.order });
    console.log(`✅ Game started in ${roomCode} — first player: ${winner.name}`);

    // Initialize game state
    if (typeof startGame === 'function') {
      startGame(roomCode, winnerId);
    } else {
      const first = room.players[winnerId];
      if (first) {
        while ((first.hand || []).length < 4 && drawCard(room, winnerId, roomCode)) { /* draw until done */ }
      }
      io.to(roomCode).emit('info', `Game started. ${first ? first.name : winnerId} goes first.`);
    }

    updateRoom(roomCode);
  }, 2500); // <-- was 800 before, now 2500ms (2.5s)
}

// --- END: READY / COUNTDOWN / RANDOM STARTER SYSTEM ---

// --- socket handling ---
io.on('connection', socket => {
  console.log('New connection', socket.id);
  socket.emit('roomList', getRoomList());

  // --- Toggle Ready ---
  socket.on('toggleReady', (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('actionDenied', { msg: 'Room not found' });

    room.ready = room.ready || {};
    // default false -> set true, true->set false
    room.ready[socket.id] = !room.ready[socket.id];

    // If a disconnected player is ready (shouldn't), mark false
    if (room.players && room.players[socket.id] && room.players[socket.id].disconnected) {
      room.ready[socket.id] = false;
    }

    broadcastReadyState(roomCode);

    // Evaluate whether to start or cancel countdown
    const players = Object.values(room.players || {}).filter(p => p && !p.disconnected && p.alive !== false);
    const readyPlayers = players.filter(p => room.ready[p.id]);

    const allReady = players.length >= MIN_PLAYERS && readyPlayers.length === players.length;

    // If all ready and countdown not running -> start it
    if (allReady && !room._startCountdownHandle) {
      room.waitingForStart = true;
      const countdownMs = COUNTDOWN_MS;
      room.countdownEndsAt = Date.now() + countdownMs;

      // Broadcast countdown start with absolute timestamp
      io.to(roomCode).emit('countdownStarted', { endsAt: room.countdownEndsAt, countdownMs });

      // store handle to allow cancelling
      room._startCountdownHandle = setTimeout(() => {
        room._startCountdownHandle = null;
        startMatch(roomCode);
      }, countdownMs);
    }

    // If countdown running and somebody un-ready -> cancel
    if (room._startCountdownHandle && !allReady) {
      cancelCountdown(roomCode, 'player_unready');
    }
  });

  // --- Create room ---
  socket.on('createRoom', (roomCode, password, playerName) => {
    if (rooms[roomCode]) return socket.emit('errorMessage', 'Room exists');

    // create room
    rooms[roomCode] = {
      players: {},
      deck: generateDeck(),
      table: [],
      turnIndex: 0,
      order: [],
      password,
      discard: [],
      ready: {},
      waitingForStart: false,
      _startCountdownHandle: null,
      countdownEndsAt: null
    };

    const room = rooms[roomCode];

    // add player
    room.players[socket.id] = {
      id: socket.id,
      name: playerName,
      hand: [],
      resonance: 10,
      stability: 8,
      potionUsed: false,
      potionCharges: 1,
      locked: false,
      shield: false,
      reflectNext: false,
      skipNextDamage: false,
      avoidNextResonance: false,
      preventOverload: false,
      nextDiscard: 0,
      alive: true,
      disconnected: false,
      drinkCount: 0
    };

    room.order.push(socket.id);
    socket.join(roomCode);

    // If room has only creator, inform them to wait for players
    socket.emit('waiting_for_players');

    // initial hand - draw up to 4 but respecting MAX_HAND_SIZE
    for (let i = 0; i < 4; i++) {
      const c = drawCard(room, socket.id, roomCode);
      if (!c) break;
    }

    socket.emit('roomJoined', roomCode);
    updateRoom(roomCode);
    io.emit('roomList', getRoomList());
  });

  // --- Join room ---
  socket.on('joinRoom', (roomCode, password, playerName) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('errorMessage', 'Room not found');
    if (room.password !== password) return socket.emit('errorMessage', 'Wrong password');

    // Prevent duplicate ACTIVE names in the same room
    const activeNameTaken = Object.values(room.players || {}).some(
      p => p && p.name === playerName && !p.disconnected && p.alive
    );
    if (activeNameTaken) {
      return socket.emit('errorMessage', 'That name is already taken in this room.');
    }

    // Enforce maximum players
    if (Object.keys(room.players).length >= MAX_PLAYERS) {
      return socket.emit('errorMessage', 'Room is full. Please join another or create a new one.');
    }

    // --- Reconnect logic: try to find disconnected player with same name and restore them ---
    const existingId = Object.keys(room.players).find(id => {
      const p = room.players[id];
      return p && p.name === playerName && p.disconnected;
    });

    if (existingId) {
      const existing = room.players[existingId];
      const disconnectedDuration = Date.now() - (existing.disconnectedAt || 0);

      // Restore player slot
      existing.disconnected = false;
      existing.id = socket.id;
      room.players[socket.id] = existing;
      delete room.players[existingId];
      room.order = room.order.map(id => (id === existingId ? socket.id : id));
      socket.join(roomCode);

      // If disconnected more than 2 minutes, rebuild a fresh hand
      if (disconnectedDuration > 2 * 60 * 1000) {
        io.to(roomCode).emit('info', `${playerName} has reconnected after 2 minutes — refreshing hand.`);
        existing.hand = [];
        for (let i = 0; i < 4; i++) {
          const c = drawCard(room, socket.id, roomCode);
          if (!c) break;
        }
      } else {
        io.to(roomCode).emit('info', `${playerName} has reconnected with their original hand.`);
      }

      socket.emit('roomJoined', roomCode);
      updateRoom(roomCode);
      io.emit('roomList', getRoomList());
      return;
    }

    // Normal join: create new player
    room.players[socket.id] = {
      id: socket.id,
      name: playerName,
      hand: [],
      resonance: 10,
      stability: 8,
      potionUsed: false,
      potionCharges: 1,
      locked: false,
      shield: false,
      reflectNext: false,
      skipNextDamage: false,
      avoidNextResonance: false,
      preventOverload: false,
      nextDiscard: 0,
      alive: true,
      disconnected: false,
      drinkCount: 0
    };

    room.order.push(socket.id);
    socket.join(roomCode);

    // initial hand (respect MAX_HAND_SIZE)
    for (let i = 0; i < 4; i++) {
      const c = drawCard(room, socket.id, roomCode);
      if (!c) break;
    }

    socket.emit('roomJoined', roomCode);
    updateRoom(roomCode);
    io.emit('roomList', getRoomList());
  });

  // --- Play card (server-side validation + reflection logic) ---
  socket.on('playCard', ({ roomCode, cardId, targetId }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const isTurn = room.order[room.turnIndex] === socket.id;
    if (!isTurn) return socket.emit('actionDenied', { reason: 'Not your turn' });

    const player = room.players[socket.id];
    if (!player) return;
    if (player.locked) return socket.emit('actionDenied', { reason: 'You are locked this turn' });

    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;

    const card = player.hand[cardIndex];
    const cost = card.cost || 0;

    if (player.resonance < cost) return socket.emit('actionDenied', { reason: 'Insufficient resonance' });

    // Validate target server-side
    const target = targetId ? room.players[targetId] : null;
    if (target && target.id === player.id)
      return socket.emit('actionDenied', { reason: 'Cannot target yourself' });
    if (target && (!room.players[targetId] || room.players[targetId].disconnected || !room.players[targetId].alive))
      return socket.emit('actionDenied', { reason: 'Invalid target' });

    // Silence Field: deny playing cards if not the silencer
    if (room.silencedBy && room.silencedBy !== socket.id) {
      return socket.emit('actionDenied', { reason: 'Silence Field prevents playing cards this turn!' });
    }

    // Deduct cost and remove card from hand
    player.resonance = clamp(player.resonance - cost, 0, 999);
    player.hand.splice(cardIndex, 1);

    if (targetId) io.to(roomCode).emit('playerTargeted', { targetId, by: socket.id, cardId: card.id });

    try {
      if (card.action) {
        // Reflection handling
        let actor = player;
        let actualTarget = target;
        if (target && target.reflectNext) {
          target.reflectNext = false;
          actor = target;
          actualTarget = player;
          io.to(roomCode).emit('info', `${target.name} reflected ${card.name} back to ${player.name}!`);
        }
        card.action(actor, actualTarget, room);

        // Echo Catalyst: draw 1 card whenever playing a Spell card
        if (player.echoCatalyst && card.type === 'Spell') {
          const drawn = drawCard(room, player.id, roomCode);
          if (drawn) io.to(roomCode).emit('info', `${player.name}'s Echo Catalyst draws a bonus card!`);
        }
      }
    } catch (e) {
      console.error('Card action error:', e);
    }

    room.table.push({ card, owner: socket.id, ownerName: player.name });
    room.discard.push(card);

    // Check for fallen players
    for (const pid in room.players) {
      if (room.players[pid].stability <= 0 && room.players[pid].alive) {
        room.players[pid].alive = false;
        io.to(roomCode).emit('info', `${room.players[pid].name} has fallen!`);
      }
    }

    updateRoom(roomCode);
  });

  // --- Drink potion ---
  socket.on('drinkPotion', roomCode => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;

    const isTurn = room.order[room.turnIndex] === socket.id;
    if (!isTurn) return socket.emit('actionDenied', { reason: 'Not your turn' });
    if (player.potionUsed) return socket.emit('actionDenied', { reason: 'Potion already used this turn' });
    if (player.potionCharges <= 0) return socket.emit('actionDenied', { reason: 'No potion charges left' });

    player.resonance = clamp(player.resonance + 1, 0, 999);
    player.potionCharges--;
    player.potionUsed = true;
    player.drinkCount = (player.drinkCount || 0) + 1;

    io.to(roomCode).emit('info', `${player.name} drank a potion! +1 Resonance`);
    updateRoom(roomCode);
  });

  // --- Draw card ---
  socket.on('drawCard', roomCode => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;

    const isTurn = room.order[room.turnIndex] === socket.id;
    if (!isTurn) return socket.emit('actionDenied', { reason: 'Not your turn' });
    if (player.resonance < DRAW_COST) return socket.emit('actionDenied', { reason: `Need ${DRAW_COST} resonance to draw.` });

    // Enforce hand size
    if ((player.hand || []).length >= MAX_HAND_SIZE) {
      return socket.emit('actionDenied', { reason: `Hand full (max ${MAX_HAND_SIZE}).` });
    }

    player.resonance = clamp(player.resonance - DRAW_COST, 0, 999);
    const card = drawCard(room, socket.id, roomCode);
    if (!card) return socket.emit('actionDenied', { reason: 'No cards available to draw.' });

    updateRoom(roomCode);
  });

  // --- End turn ---
  socket.on('endTurn', roomCode => {
    const room = rooms[roomCode];
    if (!room) return;
    const isTurn = room.order[room.turnIndex] === socket.id;
    if (!isTurn) return socket.emit('actionDenied', { reason: 'Not your turn' });

    advanceTurn(roomCode);
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const player = room.players[socket.id];
      if (!player) continue;

      io.to(roomCode).emit('info', `${player.name} has disconnected — they have 2 minutes to reconnect before their cards are lost.`);

      // Mark as disconnected but keep their hand temporarily
      player.disconnected = true;
      player.alive = false;
      player.disconnectedAt = Date.now();

      // If they were marked ready, clear their ready state and broadcast
      if (room.ready && room.ready[socket.id]) {
        room.ready[socket.id] = false;
        broadcastReadyState(roomCode);
      }

      // If a countdown is running and someone disconnected -> cancel
      if (room._startCountdownHandle) {
        cancelCountdown(roomCode, 'player_disconnected');
      }

      // If it was their turn, skip them
      const wasTheirTurn = room.order[room.turnIndex] === socket.id;
      if (wasTheirTurn) {
        io.to(roomCode).emit('info', `Skipping ${player.name}'s turn due to disconnection.`);
        advanceTurn(roomCode);
      }

      // Schedule a 2-minute timeout to discard their hand if they don't return
      setTimeout(() => {
        const stillRoom = rooms[roomCode];
        if (!stillRoom) return;

        const stillPlayer = stillRoom.players[socket.id];
        // If player either reconnected or is already gone, skip cleanup
        if (!stillPlayer || !stillPlayer.disconnected) return;

        // Discard their hand after timeout
        if (Array.isArray(stillPlayer.hand) && stillPlayer.hand.length > 0) {
          stillRoom.discard.push(...stillPlayer.hand);
          stillPlayer.hand = [];
        }

        io.to(roomCode).emit('info', `${player.name}'s cards have been returned to the discard pile after 2 minutes of disconnection.`);
        updateRoom(roomCode);
      }, 2 * 60 * 1000); // 2 minutes = 120,000 ms
    }

    io.emit('roomList', getRoomList());
  });
});

// Start server
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
