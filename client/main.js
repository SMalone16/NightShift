const TILE_SIZE = 32;
const COLORS = {
  0: '#2f7d45', // grass
  1: '#1a4f2d', // tree
  2: '#6f7882', // rock
  3: '#8c5b32', // stall
  4: '#7d6a4f', // path
  5: '#3a96b8', // checkpoint
  6: '#b88e25', // objective
  7: '#966f3d', // chest
};

const joinPanel = document.getElementById('joinPanel');
const gamePanel = document.getElementById('gamePanel');
const usernameInput = document.getElementById('usernameInput');
const joinBtn = document.getElementById('joinBtn');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const phaseInfo = document.getElementById('phaseInfo');
const playerInfo = document.getElementById('playerInfo');
const inventoryInfo = document.getElementById('inventoryInfo');
const gearInfo = document.getElementById('gearInfo');
const teamInfo = document.getElementById('teamInfo');
const eventsList = document.getElementById('events');

let socket = null;
let selfId = null;
let snapshot = null;

const inputState = {
  up: false,
  down: false,
  left: false,
  right: false,
  craft: false,
  attack: false,
};

joinBtn.addEventListener('click', () => {
  const username = usernameInput.value.trim() || `Ranger-${Math.floor(Math.random() * 999)}`;
  connect(username);
});

function connect(username) {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'join', username }));
  });

  socket.addEventListener('message', (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === 'hello') {
      selfId = msg.clientId;
    }
    if (msg.type === 'joined') {
      selfId = msg.playerId;
      joinPanel.classList.add('hidden');
      gamePanel.classList.remove('hidden');
    }
    if (msg.type === 'snapshot') {
      snapshot = msg.snapshot;
      render();
      renderHud();
    }
  });
}

function sendInput() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'input', payload: inputState }));
  inputState.attack = false;
  inputState.craft = false;
}

setInterval(sendInput, 50);

window.addEventListener('keydown', (e) => {
  if (e.key === 'w' || e.key === 'ArrowUp') inputState.up = true;
  if (e.key === 's' || e.key === 'ArrowDown') inputState.down = true;
  if (e.key === 'a' || e.key === 'ArrowLeft') inputState.left = true;
  if (e.key === 'd' || e.key === 'ArrowRight') inputState.right = true;
  if (e.key.toLowerCase() === 'e') inputState.craft = true;
  if (e.code === 'Space') {
    inputState.attack = true;
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'w' || e.key === 'ArrowUp') inputState.up = false;
  if (e.key === 's' || e.key === 'ArrowDown') inputState.down = false;
  if (e.key === 'a' || e.key === 'ArrowLeft') inputState.left = false;
  if (e.key === 'd' || e.key === 'ArrowRight') inputState.right = false;
});

function render() {
  if (!snapshot) return;
  const map = snapshot.map;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const tile = map.tiles[y][x];
      ctx.fillStyle = COLORS[tile] || '#000';
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

      if (tile === 5) {
        ctx.fillStyle = 'rgba(180,240,255,0.25)';
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  snapshot.projectiles.forEach((proj) => {
    ctx.fillStyle = '#e8e39c';
    ctx.beginPath();
    ctx.arc(proj.x * TILE_SIZE, proj.y * TILE_SIZE, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  snapshot.enemies.forEach((enemy) => {
    const stunned = enemy.stunnedUntil > Date.now() / 1000;
    ctx.fillStyle = stunned ? '#c47dfa' : '#c53939';
    ctx.fillRect(enemy.x * TILE_SIZE - 10, enemy.y * TILE_SIZE - 10, 20, 20);
  });

  snapshot.players.forEach((player) => {
    const isSelf = player.id === selfId;
    ctx.fillStyle = isSelf ? '#4ec3ff' : '#f7f7f7';
    if (player.tagged) ctx.fillStyle = '#ffb26a';
    ctx.fillRect(player.x * TILE_SIZE - 9, player.y * TILE_SIZE - 9, 18, 18);

    ctx.fillStyle = '#10151d';
    ctx.font = '12px sans-serif';
    ctx.fillText(player.username, player.x * TILE_SIZE - 20, player.y * TILE_SIZE - 12);
  });

  // Chase darkness overlay with torch radius for self.
  if (snapshot.phase === 'chase') {
    const me = snapshot.players.find((p) => p.id === selfId);
    if (me) {
      const baseRadius = 120;
      const radius = baseRadius + me.gear.torch * 60;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.66)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      const gradient = ctx.createRadialGradient(me.x * TILE_SIZE, me.y * TILE_SIZE, 30, me.x * TILE_SIZE, me.y * TILE_SIZE, radius);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(me.x * TILE_SIZE, me.y * TILE_SIZE, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function renderHud() {
  if (!snapshot) return;
  const me = snapshot.players.find((p) => p.id === selfId);
  if (!me) return;

  phaseInfo.innerHTML = `<strong>Phase:</strong> ${snapshot.phase.toUpperCase()} | <strong>Time:</strong> ${snapshot.timer}s`;
  playerInfo.innerHTML = `<strong>${me.username}</strong> — XP ${me.xp}, Level ${me.level}`;
  inventoryInfo.innerHTML = `
    <strong>Inventory</strong><br>
    wood: ${me.inventory.wood} | stone: ${me.inventory.stone}<br>
    cloth: ${me.inventory.cloth} | oil: ${me.inventory.oil} | pebbles: ${me.inventory.pebbles}
  `;
  gearInfo.innerHTML = `<strong>Gear</strong><br>Torch T${me.gear.torch} | Bat T${me.gear.bat} | Slingshot T${me.gear.slingshot}`;

  const everyone = snapshot.players
    .map((p) => `${p.objectiveReached ? '✅' : '⬜'} ${p.username}`)
    .join('<br>');
  teamInfo.innerHTML = `<strong>Objective status</strong><br>${everyone}`;

  eventsList.innerHTML = snapshot.events.map((ev) => `<li>${ev.message}</li>`).join('');
}
