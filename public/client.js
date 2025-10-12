// === Resonance Duel - Live Enhanced Client (Fixed) ===
const socket = io();

// --- Config ---
const DRAW_COST = 1;
const POTION_RESONANCE = 1;
const COUNTDOWN_SECONDS_DEFAULT = 10;

// --- Audio Assets (mapped to the actual files in /public/assets/) ---
const SFX_FILES = {
  bg: '/assets/bg_arcade.mp3',            // your background music file (was bg_arcade.mp3)
  click: '/assets/card_shuffle.mp3',      // small click -> reuse shuffle if you don't have click
  draw: '/assets/card_draw.mp3',
  play: '/assets/game_start.mp3',         // play / game start stinger reused here
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
  const a = new Audio(url);
  a.preload = 'auto';
  // keep low default volumes for some
  if (k === 'bg') a.volume = 0.35;
  else a.volume = 0.7;
  sounds[k] = a;
}

// ensure background loops
if (sounds.bg) sounds.bg.loop = true;

let musicEnabled = true;
function toggleMusic(forceOff = false) {
  if (forceOff) {
    // force off
    Object.values(sounds).forEach(s => { try { s.pause(); } catch(e){} });
    musicEnabled = false;
  } else {
    musicEnabled = !musicEnabled;
    if (musicEnabled) {
      // play bg as user expects (catch)
      try { sounds.bg.currentTime = 0; sounds.bg.play().catch(()=>{}); } catch(e) {}
    } else {
      Object.values(sounds).forEach(s => { try { s.pause(); } catch(e){} });
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

// --- Overlay (for waiting / countdown / win-lose) ---
let overlayDiv = document.createElement('div');
overlayDiv.id = "overlayDiv";
overlayDiv.style.cssText = `
  position:fixed;inset:0;display:none;
  justify-content:center;align-items:center;
  background:rgba(0,0,0,0.85);color:#fff;
  font-size:2em;z-index:2000;text-align:center;
`;
overlayDiv.innerHTML = `<div id="overlayText">Waiting...</div>`;
document.body.appendChild(overlayDiv);
const overlayText = document.getElementById('overlayText');
function showOverlay(text) { overlayText.textContent = text; overlayDiv.style.display='flex'; }
function hideOverlay() { overlayDiv.style.display='none'; }

// --- Message Toast ---
const messageDiv = document.createElement('div');
messageDiv.id = "messageDiv";
messageDiv.style.cssText = `
  position:absolute;top:10px;left:50%;
  transform:translateX(-50%);
  background:#222;color:#fff;
  padding:10px;border-radius:5px;
  display:none;z-index:3000;
`;
document.body.appendChild(messageDiv);
function showMessage(msg, dur=3000){ messageDiv.textContent=msg; messageDiv.style.display='block';
  clearTimeout(showMessage._t); showMessage._t=setTimeout(()=>messageDiv.style.display='none',dur);
}
function showToast(m,d=2000){showMessage(m,d);}

// --- Mobile zoom reset ---
function resetMobileView(){
  if(window.innerWidth<=768&&window.matchMedia("(orientation: portrait)").matches){
    document.body.style.zoom="100%";document.body.style.transform="scale(1)";
    document.body.style.transformOrigin="0 0";window.scrollTo(0,0);
    setTimeout(()=>window.scrollTo(0,0),150);
  }
}
window.matchMedia("(orientation: portrait)").addEventListener("change",resetMobileView);

// --- State ---
let currentRoom=null,selectedCard=null,targeting=false,mySocketId=null;
let deckSize=0,latestYourData=null,latestOtherPlayers={};
let waitingForPlayers=false,gamePaused=false;
let readyClicked=false,countdownTimer=null,countdownValue=COUNTDOWN_SECONDS_DEFAULT;

// --- Helpers ---
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}

// --- Controls enable/disable ---
function disableGameControls(){drawBtn.disabled=true;potionBtn.disabled=true;endTurnBtn.disabled=true;
  yourHandDiv.style.pointerEvents="none";}
function enableGameControls(){if(!latestYourData)return;
  drawBtn.disabled=latestYourData.resonance<DRAW_COST;
  potionBtn.disabled=latestYourData.potionCharges<=0;
  endTurnBtn.disabled=false;yourHandDiv.style.pointerEvents="auto";}

// --- Sounds on button press (play only after unlock) ---
[startBtn,createBtn,joinBtn,drawBtn,potionBtn,endTurnBtn].forEach(btn=>{
  if(btn)btn.addEventListener('click',()=>{
    if (musicEnabled && sounds.click) sounds.click.play().catch(()=>{});
  });
});

// --- Audio unlock on first user interaction ---
// This ensures browser allows playback of created Audio objects.
function unlockAudioOnFirstGesture() {
  function onceUnlock() {
    try {
      // attempt to play then pause quickly to unlock audio context
      Object.values(sounds).forEach((a) => {
        try {
          a.play().then(()=>a.pause()).catch(()=>{});
        } catch(e){}
      });
    } catch(e){}
    document.removeEventListener('pointerdown', onceUnlock);
    document.removeEventListener('keydown', onceUnlock);
  }
  document.addEventListener('pointerdown', onceUnlock, { once: true });
  document.addEventListener('keydown', onceUnlock, { once: true });
}
unlockAudioOnFirstGesture();

// --- Ready System ---
// NOTE: server expects 'toggleReady' event (not 'player_ready'), so emit toggleReady
const readyBtn = document.createElement('button');
readyBtn.id = 'readyBtn';
readyBtn.textContent = "I'm Ready!";
readyBtn.style.cssText = "margin-top:20px;padding:10px 20px;font-size:1.2em;";
readyBtn.classList.add('hidden'); // we'll unhide on roomJoined
lobbyDiv.appendChild(readyBtn);

readyBtn.onclick = () => {
  // send toggleReady (server-side expects this exact event name)
  if (readyClicked) return;
  readyClicked = true;
  socket.emit('toggleReady', currentRoom);
  readyBtn.textContent = "Ready ✓";
  readyBtn.disabled = true;
  if (musicEnabled && sounds.click) sounds.click.play().catch(()=>{});
};

// === Buttons ===
startBtn.onclick = () => {
  rulesDiv.classList.add('hidden'); lobbyDiv.classList.remove('hidden');
  // play bg on user gesture
  if (musicEnabled && sounds.bg) {
    try { sounds.bg.currentTime = 0; sounds.bg.play().catch(()=>{}); } catch(e){}
  }
};

createBtn.onclick = () => {
  const code = roomCodeInput.value.trim();
  const pass = passwordInput.value.trim();
  const name = nameInput.value.trim();
  if (!code || !name) return showMessage("Enter room code and name");
  socket.emit('createRoom', code, pass, name);
};

joinBtn.onclick = () => {
  const code = roomCodeInput.value.trim();
  const pass = passwordInput.value.trim();
  const name = nameInput.value.trim();
  if (!code || !name) return showMessage("Enter room code and name");
  socket.emit('joinRoom', code, pass, name);
};

drawBtn.onclick = () => {
  if (!latestYourData || latestYourData.resonance < DRAW_COST) return showMessage(`Need ${DRAW_COST} resonance to draw`);
  socket.emit('drawCard', currentRoom);
  if (musicEnabled && sounds.draw) sounds.draw.play().catch(()=>{});
};

potionBtn.onclick = () => {
  if (!latestYourData || latestYourData.potionCharges <= 0) return showMessage("No potion charges left!");
  socket.emit('drinkPotion', currentRoom);
  if (musicEnabled && sounds.potion) sounds.potion.play().catch(()=>{});
};

endTurnBtn.onclick = () => {
  socket.emit('endTurn', currentRoom);
  if (musicEnabled && sounds.click) sounds.click.play().catch(()=>{});
};

// === Socket Events ===
socket.on('connect', () => mySocketId = socket.id);
socket.on('errorMessage', showMessage);
socket.on('info', showToast);

// room joined event: unhide ready button (if present), switch views
socket.on('roomJoined', room => {
  currentRoom = room;
  lobbyDiv.classList.add('hidden');
  gameDiv.classList.remove('hidden');
  showOverlay('Waiting for players...');
  waitingForPlayers = true;
  disableGameControls();

  // unhide ready button in lobby (if it was hidden)
  if (readyBtn) readyBtn.classList.remove('hidden');
});

// --- READY / COUNTDOWN / DICE / START HANDLERS ---
// server emits: readyState, countdownStarted, countdownCancelled, diceRolling, diceResults, gameStarted

socket.on('readyState', (payload) => {
  // payload: { ready: { socketId: true/false, ... } } or similar
  // Normalize and display a simple count
  let readyMap = payload && payload.ready ? payload.ready : payload;
  const entries = Object.entries(readyMap || {});
  const readyCount = entries.filter(([id, val]) => !!val).length;
  const total = entries.length || 0;
  showOverlay(`Ready players: ${readyCount}/${total}`);
  // keep controls disabled until game actually starts
  disableGameControls();
});

socket.on('countdownStarted', ({ endsAt, countdownMs } = {}) => {
  // compute seconds remaining from endsAt if provided
  const now = Date.now();
  const secondsLeft = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : (countdownMs ? Math.ceil(countdownMs / 1000) : COUNTDOWN_SECONDS_DEFAULT);
  countdownValue = secondsLeft;
  clearInterval(countdownTimer);

  // visual
  overlayDiv.classList.add('countdown-active');
  showOverlay(`🎲 Duel begins in ${countdownValue}s`);
  // play start beep once
  if (musicEnabled && sounds.countdownStart) sounds.countdownStart.play().catch(()=>{});

  countdownTimer = setInterval(() => {
    countdownValue--;
    if (countdownValue <= 0) {
      clearInterval(countdownTimer);
    }
    // tick sound each second if enabled
    if (musicEnabled && sounds.countdownTick) sounds.countdownTick.play().catch(()=>{});
    overlayText.textContent = `🎲 Duel begins in ${Math.max(0, countdownValue)}s`;
  }, 1000);
});

socket.on('countdownCancelled', ({ reason } = {}) => {
  clearInterval(countdownTimer);
  overlayDiv.classList.remove('countdown-active');
  showOverlay('Countdown cancelled');
  setTimeout(() => { if (!waitingForPlayers) hideOverlay(); }, 1200);
});

socket.on('diceRolling', () => {
  // play dice rollover sfx
  if (musicEnabled && sounds.dice) sounds.dice.play().catch(()=>{});
  overlayDiv.classList.add('dice-rolling');
  showOverlay('Rolling dice...');
});

socket.on('diceResults', ({ rolls, winnerId } = {}) => {
  // highlight winner name when provided
  const winnerName = (winnerId && latestOtherPlayers[winnerId] && latestOtherPlayers[winnerId].name) || (winnerId === mySocketId ? (latestYourData && latestYourData.name) : null) || 'Player';
  overlayDiv.classList.remove('dice-rolling');
  overlayDiv.classList.add('dice-announce');
  overlayText.textContent = `🎲 ${winnerName} wins the roll!`;

  // small visual pause, then clear overlay at gameStarted
});

socket.on('gameStarted', ({ firstPlayerId, order } = {}) => {
  // show game start stinger
  if (musicEnabled && sounds.play) sounds.play.play().catch(()=>{});
  overlayDiv.classList.remove('countdown-active', 'dice-announce', 'dice-rolling');
  hideOverlay();
  enableGameControls();
  waitingForPlayers = false;
});

// --- Generic update flow ---
socket.on('update', data => {
  if (!data || !data.yourData) return;

  latestYourData = data.yourData;
  latestOtherPlayers = data.otherPlayers || {};
  deckSize = data.deckSize;
  const isMyTurn = data.turnId === socket.id;

  // If waiting overlay is active and we now have 2+ players, remove it
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

// --- Other socket feedback events ---
socket.on('actionDenied', d => { if (d && d.reason) showToast(d.reason); });
socket.on('hand_full', ({ msg }) => showToast(msg || "You can’t hold more than 6 cards."));
socket.on('playerTargeted', ({ targetId, by }) => {
  const byName = latestOtherPlayers[by]?.name || "Someone";
  const tname = latestOtherPlayers[targetId]?.name || "a player";
  showToast(`🌀 ${byName} targeted ${tname}!`);
});

// --- Win / Lose ---
socket.on('you_win', () => {
  gamePaused = true;
  showOverlay('🏆 You Win! 🏆');
  if (musicEnabled && sounds.bg) sounds.bg.pause();
  if (musicEnabled && sounds.win) sounds.win.play().catch(()=>{});
  disableGameControls();
});
socket.on('you_lose', () => {
  gamePaused = true;
  showOverlay('💀 You Lose 💀');
  if (musicEnabled && sounds.bg) sounds.bg.pause();
  if (musicEnabled && sounds.lose) sounds.lose.play().catch(()=>{});
  disableGameControls();
});

// === UI update functions ===
function updateTurnIndicator(turnId) {
  const n = (turnId === mySocketId) ? "⭐ Your Turn ⭐" : (latestOtherPlayers[turnId]?.name || "Unknown");
  turnIndicatorDiv.textContent = `Current Turn: ${n}`;
}
function updateButtons(isMyTurn) {
  if (waitingForPlayers || gamePaused) return disableGameControls();
  drawBtn.disabled = !isMyTurn || latestYourData.resonance < DRAW_COST;
  potionBtn.disabled = !isMyTurn || latestYourData.potionCharges <= 0;
  endTurnBtn.disabled = !isMyTurn;
}
function updateYourStats(your) {
  yourStatsDiv.innerHTML = `
    <h3>Your Stats</h3>
    <div>🧍 ${your.name}</div>
    <div>🌀 Resonance: ${your.resonance}</div>
    <div>❤️ Stability: ${your.stability}</div>
    <div>🃏 Deck: ${deckSize} cards remain | Draw cost: ${DRAW_COST}🌀</div>
    <div>🍷 Drinks: ${your.drinkCount || 0}</div>
  `;
}

// === Hand rendering ===
function renderHand(hand, isMyTurn) {
  yourHandDiv.innerHTML = "";
  if (!Array.isArray(hand)) hand = [];
  if (hand.length > 8) yourHandDiv.classList.add('compact'); else yourHandDiv.classList.remove('compact');
  hand.forEach((card, idx) => {
    const d = document.createElement('div');
    d.className = 'card';
    d.innerHTML = `
      <div class="type">${card.type}</div>
      <h4>${card.name}</h4>
      <p>${card.effect}</p>
      <div class="resonance">Cost: ${card.cost}🌀</div>`;
    d.style.animationDelay = (idx * 60) + 'ms';
    d.onclick = () => handleCardClick(card, isMyTurn);
    yourHandDiv.appendChild(d);
  });
}

// --- Card click / targeting ---
function handleCardClick(card, isMyTurn) {
  if (!isMyTurn) return showMessage("Not your turn!");
  if (waitingForPlayers || gamePaused) return showMessage("Game not active yet!");
  if (card.cost > latestYourData.resonance) return showMessage("Not enough resonance!");
  if (musicEnabled && sounds.play) sounds.play.play().catch(()=>{});

  const targeted = [
    "Echo Drain","Layer Shift","Timeline Lock","Disarmonia Attack","Unseen Echo",
    "Anchor Stone","Collapse","Echo Trap","Layer Fusion","Dissolve",
    "Resonance Burst","Spectral Break","Overtone Slash","Mind Fracture","Void Torrent"
  ];
  if (targeted.includes(card.name)) {
    selectedCard = card; targeting = true;
    showMessage(`Select a target for ${card.name}`); enableTargeting();
  } else {
    socket.emit('playCard', { roomCode: currentRoom, cardId: card.id });
  }
}

// === Table / history ===
function renderTable(table) {
  if (!historyContent) return;
  historyContent.innerHTML = "";
  (table || []).slice().reverse().forEach(entry => {
    const d = document.createElement('div');
    d.className = 'history-entry';
    d.textContent = `${entry.card.name} (${entry.card.type}) by ${entry.ownerName}`;
    historyContent.appendChild(d);
  });
}
if (historyBtn && closeHistoryBtn) {
  historyBtn.onclick = () => { historyPanel.classList.toggle('hidden'); historyPanel.classList.toggle('visible'); };
  closeHistoryBtn.onclick = () => { historyPanel.classList.add('hidden'); historyPanel.classList.remove('visible'); };
}

// === Other players display ===
function renderOtherPlayers(players, turnId) {
  otherPlayersDiv.innerHTML = "";
  Object.entries(players || {}).forEach(([id,p]) => {
    const div = document.createElement('div');
    div.className = 'playerBox';
    div.dataset.playerId = id;
    div.innerHTML = `
      ${id === turnId ? '<div style="color:lime;">Current Turn</div>' : ''}
      <strong>${p.name}</strong>
      <div>🌀 ${p.resonance} | ❤️ ${p.stability}</div>
      <div>🍷 ${p.drinkCount || 0}</div>`;
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
function highlightTargets(on) {
  document.querySelectorAll('.playerBox').forEach(div => {
    div.style.outline = (on && div.classList.contains('targetable')) ? '3px solid yellow' : 'none';
  });
}
function cancelTargetingIfNeeded(isMyTurn) {
  if (!targeting) return;
  let cancel = !isMyTurn || (selectedCard && !latestYourData.hand.some(c => c.id === selectedCard.id));
  if (cancel) {
    selectedCard = null; targeting = false; highlightTargets(false);
    showMessage("Targeting cancelled.");
  }
}

// === Mute toggle (fixed, appends a button) ===
const muteBtn = document.createElement('button');
muteBtn.textContent = "🔊 Mute";
muteBtn.style.cssText = "position:fixed;bottom:10px;right:10px;padding:5px 10px;z-index:3000;";
muteBtn.classList.add('mute-toggle');
document.body.appendChild(muteBtn);
muteBtn.onclick = () => {
  if (musicEnabled) { toggleMusic(true); muteBtn.textContent = "🔈 Unmute"; }
  else { toggleMusic(false); muteBtn.textContent = "🔊 Mute"; }
};

// --- Done ---
console.log("Resonance Duel client ready (fixed audio + ready handling).");
