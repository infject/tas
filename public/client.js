// === Resonance Duel - Enhanced Client ===
const socket = io();

// --- Config ---
const DRAW_COST = 1;
const POTION_RESONANCE = 1;

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
  background: rgba(0,0,0,0.8);
  color: white; font-size: 2em;
  display: none; justify-content: center; align-items: center;
  z-index: 2000; text-align: center;
`;
overlayDiv.innerHTML = `<div id="overlayText">Waiting...</div>`;
document.body.appendChild(overlayDiv);

function showOverlay(text) {
  const overlayText = document.getElementById('overlayText');
  overlayText.textContent = text || '';
  overlayDiv.style.display = 'flex';
}
function hideOverlay() {
  overlayDiv.style.display = 'none';
}

function showToast(msg, duration = 2500) {
  showMessage(msg, duration);
}

// --- Message popup ---
const messageDiv = document.createElement('div');
messageDiv.id = "messageDiv";
messageDiv.style.cssText = `
  position:absolute; top:10px; left:50%;
  transform:translateX(-50%);
  background:#222; color:#fff;
  padding:10px; border-radius:5px;
  display:none; z-index:1000;
`;
document.body.appendChild(messageDiv);

function showMessage(msg, duration = 3000) {
  messageDiv.textContent = msg;
  messageDiv.style.display = "block";
  clearTimeout(showMessage._timeout);
  showMessage._timeout = setTimeout(() => messageDiv.style.display = "none", duration);
}

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

// --- Helpers ---
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

// --- UI Lock/Unlock ---
function disableGameControls() {
  drawBtn.disabled = true;
  potionBtn.disabled = true;
  endTurnBtn.disabled = true;
  yourHandDiv.style.pointerEvents = "none";
}
function enableGameControls() {
  if (!latestYourData) return;
  drawBtn.disabled = latestYourData.resonance < DRAW_COST;
  potionBtn.disabled = latestYourData.potionCharges <= 0;
  endTurnBtn.disabled = false;
  yourHandDiv.style.pointerEvents = "auto";
}

// --- Event Handlers ---
startBtn.onclick = () => {
  rulesDiv.classList.add('hidden');
  lobbyDiv.classList.remove('hidden');
};

createBtn.onclick = () => {
  const roomCode = roomCodeInput.value.trim();
  const password = passwordInput.value.trim();
  const name = nameInput.value.trim();
  if (!roomCode || !name) return showMessage("Enter room code and name");
  socket.emit('createRoom', roomCode, password, name);
};

joinBtn.onclick = () => {
  const roomCode = roomCodeInput.value.trim();
  const password = passwordInput.value.trim();
  const name = nameInput.value.trim();
  if (!roomCode || !name) return showMessage("Enter room code and name");
  socket.emit('joinRoom', roomCode, password, name);
};

drawBtn.onclick = () => {
  if (!latestYourData || latestYourData.resonance < DRAW_COST) 
    return showMessage(`Need ${DRAW_COST} resonance to draw`);
  socket.emit('drawCard', currentRoom);
};

potionBtn.onclick = () => {
  if (!latestYourData || latestYourData.potionCharges <= 0) 
    return showMessage("No potion charges left!");
  socket.emit('drinkPotion', currentRoom);
};

endTurnBtn.onclick = () => socket.emit('endTurn', currentRoom);

// --- Socket Connections ---
socket.on('connect', () => mySocketId = socket.id);
socket.on('errorMessage', showMessage);
socket.on('info', showMessage);

socket.on('roomJoined', roomCode => {
  currentRoom = roomCode;
  lobbyDiv.classList.add('hidden');
  gameDiv.classList.remove('hidden');
});

socket.on('roomList', rooms => {
  roomListDiv.innerHTML = "";
  if (!rooms || rooms.length === 0) return roomListDiv.innerHTML = "<p>No rooms available</p>";
  rooms.forEach(room => {
    const div = document.createElement('div');
    div.textContent = `${room.code} | Players: ${room.playerCount}`;
    div.style.cssText = "border:1px solid #fff; margin:5px; padding:5px; cursor:pointer;";
    div.onclick = () => {
      roomCodeInput.value = room.code;
      const name = nameInput.value.trim();
      const password = passwordInput.value.trim();
      if (!name) return showMessage("Enter your name first");
      socket.emit('joinRoom', room.code, password, name);
    };
    roomListDiv.appendChild(div);
  });
});

// --- Game Updates ---
socket.on('update', data => {
  if (!data.yourData) return;

  latestYourData = data.yourData;
  latestOtherPlayers = data.otherPlayers;
  deckSize = data.deckSize;
  const isMyTurn = data.turnId === socket.id;

  // Hide waiting overlay once we have 2 or more players
  const totalPlayers = Object.keys(latestOtherPlayers).length + 1;
  if (totalPlayers >= 2 && waitingForPlayers) {
    waitingForPlayers = false;
    hideOverlay();
    gamePaused = false;
    enableGameControls();
  }

  if (gamePaused) {
    disableGameControls();
    return;
  }

  updateTurnIndicator(data.turnId);
  updateButtons(isMyTurn);
  updateYourStats(latestYourData);
  renderHand(latestYourData.hand, isMyTurn);
  renderTable(data.table);
  renderOtherPlayers(latestOtherPlayers, data.turnId);
  cancelTargetingIfNeeded(isMyTurn);
});

// --- New Server Events ---
socket.on('waiting_for_players', () => {
  waitingForPlayers = true;
  showOverlay('Waiting for players to join...');
  disableGameControls();
});

socket.on('actionDenied', data => {
  if (data && data.reason) showToast(data.reason);
});

socket.on('hand_full', ({ msg }) => {
  showToast(msg || "You can’t hold more than 6 cards.");
});

socket.on('playerTargeted', ({ targetId, by, cardId }) => {
  const byName = latestOtherPlayers[by]?.name || "Someone";
  const targetName = latestOtherPlayers[targetId]?.name || "a player";
  showToast(`🌀 ${byName} targeted ${targetName}!`);
});

socket.on('you_lose', () => {
  gamePaused = true;
  showOverlay('💀 You Lose 💀');
  disableGameControls();
});

socket.on('you_win', () => {
  gamePaused = true;
  showOverlay('🏆 You Win! 🏆');
  disableGameControls();
});

// --- UI Update Functions ---
function updateTurnIndicator(turnId) {
  const name = (turnId === mySocketId) ? "⭐ Your Turn ⭐" : (latestOtherPlayers[turnId]?.name || "Unknown");
  turnIndicatorDiv.textContent = `Current Turn: ${name}`;
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
    <div>🧍‍♂️ ${your.name}</div>
    <div>🌀 Resonance: ${your.resonance}</div>
    <div>❤️ Stability: ${your.stability}</div>
    <div>🃏 Deck: ${deckSize} cards remain | Draw cost: ${DRAW_COST} 🌀</div>
    <div>🍷 Drinks taken: ${your.drinkCount || 0}</div>
  `;
}

