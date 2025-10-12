// === Resonance Duel - Merged Client (Old + New, full-featured)
// This file merges the stable older client behaviors (room listing, simple UI
// interactions, targeting logic) with the newer enhancements (audio, ready
// system, countdown, dice visuals, better overlays). Drop this into your
// public/ folder as client.js (or copy/paste) and ensure server emits the
// expected events: 'roomList', 'readyState', 'countdownStarted', 'countdownCancelled',
// 'diceRolling', 'diceResults', 'gameStarted', 'update', etc.

/* global io */
const socket = io();

// --- Config ---
const DRAW_COST = 1;
const POTION_RESONANCE = 1;
const COUNTDOWN_SECONDS_DEFAULT = 10;

// --- Audio Assets ---
const SFX_FILES = {
  bg: '/assets/bg_arcade.mp3',
  click: '/assets/card_shuffle.mp3',
  draw: '/assets/card_draw.mp3',
  play: '/assets/game_start.mp3',
  potion: '/assets/potion_drink.mp3',
  resonance: '/assets/resonance_gain.mp3',
  damage: '/assets/damage_hit.mp3',
  heal: '/assets/heal.mp3',
  countdownTick: '/assets/countdown_tick.mp3',
  countdownStart: '/assets/countdown_start.mp3',
  dice: '/assets/dice_roll.mp3',
  turnStart: '/assets/turn_start.mp3',
  win: '/assets/win.mp3',
  lose: '/assets/lose.mp3'
};

const sounds = {};
for (const [k, url] of Object.entries(SFX_FILES)) {
  try {
    const a = new Audio(url);
    a.preload = 'auto';
    if (k === 'bg') a.volume = 0.35; else a.volume = 0.7;
    sounds[k] = a;
  } catch (e) {
    // Audio not available - keep code resilient
    sounds[k] = null;
  }
}
if (sounds.bg) sounds.bg.loop = true;

let musicEnabled = true;
function toggleMusic(forceOff = false) {
  if (forceOff) {
    Object.values(sounds).forEach(s => { try { s && s.pause(); } catch (e) {} });
    musicEnabled = false;
  } else {
    musicEnabled = !musicEnabled;
    if (musicEnabled) {
      try { sounds.bg && (sounds.bg.currentTime = 0); sounds.bg && sounds.bg.play().catch(()=>{}); } catch(e){}
    } else {
      Object.values(sounds).forEach(s => { try { s && s.pause(); } catch (e) {} });
    }
  }
}

// --- DOM Elements ---
const rulesDiv = document.getElementById('rules');
const startBtn = document.getElementById('startBtn');
const lobbyDiv = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const historyBtn = document.getElementById('historyBtn');
const historyPanel = document.getElementById('historyPanel');
const historyContent = document.getElementById('historyContent');
const closeHistoryBtn = document.getElementById('closeHistoryBtn');

