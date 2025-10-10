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

// --- State ---
let currentRoom = null;
let selectedCard = null;
let targeting = false;
let mySocketId = null;
let deckSize = 0;
let latestYourData = null;
let latestOtherPlayers = {}; // <-- store other players

// --- Helpers ---
function showMessage(msg, duration = 3000) {
  messageDiv.textContent = msg;
  messageDiv.style.display = "block";
  clearTimeout(showMessage._timeout);
  showMessage._timeout = setTimeout(() => messageDiv.style.display = "none", duration);
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

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

// --- Socket ---
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
  latestOtherPlayers = data.otherPlayers; // store for targeting
  deckSize = data.deckSize;
  const isMyTurn = data.turnId === socket.id;

  updateTurnIndicator(data.turnId);
  updateButtons(isMyTurn);
  updateYourStats(latestYourData);
  renderHand(latestYourData.hand, isMyTurn);
  renderTable(data.table);
  renderOtherPlayers(latestOtherPlayers, data.turnId);
  
  cancelTargetingIfNeeded(isMyTurn);
});

// --- UI Functions ---
function updateTurnIndicator(turnId) {
  const name = (turnId === mySocketId) ? "⭐ Your Turn ⭐" : (latestOtherPlayers[turnId]?.name || "Unknown");
  turnIndicatorDiv.textContent = `Current Turn: ${name}`;
}

function updateButtons(isMyTurn) {
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
    <div>🃏 Deck: ${deckSize} cards remaining (Draw cost: ${DRAW_COST} 🌀)</div>
    <div>🍷 Drinks taken: ${your.drinkCount || 0}</div>
    
  `;
}

function renderHand(hand, isMyTurn) {
  // Clear the container (no title text anymore)
  yourHandDiv.innerHTML = "";

  // Apply compact style only if needed
  if (hand.length > 8) yourHandDiv.classList.add('compact');
  else yourHandDiv.classList.remove('compact');

  // Ensure the scroll container resets position
  yourHandDiv.scrollLeft = 0;

  // Render each card inside the hand container
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

    // Animate entry (slightly staggered)
    cardDiv.classList.add('card-anim');
    cardDiv.style.animationDelay = (idx * 60) + 'ms';

    // Card interactivity
    cardDiv.onclick = () => handleCardClick(card, isMyTurn);
    cardDiv.onpointerenter = () => cardDiv.classList.add('active-scale');
    cardDiv.onpointerleave = () => cardDiv.classList.remove('active-scale');
    cardDiv.onfocus = () => cardDiv.classList.add('active-scale');
    cardDiv.onblur = () => cardDiv.classList.remove('active-scale');

    yourHandDiv.appendChild(cardDiv);
  });

  // === Horizontal drag scroll support ===
  let isDown = false;
  let startX;
  let scrollLeft;
  yourHandDiv.addEventListener('mousedown', e => {
    isDown = true;
    yourHandDiv.classList.add('dragging');
    startX = e.pageX - yourHandDiv.offsetLeft;
    scrollLeft = yourHandDiv.scrollLeft;
  });
  yourHandDiv.addEventListener('mouseleave', () => {
    isDown = false;
    yourHandDiv.classList.remove('dragging');
  });
  yourHandDiv.addEventListener('mouseup', () => {
    isDown = false;
    yourHandDiv.classList.remove('dragging');
  });
  yourHandDiv.addEventListener('mousemove', e => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - yourHandDiv.offsetLeft;
    const walk = (x - startX) * 1.5; // scroll speed
    yourHandDiv.scrollLeft = scrollLeft - walk;
  });
}




function handleCardClick(card, isMyTurn) {
  if (!isMyTurn) return showMessage("Not your turn!");

  // If already selecting a target...
  if (targeting) {
    // If same card clicked again -> cancel targeting (toggle)
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

  // Normal checks for starting targeting
  if (card.cost > latestYourData.resonance) return showMessage("Not enough resonance!");

  const targetRequired = [
    "Echo Drain","Layer Shift","Collapse","Frequency Swap",
    "Timeline Lock","Residual Echo","Layer Fusion"
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
  // Render into history content panel (history panel is toggled)
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
  if (playersCount > 4) otherPlayersDiv.classList.add('compact'); else otherPlayersDiv.classList.remove('compact');


  otherPlayersDiv.innerHTML = "";

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
    div.style.cursor = "default";
    div.onclick = null;
    div.classList.remove('targetable');

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