function renderHand(hand, isMyTurn) {
  yourHandDiv.innerHTML = "";
  if (hand.length > 8) yourHandDiv.classList.add('compact');
  else yourHandDiv.classList.remove('compact');

  yourHandDiv.scrollLeft = 0;

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
    cardDiv.classList.add('card-anim');
    cardDiv.style.animationDelay = (idx * 60) + 'ms';
    cardDiv.onclick = () => handleCardClick(card, isMyTurn);
    cardDiv.onpointerenter = () => cardDiv.classList.add('active-scale');
    cardDiv.onpointerleave = () => cardDiv.classList.remove('active-scale');
    yourHandDiv.appendChild(cardDiv);
  });

  // Drag-scroll for hand
  let isDown = false;
  let startX;
  let scrollLeft;
  yourHandDiv.addEventListener('mousedown', e => {
    isDown = true;
    yourHandDiv.classList.add('dragging');
    startX = e.pageX - yourHandDiv.offsetLeft;
    scrollLeft = yourHandDiv.scrollLeft;
  });
  yourHandDiv.addEventListener('mouseleave', () => { isDown = false; yourHandDiv.classList.remove('dragging'); });
  yourHandDiv.addEventListener('mouseup', () => { isDown = false; yourHandDiv.classList.remove('dragging'); });
  yourHandDiv.addEventListener('mousemove', e => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - yourHandDiv.offsetLeft;
    const walk = (x - startX) * 1.5;
    yourHandDiv.scrollLeft = scrollLeft - walk;
  });
}