const roomCodeInput = document.getElementById('roomCodeInput');
const passwordInput = document.getElementById('passwordInput');
const nameInput = document.getElementById('nameInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const roomListDiv = document.getElementById('roomList');

const yourStatsDiv = document.getElementById('yourStats');
const yourHandDiv = document.getElementById('yourHand');
const tableAreaDiv = document.getElementById('tableArea');
const otherPlayersDiv = document.getElementById('otherPlayers');
const turnIndicatorDiv = document.getElementById('turnIndicator');

const drawBtn = document.getElementById('drawBtn');
const potionBtn = document.getElementById('potionBtn');
const endTurnBtn = document.getElementById('endTurnBtn');

// --- Overlay UI ---
let overlayDiv = document.createElement('div');
overlayDiv.id = "overlayDiv";
overlayDiv.style.cssText = `
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.85);
  color: white; font-size: 2em;
  display: none; justify-content: center; align-items: center;
  z-index: 2000; text-align: center;
`;
overlayDiv.innerHTML = `<div id="overlayText">Waiting...</div>`;
document.body.appendChild(overlayDiv);
const overlayText = document.getElementById('overlayText');
function showOverlay(text) { overlayText.textContent = text || ''; overlayDiv.style.display = 'flex'; }
function hideOverlay() { overlayDiv.style.display = 'none'; }

// --- Message popup ---
const messageDiv = document.createElement('div');
messageDiv.id = "messageDiv";
messageDiv.style.cssText = `
  position:absolute; top:10px; left:50%; transform:translateX(-50%);
  background:#222; color:#fff; padding:10px; border-radius:5px;
  display:none; z-index:1000;
`;
document.body.appendChild(messageDiv);
function showMessage(msg, duration = 3000) {
  if (!messageDiv) return;
  messageDiv.textContent = msg;
  messageDiv.style.display = 'block';
  clearTimeout(showMessage._timeout);
  showMessage._timeout = setTimeout(() => messageDiv.style.display = 'none', duration);
}
function showToast(msg, d=2500){ showMessage(msg,d); }

// --- Mobile View Reset Helper ---
function resetMobileView() {
  if (window.innerWidth <= 768 && window.matchMedia("(orientation: portrait)").matches) {
    document.body.style.zoom = "100%";
    document.body.style.transform = "scale(1)";
    document.body.style.transformOrigin = "0 0";
    window.scrollTo(0, 0);
    setTimeout(() => window.scrollTo(0, 0), 150);
  }
}
window.matchMedia("(orientation: portrait)").addEventListener("change", resetMobileView);

// --- State ---
let currentRoom = null;
let selectedCard = null;
let targeting = false;
let mySocketId = null;
let deckSize = 0;
let latestYourData = null;
let latestOtherPlayers = {};
let waitingForPlayers = false;
let gamePaused = false;
let readyClicked = false;
let countdownTimer = null;
let countdownValue = COUNTDOWN_SECONDS_DEFAULT;

// --- Helpers ---
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

// --- UI Lock/Unlock ---
function disableGameControls() {
  try { if (drawBtn) drawBtn.disabled = true; if (potionBtn) potionBtn.disabled = true; if (endTurnBtn) endTurnBtn.disabled = true; } catch(e){}
  if (yourHandDiv) yourHandDiv.style.pointerEvents = 'none';
}
function enableGameControls() {
  if (!latestYourData) return;
  if (drawBtn) drawBtn.disabled = latestYourData.resonance < DRAW_COST;
  if (potionBtn) potionBtn.disabled = latestYourData.potionCharges <= 0;
  if (endTurnBtn) endTurnBtn.disabled = false;
  yourHandDiv.style.pointerEvents = 'auto';
}

// --- Sounds on button press (play only after unlock) ---
[startBtn, createBtn, joinBtn, drawBtn, potionBtn, endTurnBtn].forEach(btn => {
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (musicEnabled && sounds.click) sounds.click.play().catch(()=>{});
  });
});

// --- Audio unlock on first user interaction ---
function unlockAudioOnFirstGesture() {
  function onceUnlock() {
    try { Object.values(sounds).forEach((a) => { try { a && a.play().then(()=>a.pause()).catch(()=>{}); } catch(e){} }); } catch(e){}
    document.removeEventListener('pointerdown', onceUnlock);
    document.removeEventListener('keydown', onceUnlock);
  }
  document.addEventListener('pointerdown', onceUnlock, { once: true });
  document.addEventListener('keydown', onceUnlock, { once: true });
}
unlockAudioOnFirstGesture();

// --- Ready Button (constructed dynamically) ---
const readyBtn = document.createElement('button');
readyBtn.id = 'readyBtn';
readyBtn.textContent = "I'm Ready!";
readyBtn.style.cssText = 'margin-top:20px;padding:10px 20px;font-size:1.2em;';
readyBtn.classList.add('hidden');
if (lobbyDiv) lobbyDiv.appendChild(readyBtn);

readyBtn.onclick = () => {
  if (readyClicked) return;
  readyClicked = true;
  socket.emit('toggleReady', currentRoom);
  readyBtn.textContent = 'Ready ✓';
  readyBtn.disabled = true;
  if (musicEnabled && sounds.click) sounds.click.play().catch(()=>{});
};

// === Buttons: UI -> socket emits ===
if (startBtn) startBtn.onclick = () => {
  rulesDiv && rulesDiv.classList.add('hidden');
  lobbyDiv && lobbyDiv.classList.remove('hidden');
  if (musicEnabled && sounds.bg) try { sounds.bg.currentTime = 0; sounds.bg.play().catch(()=>{}); } catch(e){}
};

