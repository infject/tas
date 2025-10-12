// client.js - Final merged client (ready-to-paste)
// Matches server events: roomList, readyState, countdownStarted, countdownCancelled,
// diceRolling, diceResults, gameStarted, update, turnChanged, etc.

/* global io */
const socket = io();

// --- Config ---
const DRAW_COST = 1;
const COUNTDOWN_SECONDS_DEFAULT = 10;
const DICE_ANIM_MS = 1400; // how long to show gif before showing result text (client-side)

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
    a.loop = false;
    if (k === 'bg') a.volume = 0.35; else a.volume = 0.7;
    sounds[k] = a;
  } catch (e) {
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

// --- DOM Elements (defensive) ---
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

// --- Overlay / message layer ---
let overlayDiv = document.getElementById('overlayDiv');
if (!overlayDiv) {
  overlayDiv = document.createElement('div');
  overlayDiv.id = "overlayDiv";
  overlayDiv.style.cssText = 'position:fixed;inset:0;display:none;justify-content:center;align-items:center;background:rgba(0,0,0,0.85);color:#fff;font-size:2em;z-index:2000;text-align:center;';
  overlayDiv.innerHTML = `
    <div id="overlayInner" style="display:flex;flex-direction:column;gap:12px;align-items:center;">
      <div id="overlayText">Waiting...</div>
      <div id="overlayDiceContainer" style="display:none;align-items:center;gap:10px;">
        <img id="overlayDiceGif" src="/assets/dice_roll.gif" alt="rolling" style="width:140px;height:140px;"/>
        <div id="overlayDiceResults" style="font-size:0.7em;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlayDiv);
}
const overlayText = document.getElementById('overlayText');
const overlayDiceContainer = document.getElementById('overlayDiceContainer');
const overlayDiceGif = document.getElementById('overlayDiceGif');
const overlayDiceResults = document.getElementById('overlayDiceResults');

function showOverlay(text='') {
  try { if (overlayText) overlayText.textContent = text; overlayDiv.style.display = 'flex'; } catch(e){}
}
function hideOverlay() { try { overlayDiv.style.display = 'none'; overlayDiceContainer.style.display = 'none'; overlayText.style.display = 'block'; overlayDiceResults.innerHTML=''; } catch(e){} }

// --- Message popup ---
let messageDiv = document.getElementById('messageDiv');
if (!messageDiv) {
  messageDiv = document.createElement('div');
  messageDiv.id = 'messageDiv';
  messageDiv.style.cssText = 'position:absolute;top:10px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:10px;border-radius:5px;display:none;z-index:3000;';
  document.body.appendChild(messageDiv);
}
function showMessage(msg, dur=3000) {
  messageDiv.textContent = msg;
  messageDiv.style.display = 'block';
  clearTimeout(showMessage._t);
  showMessage._t = setTimeout(()=>messageDiv.style.display='none', dur);
}
function showToast(msg, dur=2500){ showMessage(msg, dur); }

// --- Mobile reset helper ---
function resetMobileView() {
  if (window.innerWidth <= 768 && window.matchMedia("(orientation: portrait)").matches) {
    document.body.style.zoom = "100%";
    document.body.style.transform = "scale(1)";
    document.body.style.transformOrigin = "0 0";
    window.scrollTo(0, 0);
    setTimeout(() => window.scrollTo(0, 0), 150);
  }
}
try { window.matchMedia("(orientation: portrait)").addEventListener("change", resetMobileView); } catch(e){}

// --- State ---
let mySocketId = null;
let currentRoom = null;
let latestYourData = null;
let latestOtherPlayers = {};
let deckSize = 0;
let waitingForPlayers = false;
let gamePaused = false;
let targeting = false;
let selectedCard = null;
let readyClicked = false;
let countdownTimer = null;
let countdownValue = COUNTDOWN_SECONDS_DEFAULT;

// helpers
const clamp = (n,a,b)=> Math.max(a, Math.min(b, n));

// --- Audio unlock on first gesture (to satisfy mobile autoplay restrictions) ---
function unlockAudioOnFirstGesture() {
  function onceUnlock() {
    try {
      Object.values(sounds).forEach(a => { try { a && a.play().then(()=>a.pause()).catch(()=>{}); } catch(e){} });
    } catch(e){}
    document.removeEventListener('pointerdown', onceUnlock);
    document.removeEventListener('keydown', onceUnlock);
  }
  document.addEventListener('pointerdown', onceUnlock, { once: true });
  document.addEventListener('keydown', onceUnlock, { once: true });
}
unlockAudioOnFirstGesture();

// --- Mute toggle button ---
const muteBtn = document.createElement('button');
muteBtn.textContent = '🔊 Mute';
muteBtn.style.cssText = 'position:fixed;bottom:10px;right:10px;padding:6px 10px;z-index:3000;border-radius:6px;background:#222;color:#fff;border:none;';
document.body.appendChild(muteBtn);
muteBtn.onclick = () => {
  if (musicEnabled) { toggleMusic(true); muteBtn.textContent = '🔈 Unmute'; }
  else { toggleMusic(false); muteBtn.textContent = '🔊 Mute'; }
};

// --- Ready Button ---
let readyBtn = document.getElementById('readyBtn');
if (!readyBtn) {
  readyBtn = document.createElement('button');
  readyBtn.id = 'readyBtn';
  readyBtn.textContent = "I'm Ready!";
  readyBtn.style.cssText = 'margin-top:12px;padding:10px 16px;font-size:1em;border-radius:6px;';
  readyBtn.classList.add('hidden');
  if (lobbyDiv) lobbyDiv.appendChild(readyBtn);
}
readyBtn.addEventListener('click', () => {
  if (readyClicked) return;
  readyClicked = true;
  socket.emit('toggleReady', currentRoom);
  readyBtn.textContent = 'Ready ✓';
  readyBtn.disabled = true;
  try { if (musicEnabled && sounds.click) sounds.click.play().catch(()=>{}); } catch(e){}
});

// --- Button hookup sounds + defensive toggles ---
function disableGameControls() {
  try { if (drawBtn) drawBtn.disabled = true; if (potionBtn) potionBtn.disabled = true; if (endTurnBtn) endTurnBtn.disabled = true; } catch(e){}
  if (yourHandDiv) yourHandDiv.style.pointerEvents = 'none';
}
function enableGameControls() {
  if (!latestYourData) return;
  try { if (drawBtn) drawBtn.disabled = latestYourData.resonance < DRAW_COST; } catch(e){}
  try { if (potionBtn) potionBtn.disabled = latestYourData.potionCharges <= 0; } catch(e){}
  try { if (endTurnBtn) endTurnBtn.disabled = false; } catch(e){}
  if (yourHandDiv) yourHandDiv.style.pointerEvents = 'auto';
}

// play click on primary UI buttons (if available)
[startBtn, createBtn, joinBtn, drawBtn, potionBtn, endTurnBtn].forEach(btn => {
  if (!btn) return;
  btn.addEventListener('click', () => { try { if (musicEnabled && sounds.click) sounds.click.play().catch(()=>{}); } catch(e){} });
});

// --- UI: create/join/start/draw/potion/endTurn ---
if (startBtn) startBtn.addEventListener('click', () => {
  rulesDiv && rulesDiv.classList.add('hidden');
  lobbyDiv && lobbyDiv.classList.remove('hidden');
  try { if (musicEnabled && sounds.bg) { sounds.bg.currentTime = 0; sounds.bg.play().catch(()=>{}); } } catch(e){}
});

if (createBtn) createBtn.addEventListener('click', () => {
  const code = roomCodeInput?.value.trim();
  const pass = passwordInput?.value.trim();
  const name = nameInput?.value.trim();
  if (!code || !name) return showMessage('Enter room code and name');
  socket.emit('createRoom', code, pass, name);
});

if (joinBtn) joinBtn.addEventListener('click', () => {
  const code = roomCodeInput?.value.trim();
  const pass = passwordInput?.value.trim();
  const name = nameInput?.value.trim();
  if (!code || !name) return showMessage('Enter room code and name');
  socket.emit('joinRoom', code, pass, name);
});

if (drawBtn) drawBtn.addEventListener('click', () => {
  if (!latestYourData || latestYourData.resonance < DRAW_COST) return showMessage(`Need ${DRAW_COST} resonance to draw`);
  socket.emit('drawCard', currentRoom);
  try { if (musicEnabled && sounds.draw) sounds.draw.play().catch(()=>{}); } catch(e){}
});

if (potionBtn) potionBtn.addEventListener('click', () => {
  if (!latestYourData || latestYourData.potionCharges <= 0) return showMessage('No potion charges left!');
  socket.emit('drinkPotion', currentRoom);
  try { if (musicEnabled && sounds.potion) sounds.potion.play().catch(()=>{}); } catch(e){}
});

if (endTurnBtn) endTurnBtn.addEventListener('click', () => {
  socket.emit('endTurn', currentRoom);
  try { if (musicEnabled && sounds.click) sounds.click.play().catch(()=>{}); } catch(e){}
});

// --- Room list renderer (server emits roomList) ---
function normalizeRoomObject(r) {
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
    div.style.cssText = 'border:1px solid #fff;margin:6px;padding:8px;cursor:pointer;background:rgba(255,255,255,0.03);border-radius:6px;';
    div.textContent = r.playerCount !== undefined ? `${r.code} | Players: ${r.playerCount}` : `${r.code}`;
    div.onclick = () => {
      if (roomCodeInput) roomCodeInput.value = r.code;
      const name = nameInput?.value.trim();
      const pass = passwordInput?.value.trim();
      if (!name) return showMessage('Enter your name first');
      socket.emit('joinRoom', r.code, pass, name);
    };
    roomListDiv.appendChild(div);
  });
}

// --- Socket handlers ---
socket.on('connect', () => {
  mySocketId = socket.id;
  // server will emit roomList on connect if available
});

// roomList
socket.on('roomList', (rooms) => {
  try { renderRoomList(rooms); } catch(e) { console.error(e); }
});

// generic room joined
socket.on('roomJoined', (room) => {
  currentRoom = typeof room === 'string' ? room : (room?.code || room?.roomCode || currentRoom);

  // Hide the old screens
  const lobbyDiv = document.getElementById('lobby');
  const gameDiv = document.getElementById('game');
  const readyLobbyDiv = document.getElementById('readyLobby');

  if (lobbyDiv) lobbyDiv.classList.add('hidden');
  if (gameDiv) gameDiv.classList.add('hidden');
  
  // Show the ready lobby instead of the game directly
  if (readyLobbyDiv) readyLobbyDiv.classList.remove('hidden');

  // Update ready lobby info
  const roomLabel = document.getElementById('roomLabel');
  if (roomLabel) roomLabel.textContent = `Room: ${currentRoom}`;

  showOverlay('Waiting for players...');
  waitingForPlayers = true;
  disableGameControls();

  // Make sure ready button is visible and reset
  const readyBtn = document.getElementById('readyBtn');
  if (readyBtn) {
    readyBtn.classList.remove('hidden');
    readyBtn.disabled = false;
    readyBtn.textContent = "I'm Ready!";
  }

  // Reset readiness flag
  readyClicked = false;
});


socket.on('readyState', payload => {
  const readyMap = payload && payload.ready ? payload.ready : payload || {};
  const entries = Object.entries(readyMap || {});
  const readyCount = entries.filter(([id,val]) => !!val).length;
  const total = entries.length || 0;

  // ✅ Don’t block UI during ready phase — just display text at the top.
  if (!document.getElementById('readyStatus')) {
    const status = document.createElement('div');
    status.id = 'readyStatus';
    status.style.cssText = `
      position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,0.6); color: #fff; padding: 8px 14px;
      border-radius: 8px; font-size: 1.2em; z-index: 999;
    `;
    document.body.appendChild(status);
  }
  document.getElementById('readyStatus').textContent = `Ready players: ${readyCount}/${total}`;
});
 
// countdown start
socket.on('countdownStarted', ({ endsAt, countdownMs } = {}) => {
  const now = Date.now();
  const secondsLeft = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : (countdownMs ? Math.ceil(countdownMs / 1000) : COUNTDOWN_SECONDS_DEFAULT);
  countdownValue = secondsLeft;
  clearInterval(countdownTimer);
  overlayDiv.classList.add('countdown-active');
  showOverlay(`\u{1F3B2} Duel begins in ${countdownValue}s`);
  try { if (musicEnabled && sounds.countdownStart) sounds.countdownStart.play().catch(()=>{}); } catch(e){}
  countdownTimer = setInterval(() => {
    countdownValue--;
    if (countdownValue <= 0) { clearInterval(countdownTimer); }
    try { if (musicEnabled && sounds.countdownTick) sounds.countdownTick.play().catch(()=>{}); } catch(e){}
    if (overlayText) overlayText.textContent = `\u{1F3B2} Duel begins in ${Math.max(0, countdownValue)}s`;
  }, 1000);
});

// countdown cancelled
socket.on('countdownCancelled', ({ reason } = {}) => {
  clearInterval(countdownTimer);
  overlayDiv.classList.remove('countdown-active');
  showOverlay('Countdown cancelled');
  // allow players to re-ready
  readyClicked = false;
  if (readyBtn) { readyBtn.disabled = false; readyBtn.textContent = "I'm Ready!"; }
  setTimeout(() => { if (!waitingForPlayers) hideOverlay(); }, 1200);
});

// dice visuals
socket.on('diceRolling', () => {
  // play dice sound and show gif
  try { if (musicEnabled && sounds.dice) { sounds.dice.currentTime = 0; sounds.dice.play().catch(()=>{}); } } catch(e){}
  overlayDiceContainer.style.display = 'flex';
  overlayText.style.display = 'none';
  overlayDiceResults.innerHTML = ''; // clear previous
  showOverlay('');
});

// dice result - server supplies rolls object and winnerId
socket.on('diceResults', ({ rolls, winnerId } = {}) => {
  // show gif briefly then show results text
  setTimeout(() => {
    overlayDiceContainer.style.display = 'flex';
    overlayText.style.display = 'none';
    // build simple results grid: player name -> roll
    let html = '<div style="text-align:left;font-size:0.85em;">';
    try {
      if (rolls && typeof rolls === 'object') {
        for (const [pid, val] of Object.entries(rolls)) {
          const name = (latestOtherPlayers[pid] && latestOtherPlayers[pid].name) || (pid === mySocketId ? (latestYourData && latestYourData.name) : pid);
          html += `<div style="margin-bottom:6px;"><strong>${name}</strong>: ${val}</div>`;
        }
      }
    } catch(e){}
    const winnerName = (winnerId && latestOtherPlayers[winnerId] && latestOtherPlayers[winnerId].name) || (winnerId === mySocketId ? (latestYourData && latestYourData.name) : 'Player');
    html += `</div><div style="margin-top:8px;font-weight:bold;">\u{1F3B2} ${winnerName} wins the roll!</div>`;
    overlayDiceResults.innerHTML = html;
    overlayDiceContainer.style.display = 'flex';
    overlayText.style.display = 'none';
  }, DICE_ANIM_MS);
});

socket.on('gameStarted', ({ firstPlayerId, order } = {}) => {
  console.log('✅ Game started! First turn:', firstPlayerId);

  // Hide waiting/ready UI
  const readyLobby = document.getElementById('readyLobby');
  const readyPlayers = document.getElementById('readyPlayers');
  const countdownDisplay = document.getElementById('countdownDisplay');
  const diceRollArea = document.getElementById('diceRollArea');
  const readyBtn = document.getElementById('readyBtn');

  if (readyLobby) readyLobby.classList.add('hidden');
  if (readyPlayers) readyPlayers.textContent = '';
  if (countdownDisplay) countdownDisplay.textContent = '';
  if (diceRollArea) diceRollArea.classList.add('hidden');
  if (readyBtn) readyBtn.classList.add('hidden');

  // Show main game
  const gameDiv = document.getElementById('game');
  if (gameDiv) gameDiv.classList.remove('hidden');

  // Reset internal state
  waitingForPlayers = false;
  readyClicked = false;

  enableGameControls();
  showToast('The duel begins!');
  setTimeout(() => { overlayDiceContainer.style.display = 'none'; }, 800);
  // --- Cleanup overlays and ready indicators after the game starts ---
hideOverlay(); // hides the black overlay with "waiting/dice" etc.

const readyStatus = document.getElementById('readyStatus');
if (readyStatus) readyStatus.remove(); // remove the floating ready counter if visible
});


// update: per-player view emitted to each player
socket.on('update', (data) => {
  if (!data || !data.yourData) return;
  latestYourData = data.yourData;
  latestOtherPlayers = data.otherPlayers || {};
  deckSize = data.deckSize || deckSize;
  const isMyTurn = data.turnId === socket.id;

  // remove waiting overlay if enough players
  const totalPlayers = Object.keys(latestOtherPlayers).length + 1;
  if (totalPlayers >= 2 && waitingForPlayers) {
    waitingForPlayers = false;
    hideOverlay();
    gamePaused = false;
    enableGameControls();
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

// small info handlers
socket.on('actionDenied', d => { if (d && d.reason) showToast(d.reason); });
socket.on('hand_full', ({ msg }) => showToast(msg || `You can’t hold more than 6 cards.`));
socket.on('playerTargeted', ({ targetId, by, cardId }) => {
  const byName = latestOtherPlayers[by]?.name || "Someone";
  const targetName = latestOtherPlayers[targetId]?.name || (targetId === mySocketId ? (latestYourData?.name || 'You') : 'a player');
  showToast(`\u{1F300} ${byName} targeted ${targetName}!`);
});
socket.on('info', d => {
  const msg = typeof d === 'string' ? d : (d && d.msg) ? d.msg : JSON.stringify(d);
  showToast(msg, 3000);
});

// win/lose
socket.on('you_win', () => {
  gamePaused = true;
  showOverlay('\u{1F3C6} You Win! \u{1F3C6}');
  try { if (musicEnabled && sounds.bg) sounds.bg.pause(); } catch(e){}
  try { if (musicEnabled && sounds.win) sounds.win.play().catch(()=>{}); } catch(e){}
  disableGameControls();
});
socket.on('you_lose', () => {
  gamePaused = true;
  showOverlay('\u{1F480} You Lose \u{1F480}');
  try { if (musicEnabled && sounds.bg) sounds.bg.pause(); } catch(e){}
  try { if (musicEnabled && sounds.lose) sounds.lose.play().catch(()=>{}); } catch(e){}
  disableGameControls();
});

// turnChanged listener (server emits turnChanged after advanceTurn)
socket.on('turnChanged', ({ currentTurnIndex, currentPlayerId } = {}) => {
  updateTurnIndicator(currentPlayerId);
});

// --- UI helpers ---
function updateTurnIndicator(turnId) {
  const name = (turnId === mySocketId) ? '⭐ Your Turn ⭐' : (latestOtherPlayers[turnId]?.name || 'Unknown');
  if (turnIndicatorDiv) turnIndicatorDiv.textContent = `Current Turn: ${name}`;
}
function updateButtons(isMyTurn) {
  if (waitingForPlayers || gamePaused) return disableGameControls();
  try { if (drawBtn) drawBtn.disabled = !isMyTurn || latestYourData.resonance < DRAW_COST; } catch(e){}
  try { if (potionBtn) potionBtn.disabled = !isMyTurn || latestYourData.potionCharges <= 0; } catch(e){}
  try { if (endTurnBtn) endTurnBtn.disabled = !isMyTurn; } catch(e){}
}
function updateYourStats(your) {
  if (!yourStatsDiv || !your) return;
  yourStatsDiv.innerHTML = `
    <h3>Your Stats</h3>
    <div>🧍 ${your.name}</div>
    <div>🌀 Resonance: ${your.resonance}</div>
    <div>❤️ Stability: ${your.stability}</div>
    <div>🃏 Deck: ${deckSize} cards remain | Draw cost: ${DRAW_COST}🌀</div>
    <div>🍷 Drinks: ${your.drinkCount || 0}</div>
  `;
}

// --- Hand rendering & interactions ---
function renderHand(hand, isMyTurn) {
  if (!yourHandDiv) return;
  yourHandDiv.innerHTML = '';
  if (!Array.isArray(hand)) hand = [];
  if (hand.length > 8) yourHandDiv.classList.add('compact'); else yourHandDiv.classList.remove('compact');

  hand.forEach((card, idx) => {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.tabIndex = 0;
    cardDiv.innerHTML = `
      <div class="type">${card.type}</div>
      <h4>${card.name}</h4>
      <p>${card.effect}</p>
      <div class="resonance">Cost: ${card.cost}🌀</div>
    `;
    cardDiv.style.animationDelay = (idx * 60) + 'ms';
    cardDiv.onclick = () => handleCardClick(card, isMyTurn);
    cardDiv.onpointerenter = () => cardDiv.classList.add('active-scale');
    cardDiv.onpointerleave = () => cardDiv.classList.remove('active-scale');
    yourHandDiv.appendChild(cardDiv);
  });

  // drag-scroll (init once)
  if (!yourHandDiv._dragInit) {
    yourHandDiv._dragInit = true;
    let isDown=false, startX=0, scrollLeft=0;
    yourHandDiv.addEventListener('mousedown', e=>{ isDown=true; yourHandDiv.classList.add('dragging'); startX=e.pageX - yourHandDiv.offsetLeft; scrollLeft=yourHandDiv.scrollLeft; });
    yourHandDiv.addEventListener('mouseleave', ()=>{ isDown=false; yourHandDiv.classList.remove('dragging'); });
    yourHandDiv.addEventListener('mouseup', ()=>{ isDown=false; yourHandDiv.classList.remove('dragging'); });
    yourHandDiv.addEventListener('mousemove', e=>{ if(!isDown) return; e.preventDefault(); const x = e.pageX - yourHandDiv.offsetLeft; const walk = (x - startX) * 1.5; yourHandDiv.scrollLeft = scrollLeft - walk; });
  }
}

function handleCardClick(card, isMyTurn) {
  if (!isMyTurn) return showMessage('Not your turn!');
  if (waitingForPlayers || gamePaused) return showMessage('Game not active yet!');
  if (!latestYourData) return showMessage('No player data');
  if (card.cost > latestYourData.resonance) return showMessage('Not enough resonance!');
  try { if (musicEnabled && sounds.play) sounds.play.play().catch(()=>{}); } catch(e){}

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

// --- Table / history ---
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

// --- Other players ---
function renderOtherPlayers(players, turnId) {
  if (!otherPlayersDiv) return;
  otherPlayersDiv.innerHTML = '';
  const playersCount = Object.keys(players || {}).length;
  if (playersCount > 4) otherPlayersDiv.classList.add('compact'); else otherPlayersDiv.classList.remove('compact');
  Object.entries(players || {}).forEach(([id, p]) => {
    const div = document.createElement('div');
    div.className = 'playerBox';
    div.dataset.playerId = id;
    div.innerHTML = `
      ${id === turnId ? '<div style="color:lime; font-weight:bold;">Current Turn</div>' : ''}
      <strong>${p.name}</strong>
      <div>🌀 ${p.resonance} | ❤️ ${p.stability}</div>
      <div>🍷 Drinks: ${p.drinkCount || 0}</div>
    `;
    otherPlayersDiv.appendChild(div);
  });
  if (targeting) enableTargeting();
}

// --- Targeting helpers ---
function enableTargeting() {
  document.querySelectorAll('.playerBox').forEach(div => {
    const id = div.dataset.playerId;
    const p = latestOtherPlayers[id];
    if (!p || !p.alive) return;
    div.classList.add('targetable'); div.style.cursor = 'pointer';
    div.onclick = () => {
      if (!selectedCard) return showMessage('No card selected');
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
    selectedCard = null; targeting = false; highlightTargets(false);
    showMessage('Targeting cancelled (turn changed or card unavailable).');
  }
}

// --- History panel handlers ---
if (historyBtn && historyPanel && closeHistoryBtn) {
  historyBtn.onclick = () => { historyPanel.classList.toggle('hidden'); historyPanel.classList.toggle('visible'); };
  closeHistoryBtn.onclick = () => { historyPanel.classList.add('hidden'); historyPanel.classList.remove('visible'); };
}

console.log('Resonance Duel client (final merged) ready.');
