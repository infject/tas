// server.js — full version with proper potion handling + drinkCount
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { cards } = require('./cards'); // make sure your cards.js exports 'cards'

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

// server-side config
const DRAW_COST = 1; // resonance cost to draw extra card

// --- Helpers ---
const shuffle = deck => {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

const generateDeck = () => shuffle([...cards]);

const getRoomList = () =>
  Object.keys(rooms).map(code => ({
    code,
    playerCount: Object.keys(rooms[code].players).length
  }));

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// --- Draw card with reshuffle ---
function drawCard(room, playerId, roomCode) {
  const player = room.players[playerId];
  if (!player) return null;

  if (room.deck.length === 0) {
    if (room.discard.length === 0) return null;
    room.deck = shuffle([...room.discard]);
    room.discard = [];
    if (roomCode) io.to(roomCode).emit('info', 'Deck reshuffled!');
  }

  const card = room.deck.pop();
  player.hand.push(card);
  return card;
}

// --- Update room ---
function updateRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const turnId = room.order[room.turnIndex];

  for (const id in room.players) {
    const player = room.players[id];
    const others = {};

    for (const pid in room.players) {
      if (pid !== id) {
        const p = room.players[pid];
        others[pid] = {
          name: p.name,
          handCount: p.hand.length,
          resonance: p.resonance,
          stability: p.stability,
          alive: p.alive,
          drinkCount: p.drinkCount || 0 // <-- add drinkCount for other players
        };
      }
    }

    io.to(id).emit('update', {
      yourData: {
        id: player.id,
        name: player.name,
        hand: player.hand,
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
        drinkCount: player.drinkCount || 0 // <-- add drinkCount for self
      },
      table: room.table,
      otherPlayers: others,
      turnId,
      deckSize: room.deck.length
    });
  }
}

// --- Advance turn ---
function advanceTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const currentIndex = room.turnIndex;
  const currentPlayerId = room.order[currentIndex];
  const current = room.players[currentPlayerId];

  // Reset flags for current player
  if (current) {
    current.locked = false;
    current.shield = false;
    current.reflectNext = false;
    current.skipNextDamage = false;
    current.avoidNextResonance = false;
    current.preventOverload = false;
    current.potionUsed = current.potionUsed || false;
  }

  // Move to next alive player
  if (!room.order || room.order.length === 0) return;
  
  let attempts = 0;
  // Advance turn index and skip players who are dead or flagged to be skipped.
  while (true) {
    room.turnIndex = (room.turnIndex + 1) % room.order.length;
    attempts++;
    if (attempts > room.order.length + 5) break;

    const candidateId = room.order[room.turnIndex];
    const candidate = room.players[candidateId];

    // If candidate doesn't exist or isn't alive, continue searching.
    if (!candidate || !candidate.alive) continue;

    // If candidate is flagged to skip their turn, consume the flag, emit info, and continue to next.
    if (candidate.skipTurn) {
      candidate.skipTurn = false;
      io.to(roomCode).emit('info', `${candidate.name} skips their turn due to Timeline Lock.`);
      continue;
    }

    // Found next valid player
    break;
  }

const nextId = room.order[room.turnIndex];
  const next = room.players[nextId];

  // Reset potion usage and give 1 potion per turn
  if (next) {
    next.potionUsed = false;
    next.potionCharges = Math.max(next.potionCharges, 1);
  }
    // Apply any pending nextDiscard effect to the next player (trigger at start of their turn)
    if (next && next.nextDiscard > 0 && next.hand.length > 0) {
      next.hand.pop();
      next.nextDiscard = 0;
      io.to(roomCode).emit('info', `${next.name} discards a card due to an Echo Trap!`);
    }


  // Draw 1 card at start of turn
  if (next && next.alive) {
    drawCard(room, nextId, roomCode);
  }

  io.to(roomCode).emit('turnChanged', {
    currentTurnIndex: room.turnIndex,
    currentPlayerId: nextId
  });

  updateRoom(roomCode);
}

// --- Socket.IO ---
io.on('connection', socket => {
  console.log('New connection', socket.id);
  socket.emit('roomList', getRoomList());

  // --- Create room ---
  socket.on('createRoom', (roomCode, password, playerName) => {
    if (rooms[roomCode]) return socket.emit('errorMessage', 'Room exists');

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
      drinkCount: 0 // <-- initialize drinkCount
    };

    room.order.push(socket.id);
    socket.join(roomCode);

    // Draw initial hand
    for (let i = 0; i < 4; i++) drawCard(room, socket.id, roomCode);

    socket.emit('roomJoined', roomCode);
    updateRoom(roomCode);
    io.emit('roomList', getRoomList());
  });

  // --- Join room ---
  socket.on('joinRoom', (roomCode, password, playerName) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('errorMessage', 'Room not found');
    if (room.password !== password) return socket.emit('errorMessage', 'Wrong password');

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
      drinkCount: 0 // <-- initialize drinkCount
    };

    room.order.push(socket.id);
    socket.join(roomCode);

    for (let i = 0; i < 4; i++) drawCard(room, socket.id, roomCode);

    socket.emit('roomJoined', roomCode);
    updateRoom(roomCode);
    io.emit('roomList', getRoomList());
  });

  // --- Play card ---
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

    player.resonance = clamp(player.resonance - cost, 0, 999);
    player.hand.splice(cardIndex, 1);

    const target = targetId ? room.players[targetId] : null;
    if (targetId) io.to(roomCode).emit('playerTargeted', { targetId, by: socket.id, cardId: card.id });

    try {
      if (card.action) {
        // Reflection handling: if target had reflectNext, reflect the effect back by swapping actor/target
        let actor = player;
        let actualTarget = target;
        if (target && target.reflectNext) {
          target.reflectNext = false;
          // swap so the target becomes the actor and the original actor becomes the target
          actor = target;
          actualTarget = player;
          io.to(roomCode).emit('info', `${target.name} reflected ${card.name} back to ${player.name}!`);
        }
        card.action(actor, actualTarget, room);
      }
    } catch (e) { console.error('Card action error:', e); }

    room.table.push({ card, owner: socket.id, ownerName: player.name });
    room.discard.push(card);

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

    // --- EFFECT: +1 resonance per potion ---
    player.resonance = clamp(player.resonance + 1, 0, 999); 
    player.potionCharges--;
    player.potionUsed = true;

    // Increment real-life drink count
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
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        room.order = room.order.filter(id => id !== socket.id);
        if (Object.keys(room.players).length === 0) delete rooms[roomCode];
        else {
          room.turnIndex = room.turnIndex % room.order.length;
          updateRoom(roomCode);
        }
      }
    }
    io.emit('roomList', getRoomList());
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