if (createBtn) createBtn.onclick = () => {
  const code = roomCodeInput?.value.trim();
  const pass = passwordInput?.value.trim();
  const name = nameInput?.value.trim();
  if (!code || !name) return showMessage('Enter room code and name');
  socket.emit('createRoom', code, pass, name);
};

if (joinBtn) joinBtn.onclick = () => {
  const code = roomCodeInput?.value.trim();
  const pass = passwordInput?.value.trim();
  const name = nameInput?.value.trim();
  if (!code || !name) return showMessage('Enter room code and name');
  socket.emit('joinRoom', code, pass, name);
};

if (drawBtn) drawBtn.onclick = () => {
  if (!latestYourData || latestYourData.resonance < DRAW_COST) return showMessage(`Need ${DRAW_COST} resonance to draw`);
  socket.emit('drawCard', currentRoom);
  if (musicEnabled && sounds.draw) sounds.draw.play().catch(()=>{});
};

if (potionBtn) potionBtn.onclick = () => {
  if (!latestYourData || latestYourData.potionCharges <= 0) return showMessage('No potion charges left!');
  socket.emit('drinkPotion', currentRoom);
  if (musicEnabled && sounds.potion) sounds.potion.play().catch(()=>{});
};

if (endTurnBtn) endTurnBtn.onclick = () => {
  socket.emit('endTurn', currentRoom);
  if (musicEnabled && sounds.click) sounds.click.play().catch(()=>{});
};

// === Room List Refresh / Display ===
function normalizeRoomObject(r) {
  // rooms might be strings (room codes) or objects {code, playerCount}
  if (typeof r === 'string') return { code: r, playerCount: undefined };
  if (!r) return { code: 'unknown', playerCount: undefined };
  return { code: r.code || r.roomCode || r.id || r.name || String(r), playerCount: r.playerCount || r.count || r.players || undefined };
}

function renderRoomList(rooms) {
  if (!roomListDiv) return;
  roomListDiv.innerHTML = '';
  if (!rooms || rooms.length === 0) {
    roomListDiv.innerHTML = '<p>No rooms available</p>';
    return;
  }
  rooms.forEach(raw => {
    const r = normalizeRoomObject(raw);
    const div = document.createElement('div');
    div.className = 'room-entry';
    div.style.cssText = 'border:1px solid #fff; margin:5px; padding:6px; cursor:pointer;';
    div.textContent = r.playerCount !== undefined ? `${r.code} | Players: ${r.playerCount}` : `${r.code}`;
    div.onclick = () => {
      roomCodeInput && (roomCodeInput.value = r.code);
      const name = nameInput?.value.trim();
      const pass = passwordInput?.value.trim();
      if (!name) return showMessage('Enter your name first');
      socket.emit('joinRoom', r.code, pass, name);
    };
    roomListDiv.appendChild(div);
  });
}

function refreshRoomList() {
  // ask server for rooms
  socket.emit('getRooms');
}

// Request periodically and on connect
setInterval(() => { try { refreshRoomList(); } catch(e){} }, 5000);

// --- Socket events ---
socket.on('connect', () => {
  mySocketId = socket.id;
  // initial fetch
  try { refreshRoomList(); } catch(e){}
});

socket.on('errorMessage', showMessage);
socket.on('info', showToast);

socket.on('roomJoined', (room) => {
  // server might emit just the room code or a full room object
  currentRoom = typeof room === 'string' ? room : (room?.code || room?.roomCode || currentRoom);
  lobbyDiv && lobbyDiv.classList.add('hidden');
  gameDiv && gameDiv.classList.remove('hidden');
  showOverlay('Waiting for players...');
  waitingForPlayers = true;
  disableGameControls();
  if (readyBtn) readyBtn.classList.remove('hidden');
});

socket.on('roomList', (rooms) => {
  try { renderRoomList(rooms); } catch(e){}
});

// READY / COUNTDOWN / DICE / START
socket.on('readyState', (payload) => {
  const readyMap = payload && payload.ready ? payload.ready : payload || {};
  const entries = Object.entries(readyMap || {});
  const readyCount = entries.filter(([id, val]) => !!val).length;
  const total = entries.length || 0;
  showOverlay(`Ready players: ${readyCount}/${total}`);
  disableGameControls();
});