function handleCardClick(card, isMyTurn) {
  if (!isMyTurn) return showMessage("Not your turn!");
  if (waitingForPlayers || gamePaused) return showMessage("Game not active yet!");

  if (targeting) {
    if (selectedCard && selectedCard.id === card.id) {
      selectedCard = null;
      targeting = false;
      highlightTargets(false);
      showMessage("Targeting cancelled.");
      return;
    } else {
      return showMessage("Already selecting a target. Click the selected card again to cancel.");
    }
  }

  if (card.cost > latestYourData.resonance) return showMessage("Not enough resonance!");

const targetRequired = [
  "Echo Drain", "Layer Shift", "Timeline Lock", "Disarmonia Attack",
  "Unseen Echo", "Anchor Stone", "Collapse", "Echo Trap",
  "Layer Fusion", "Dissolve", "Resonance Burst", "Spectral Break",
  "Overtone Slash", "Mind Fracture", "Void Torrent"
];

  if (targetRequired.includes(card.name)) {
    selectedCard = card;
    targeting = true;
    showMessage(`Select a target player for ${card.name}`);
    enableTargeting();
  } else {
    socket.emit('playCard', { roomCode: currentRoom, cardId: card.id });
  }
}

function renderTable(table) {
  if (historyContent) {
    historyContent.innerHTML = "";
    table.slice().reverse().forEach(entry => {
      const div = document.createElement('div');
      div.className = 'history-entry';
      div.textContent = `${entry.card.name} (${entry.card.type}) played by ${entry.ownerName}`;
      historyContent.appendChild(div);
    });
  }
}

// History panel controls
if (historyBtn && historyPanel && closeHistoryBtn) {
  historyBtn.onclick = () => {
    historyPanel.classList.toggle('hidden');
    historyPanel.classList.toggle('visible');
  };
  closeHistoryBtn.onclick = () => {
    historyPanel.classList.add('hidden');
    historyPanel.classList.remove('visible');
  };
}

function renderOtherPlayers(players, turnId) {
  otherPlayersDiv.innerHTML = "";
  const playersCount = Object.keys(players).length;
  if (playersCount > 4) otherPlayersDiv.classList.add('compact');
  else otherPlayersDiv.classList.remove('compact');

  Object.entries(players).forEach(([id, p]) => {
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

function enableTargeting() {
  const divs = document.querySelectorAll('.playerBox');
  divs.forEach(div => {
    const id = div.dataset.playerId;
    const p = latestOtherPlayers[id];
    if (!p || !p.alive) return;

    div.classList.add('targetable');
    div.style.cursor = "pointer";
    div.onclick = () => {
      socket.emit('playCard', { roomCode: currentRoom, cardId: selectedCard.id, targetId: id });
      targeting = false;
      selectedCard = null;
      highlightTargets(false);
    };
  });
  highlightTargets(true);
}

function highlightTargets(enable) {
  document.querySelectorAll('.playerBox').forEach(div => {
    if (enable && div.classList.contains('targetable')) div.style.outline = "3px solid yellow";
    else div.style.outline = "none";
  });
}

function cancelTargetingIfNeeded(isMyTurn) {
  if (!targeting) return;
  let cancel = false;
  if (!isMyTurn) cancel = true;
  else if (selectedCard) {
    const stillHas = latestYourData.hand.some(c => c.id === selectedCard.id);
    if (!stillHas) cancel = true;
  } else cancel = true;

  if (cancel) {
    selectedCard = null;
    targeting = false;
    highlightTargets(false);
    showMessage("Targeting cancelled (turn changed or card unavailable).");
  }
}
