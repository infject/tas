// === Resonance Duel - Live Enhanced Client ===
const socket = io();

// --- Config ---
const DRAW_COST = 1;
const POTION_RESONANCE = 1;

// --- Audio Assets ---
const sounds = {
  bg: new Audio('/assets/bg_music.mp3'),
  click: new Audio('/assets/click.wav'),
  draw: new Audio('/assets/draw.wav'),
  play: new Audio('/assets/play.wav'),
  potion: new Audio('/assets/potion.wav'),
  win: new Audio('/assets/win.mp3'),
  lose: new Audio('/assets/lose.mp3')
};
sounds.bg.loop = true;
sounds.bg.volume = 0.35;

let musicEnabled = true;
function toggleMusic(forceOff = false) {
  if (forceOff || musicEnabled) {
    Object.values(sounds).forEach(s => { if (!s.paused) s.pause(); });
    musicEnabled = false;
  } else {
    sounds.bg.play().catch(()=>{});
    musicEnabled = true;
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
let readyClicked=false,countdownTimer=null,countdownValue=10;

// --- Helpers ---
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}

// --- Controls enable/disable ---
function disableGameControls(){drawBtn.disabled=true;potionBtn.disabled=true;endTurnBtn.disabled=true;
  yourHandDiv.style.pointerEvents="none";}
function enableGameControls(){if(!latestYourData)return;
  drawBtn.disabled=latestYourData.resonance<DRAW_COST;
  potionBtn.disabled=latestYourData.potionCharges<=0;
  endTurnBtn.disabled=false;yourHandDiv.style.pointerEvents="auto";}

// --- Sounds on button press ---
[startBtn,createBtn,joinBtn,drawBtn,potionBtn,endTurnBtn].forEach(btn=>{
  if(btn)btn.addEventListener('click',()=>{if(musicEnabled)sounds.click.play().catch(()=>{});});
});

// --- Ready System ---
const readyBtn=document.createElement('button');
readyBtn.textContent="I'm Ready!";
readyBtn.style.cssText="margin-top:20px;padding:10px 20px;font-size:1.2em;";
lobbyDiv.appendChild(readyBtn);
readyBtn.onclick=()=>{
  if(readyClicked)return;
  readyClicked=true;
  socket.emit('player_ready',currentRoom);
  readyBtn.textContent="Ready ✓";
  readyBtn.disabled=true;
  if(musicEnabled)sounds.click.play().catch(()=>{});
};

// === Buttons ===
startBtn.onclick=()=>{rulesDiv.classList.add('hidden');lobbyDiv.classList.remove('hidden');
  sounds.bg.play().catch(()=>{});};
createBtn.onclick=()=>{const code=roomCodeInput.value.trim();
  const pass=passwordInput.value.trim();const name=nameInput.value.trim();
  if(!code||!name)return showMessage("Enter room code and name");
  socket.emit('createRoom',code,pass,name);};
joinBtn.onclick=()=>{const code=roomCodeInput.value.trim();
  const pass=passwordInput.value.trim();const name=nameInput.value.trim();
  if(!code||!name)return showMessage("Enter room code and name");
  socket.emit('joinRoom',code,pass,name);};
drawBtn.onclick=()=>{if(!latestYourData||latestYourData.resonance<DRAW_COST)
    return showMessage(`Need ${DRAW_COST} resonance to draw`);
  socket.emit('drawCard',currentRoom);if(musicEnabled)sounds.draw.play().catch(()=>{});};
potionBtn.onclick=()=>{if(!latestYourData||latestYourData.potionCharges<=0)
    return showMessage("No potion charges left!");
  socket.emit('drinkPotion',currentRoom);if(musicEnabled)sounds.potion.play().catch(()=>{});};
endTurnBtn.onclick=()=>{socket.emit('endTurn',currentRoom);if(musicEnabled)sounds.click.play().catch(()=>{});};

// === Socket Events ===
socket.on('connect',()=>mySocketId=socket.id);
socket.on('errorMessage',showMessage);
socket.on('info',showToast);

// joined room
socket.on('roomJoined',room=>{
  currentRoom=room;lobbyDiv.classList.add('hidden');
  gameDiv.classList.remove('hidden');showOverlay('Waiting for players...');
  waitingForPlayers=true;disableGameControls();
});

// --- ready feedback and countdown ---
socket.on('waiting_for_players',()=>{waitingForPlayers=true;showOverlay('Waiting for players...');disableGameControls();});
socket.on('ready_status',list=>{
  const readyCount=list.filter(x=>x.ready).length;
  const total=list.length;
  showOverlay(`Ready players: ${readyCount}/${total}`);
});
socket.on('countdown_start',()=>{
  countdownValue=10;
  clearInterval(countdownTimer);
  showOverlay(`🎲 Duel begins in ${countdownValue}s`);
  countdownTimer=setInterval(()=>{
    countdownValue--;
    if(countdownValue<=0){clearInterval(countdownTimer);}
    overlayText.textContent=`🎲 Duel begins in ${countdownValue}s`;
  },1000);
});
socket.on('dice_winner',name=>{
  overlayText.textContent=`🎲 ${name} wins the dice roll!`;
});
socket.on('countdown_end',()=>{
  hideOverlay();enableGameControls();
});

// === update events continue in Part 2 → ===
// === Game Updates ===
socket.on('update', data => {
  if (!data.yourData) return;
  latestYourData = data.yourData;
  latestOtherPlayers = data.otherPlayers;
  deckSize = data.deckSize;
  const isMyTurn = data.turnId === socket.id;

  if (gamePaused) { disableGameControls(); return; }

  updateTurnIndicator(data.turnId);
  updateButtons(isMyTurn);
  updateYourStats(latestYourData);
  renderHand(latestYourData.hand, isMyTurn);
  renderTable(data.table);
  renderOtherPlayers(latestOtherPlayers, data.turnId);
  cancelTargetingIfNeeded(isMyTurn);
});

socket.on('actionDenied', data => {
  if (data && data.reason) showToast(data.reason);
});
socket.on('hand_full', ({ msg }) => showToast(msg || "You can’t hold more than 6 cards."));
socket.on('playerTargeted', ({ targetId, by }) => {
  const byName = latestOtherPlayers[by]?.name || "Someone";
  const targetName = latestOtherPlayers[targetId]?.name || "a player";
  showToast(`🌀 ${byName} targeted ${targetName}!`);
});

// === Win / Lose ===
socket.on('you_win', () => {
  gamePaused = true;
  showOverlay('🏆 You Win! 🏆');
  if (musicEnabled) {
    sounds.bg.pause();
    sounds.win.play().catch(()=>{});
  }
  disableGameControls();
});
socket.on('you_lose', () => {
  gamePaused = true;
  showOverlay('💀 You Lose 💀');
  if (musicEnabled) {
    sounds.bg.pause();
    sounds.lose.play().catch(()=>{});
  }
  disableGameControls();
});

// === UI update functions ===
function updateTurnIndicator(turnId) {
  const n = (turnId === mySocketId)
    ? "⭐ Your Turn ⭐"
    : (latestOtherPlayers[turnId]?.name || "Unknown");
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
  if (hand.length > 8) yourHandDiv.classList.add('compact');
  else yourHandDiv.classList.remove('compact');
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
function handleCardClick(card, isMyTurn) {
  if (!isMyTurn) return showMessage("Not your turn!");
  if (waitingForPlayers || gamePaused) return showMessage("Game not active yet!");
  if (card.cost > latestYourData.resonance) return showMessage("Not enough resonance!");
  if (musicEnabled) sounds.play.play().catch(()=>{});

  const targeted = [
    "Echo Drain","Layer Shift","Timeline Lock","Disarmonia Attack","Unseen Echo",
    "Anchor Stone","Collapse","Echo Trap","Layer Fusion","Dissolve",
    "Resonance Burst","Spectral Break","Overtone Slash","Mind Fracture","Void Torrent"
  ];
  if (targeted.includes(card.name)) {
    selectedCard = card; targeting = true;
    showMessage(`Select a target for ${card.name}`); enableTargeting();
  } else {
    socket.emit('playCard',{roomCode:currentRoom,cardId:card.id});
  }
}

// === Table / history ===
function renderTable(table) {
  if (!historyContent) return;
  historyContent.innerHTML="";
  table.slice().reverse().forEach(entry=>{
    const d=document.createElement('div');
    d.className='history-entry';
    d.textContent=`${entry.card.name} (${entry.card.type}) by ${entry.ownerName}`;
    historyContent.appendChild(d);
  });
}
if(historyBtn&&closeHistoryBtn){
  historyBtn.onclick=()=>{
    historyPanel.classList.toggle('hidden');
    historyPanel.classList.toggle('visible');
  };
  closeHistoryBtn.onclick=()=>{
    historyPanel.classList.add('hidden');
    historyPanel.classList.remove('visible');
  };
}

// === Other players display ===
function renderOtherPlayers(players, turnId){
  otherPlayersDiv.innerHTML="";
  Object.entries(players).forEach(([id,p])=>{
    const div=document.createElement('div');
    div.className='playerBox';
    div.dataset.playerId=id;
    div.innerHTML=`
      ${id===turnId?'<div style="color:lime;">Current Turn</div>':''}
      <strong>${p.name}</strong>
      <div>🌀 ${p.resonance} | ❤️ ${p.stability}</div>
      <div>🍷 ${p.drinkCount||0}</div>`;
    otherPlayersDiv.appendChild(div);
  });
  if(targeting)enableTargeting();
}

// === Targeting helpers ===
function enableTargeting(){
  document.querySelectorAll('.playerBox').forEach(div=>{
    const id=div.dataset.playerId;const p=latestOtherPlayers[id];
    if(!p||!p.alive)return;
    div.classList.add('targetable');div.style.cursor='pointer';
    div.onclick=()=>{
      socket.emit('playCard',{roomCode:currentRoom,cardId:selectedCard.id,targetId:id});
      targeting=false;selectedCard=null;highlightTargets(false);
    };
  });
  highlightTargets(true);
}
function highlightTargets(on){
  document.querySelectorAll('.playerBox').forEach(div=>{
    div.style.outline=(on&&div.classList.contains('targetable'))?'3px solid yellow':'none';
  });
}
function cancelTargetingIfNeeded(isMyTurn){
  if(!targeting)return;
  let cancel=!isMyTurn||(selectedCard&&!latestYourData.hand.some(c=>c.id===selectedCard.id));
  if(cancel){
    selectedCard=null;targeting=false;highlightTargets(false);
    showMessage("Targeting cancelled.");
  }
}

// === Mute toggle ===
const muteBtn=document.createElement('button');
muteBtn.textContent="🔊 Mute";
muteBtn.style.cssText="position:fixed;bottom:10px;right:10px;padding:5px 10px;";
document.body.appendChild(muteBtn);
muteBtn.onclick=()=>{
  if(musicEnabled){toggleMusic(true);muteBtn.textContent="🔈 Unmute";}
  else{toggleMusic(false);muteBtn.textContent="🔊 Mute";}
};

// === End of Client ===
console.log("Resonance Duel client ready.");