socket.on('countdownStarted', ({ endsAt, countdownMs } = {}) => {
  const now = Date.now();
  const secondsLeft = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : (countdownMs ? Math.ceil(countdownMs / 1000) : COUNTDOWN_SECONDS_DEFAULT);
  countdownValue = secondsLeft;
  clearInterval(countdownTimer);
  overlayDiv.classList.add('countdown-active');
  showOverlay(`\u{1F3B2} Duel begins in ${countdownValue}s`);
  if (musicEnabled && sounds.countdownStart) sounds.countdownStart.play().catch(()=>{});
  countdownTimer = setInterval(() => {
    countdownValue--;
    if (countdownValue <= 0) { clearInterval(countdownTimer); }
    if (musicEnabled && sounds.countdownTick) sounds.countdownTick.play().catch(()=>{});
    overlayText.textContent = `\u{1F3B2} Duel begins in ${Math.max(0, countdownValue)}s`;
  }, 1000);
});

socket.on('countdownCancelled', ({ reason } = {}) => {
  clearInterval(countdownTimer);
  overlayDiv.classList.remove('countdown-active');
  showOverlay('Countdown cancelled');
  setTimeout(() => { if (!waitingForPlayers) hideOverlay(); }, 1200);
});

socket.on('diceRolling', () => {
  if (musicEnabled && sounds.dice) sounds.dice.play().catch(()=>{});
  overlayDiv.classList.add('dice-rolling');
  showOverlay('Rolling dice...');
});

socket.on('diceResults', ({ rolls, winnerId } = {}) => {
  const winnerName = (winnerId && latestOtherPlayers[winnerId] && latestOtherPlayers[winnerId].name) || (winnerId === mySocketId ? (latestYourData && latestYourData.name) : null) || 'Player';
  overlayDiv.classList.remove('dice-rolling');
  overlayDiv.classList.add('dice-announce');
  overlayText.textContent = `\u{1F3B2} ${winnerName} wins the roll!`;
});

socket.on('gameStarted', ({ firstPlayerId, order } = {}) => {
  if (musicEnabled && sounds.play) sounds.play.play().catch(()=>{});
  overlayDiv.classList.remove('countdown-active', 'dice-announce', 'dice-rolling');
  hideOverlay();
  enableGameControls();
  waitingForPlayers = false;
});

// Generic update flow (game state)
socket.on('update', (data) => {
  if (!data || !data.yourData) return;
  latestYourData = data.yourData;
  latestOtherPlayers = data.otherPlayers || {};
  deckSize = data.deckSize || deckSize;
  const isMyTurn = data.turnId === socket.id;

  const totalPlayers = Object.keys(latestOtherPlayers).length + 1;
  if (totalPlayers >= 2 && waitingForPlayers) {
    waitingForPlayers = false; hideOverlay(); gamePaused = false; enableGameControls();
  }

  if (gamePaused) { disableGameControls(); return; }

  updateTurnIndicator(data.turnId);
  updateButtons(isMyTurn);
  updateYourStats(latestYourData);
  renderHand(latestYourData.hand || [], isMyTurn);
  renderTable(data.table || []);
  renderOtherPlayers(latestOtherPlayers, data.turnId);
  cancelTargetingIfNeeded(isMyTurn);
});

socket.on('actionDenied', d => { if (d && d.reason) showToast(d.reason); });
socket.on('hand_full', ({ msg }) => showToast(msg || "You can’t hold more than 6 cards."));
socket.on('playerTargeted', ({ targetId, by, cardId }) => {
  const byName = latestOtherPlayers[by]?.name || "Someone";
  const targetName = latestOtherPlayers[targetId]?.name || (targetId === mySocketId ? (latestYourData?.name || 'You') : 'a player');
  showToast(`\u{1F300} ${byName} targeted ${targetName}!`);
});

socket.on('you_win', () => {
  gamePaused = true; showOverlay('\u{1F3C6} You Win! \u{1F3C6}');
  if (musicEnabled && sounds.bg) sounds.bg.pause();
  if (musicEnabled && sounds.win) sounds.win.play().catch(()=>{});
  disableGameControls();
});

