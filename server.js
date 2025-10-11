// server.js - patched full server file
// Replaces your existing server.js. Includes:
// - flag persistence fixes (avoidNextResonance / skipNextDamage / reflectNext consumed only when used)
// - safe server-side target validation
// - disconnected players return hand to discard to avoid card loss
// - reconnect by name handling
// - max players per room (4), min players (2) noted for start logic
// - max hand size (6) enforced on draws and initial deal

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
    if (roomCode) io.to(roomCode).emit('info', 'Deck reshuffled!');
  }

  const card = room.deck.pop();
  if (card) {
    player.hand.push(card);
    return card;
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

  const turnId = room.order[room.turnIndex];

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
      deckSize: room.deck ? room.deck.length : 0
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
    current.potionUsed = current.potionUsed || false;
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

  io.to(roomCode).emit('turnChanged', {
    currentTurnIndex: room.turnIndex,
    currentPlayerId: nextId
  });

  updateRoom(roomCode);
}

// --- socket handling ---
io.on('connection', socket => {
  console.log('New connection', socket.id);
  socket.emit('roomList', getRoomList());

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
      discard: []
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