socket.on('you_lose', () => {
  gamePaused = true; showOverlay('\u{1F480} You Lose \u{1F480}');
  if (musicEnabled && sounds.bg) sounds.bg.pause();
  if (musicEnabled && sounds.lose) sounds.lose.play().catch(()=>{});
  disableGameControls();
});

// === UI Update Functions ===
function updateTurnIndicator(turnId) {
  const name = (turnId === mySocketId) ? '⭐ Your Turn ⭐' : (latestOtherPlayers[turnId]?.name || 'Unknown');
  turnIndicatorDiv && (turnIndicatorDiv.textContent = `Current Turn: ${name}`);
}
function updateButtons(isMyTurn) {
  if (waitingForPlayers || gamePaused) return disableGameControls();
  if (drawBtn) drawBtn.disabled = !isMyTurn || latestYourData.resonance < DRAW_COST;
  if (potionBtn) potionBtn.disabled = !isMyTurn || latestYourData.potionCharges <= 0;
  if (endTurnBtn) endTurnBtn.disabled = !isMyTurn;
}
function updateYourStats(your) {
  if (!yourStatsDiv) return;
  yourStatsDiv.innerHTML = `\n    <h3>Your Stats</h3>\n    <div>🧍 ${your.name}</div>\n    <div>🌀 Resonance: ${your.resonance}</div>\n    <div>❤️ Stability: ${your.stability}</div>\n    <div>🃏 Deck: ${deckSize} cards remain | Draw cost: ${DRAW_COST}🌀</div>\n    <div>🍷 Drinks: ${your.drinkCount || 0}</div>\n  `;
}

// === Hand rendering ===
function renderHand(hand, isMyTurn) {
  if (!yourHandDiv) return;
  yourHandDiv.innerHTML = '';
  if (!Array.isArray(hand)) hand = [];
  if (hand.length > 8) yourHandDiv.classList.add('compact'); else yourHandDiv.classList.remove('compact');

  hand.forEach((card, idx) => {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.tabIndex = 0;
    cardDiv.innerHTML = `\n      <div class="type">${card.type}</div>\n      <h4>${card.name}</h4>\n      <p>${card.effect}</p>\n      <div class="resonance">Cost: ${card.cost}🌀</div>\n    `;
    cardDiv.classList.add('card-anim');
    cardDiv.style.animationDelay = (idx * 60) + 'ms';
    cardDiv.onclick = () => handleCardClick(card, isMyTurn);
    cardDiv.onpointerenter = () => cardDiv.classList.add('active-scale');
    cardDiv.onpointerleave = () => cardDiv.classList.remove('active-scale');
    yourHandDiv.appendChild(cardDiv);
  });

  // Drag-scroll for hand (only once setup)
  if (!yourHandDiv._dragInit) {
    yourHandDiv._dragInit = true;
    let isDown = false, startX = 0, scrollLeft = 0;
    yourHandDiv.addEventListener('mousedown', e => {
      isDown = true; yourHandDiv.classList.add('dragging'); startX = e.pageX - yourHandDiv.offsetLeft; scrollLeft = yourHandDiv.scrollLeft;
    });
    yourHandDiv.addEventListener('mouseleave', () => { isDown = false; yourHandDiv.classList.remove('dragging'); });
    yourHandDiv.addEventListener('mouseup', () => { isDown = false; yourHandDiv.classList.remove('dragging'); });
    yourHandDiv.addEventListener('mousemove', e => {
      if (!isDown) return; e.preventDefault(); const x = e.pageX - yourHandDiv.offsetLeft; const walk = (x - startX) * 1.5; yourHandDiv.scrollLeft = scrollLeft - walk;
    });
  }
}

// === Card click / targeting ===
function handleCardClick(card, isMyTurn) {
  if (!isMyTurn) return showMessage('Not your turn!');
  if (waitingForPlayers || gamePaused) return showMessage('Game not active yet!');
  if (card.cost > latestYourData.resonance) return showMessage('Not enough resonance!');
  if (musicEnabled && sounds.play) sounds.play.play().catch(()=>{});

  const targetRequired = [
    'Echo Drain', 'Layer Shift', 'Timeline Lock', 'Disarmonia Attack',
    'Unseen Echo', 'Anchor Stone', 'Frequency Swap', 'Collapse',
    'Echo Trap', 'Layer Fusion', 'Dissolve', 'Resonance Burst',
    'Spectral Break', 'Overtone Slash', 'Mind Fracture', 'Void Torrent'
  ];

  if (targetRequired.includes(card.name)) {
    selectedCard = card; targeting = true; showMessage(`Select a target for ${card.name}`); enableTargeting();
  } else {
    socket.emit('playCard', { roomCode: currentRoom, cardId: card.id });
  }
}

// === Table / history ===
function renderTable(table) {
  if (!historyContent) return;
  historyContent.innerHTML = '';
  (table || []).slice().reverse().forEach(entry => {
    const div = document.createElement('div');
    div.className = 'history-entry';
    div.textContent = `${entry.card.name} (${entry.card.type}) by ${entry.ownerName}`;
    historyContent.appendChild(div);
  });
}

if (historyBtn && closeHistoryBtn) {
  historyBtn.onclick = () => { historyPanel.classList.toggle('hidden'); historyPanel.classList.toggle('visible'); };
  closeHistoryBtn.onclick = () => { historyPanel.classList.add('hidden'); historyPanel.classList.remove('visible'); };
}

// === Other players display ===
function renderOtherPlayers(players, turnId) {
  otherPlayersDiv.innerHTML = '';
  const playersCount = Object.keys(players || {}).length;
  if (playersCount > 4) otherPlayersDiv.classList.add('compact'); else otherPlayersDiv.classList.remove('compact');
  Object.entries(players || {}).forEach(([id, p]) => {
    const div = document.createElement('div');
    div.className = 'playerBox';
    div.dataset.playerId = id;
    div.innerHTML = `\n      ${id === turnId ? '<div style="color:lime; font-weight:bold;">Current Turn</div>' : ''}\n      <strong>${p.name}</strong>\n      <div>🌀 ${p.resonance} | ❤️ ${p.stability}</div>\n      <div>🍷 Drinks: ${p.drinkCount || 0}</div>\n    `;
    otherPlayersDiv.appendChild(div);
  });
  if (targeting) enableTargeting();
}

// === Targeting helpers ===
function enableTargeting() {
  document.querySelectorAll('.playerBox').forEach(div => {
    const id = div.dataset.playerId; const p = latestOtherPlayers[id];
    if (!p || !p.alive) return;
    div.classList.add('targetable'); div.style.cursor = 'pointer';
    div.onclick = () => {
      socket.emit('playCard', { roomCode: currentRoom, cardId: selectedCard.id, targetId: id });
      targeting = false; selectedCard = null; highlightTargets(false);
    };
  });
  highlightTargets(true);
}
function highlightTargets(enable) {
  document.querySelectorAll('.playerBox').forEach(div => {
    if (enable && div.classList.contains('targetable')) div.style.outline = '3px solid yellow'; else div.style.outline = 'none';
  });
}
function cancelTargetingIfNeeded(isMyTurn) {
  if (!targeting) return;
  let cancel = false;
  if (!isMyTurn) cancel = true;
  else if (selectedCard) {
    const stillHas = latestYourData && latestYourData.hand && latestYourData.hand.some(c => c.id === selectedCard.id);
    if (!stillHas) cancel = true;
  } else cancel = true;
  if (cancel) {
    selectedCard = null; targeting = false; highlightTargets(false); showMessage('Targeting cancelled (turn changed or card unavailable).');
  }
}

// === Mute toggle button ===
const muteBtn = document.createElement('button');
muteBtn.textContent = '🔊 Mute';
muteBtn.style.cssText = 'position:fixed;bottom:10px;right:10px;padding:5px 10px;z-index:3000;';
muteBtn.classList.add('mute-toggle');
document.body.appendChild(muteBtn);
muteBtn.onclick = () => {
  if (musicEnabled) { toggleMusic(true); muteBtn.textContent = '🔈 Unmute'; }
  else { toggleMusic(false); muteBtn.textContent = '🔊 Mute'; }
};

console.log('Resonance Duel client (merged) ready.');
