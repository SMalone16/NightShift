const TILE_SIZE = 32;
const DAY_COLORS = {
  0: '#57b26e', // grass
  1: '#2b6b3e', // tree
  2: '#8a939d', // rock
  3: '#a76f3f', // stall
  4: '#9a8360', // path
  5: '#67bdd9', // checkpoint
  6: '#d1a23a', // objective
  7: '#b4844b', // chest
  99: '#000000', // hidden
};

const NIGHT_COLORS = {
  0: '#2f7d45', // grass
  1: '#1a4f2d', // tree
  2: '#6f7882', // rock
  3: '#8c5b32', // stall
  4: '#7d6a4f', // path
  5: '#3a96b8', // checkpoint
  6: '#b88e25', // objective
  7: '#966f3d', // chest
  99: '#000000', // hidden
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
  swapWeapon: false,
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
  inputState.swapWeapon = false;
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
  if (e.key.toLowerCase() === 'q') {
    inputState.swapWeapon = true;
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'w' || e.key === 'ArrowUp') inputState.up = false;
  if (e.key === 's' || e.key === 'ArrowDown') inputState.down = false;
  if (e.key === 'a' || e.key === 'ArrowLeft') inputState.left = false;
  if (e.key === 'd' || e.key === 'ArrowRight') inputState.right = false;
});


function getLightingMode() {
  return snapshot?.lightingMode === 'night' ? 'night' : 'day';
}


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getMapDimensions(map) {
  return {
    width: map.worldWidth || map.width,
    height: map.worldHeight || map.height,
  };
}

function getCamera(map, me) {
  const dims = getMapDimensions(map);
  const worldPixelWidth = dims.width * TILE_SIZE;
  const worldPixelHeight = dims.height * TILE_SIZE;
  const targetX = me.x * TILE_SIZE - canvas.width / 2;
  const targetY = me.y * TILE_SIZE - canvas.height / 2;

  return {
    x: clamp(targetX, 0, Math.max(0, worldPixelWidth - canvas.width)),
    y: clamp(targetY, 0, Math.max(0, worldPixelHeight - canvas.height)),
  };
}

function worldToScreen(worldX, worldY, camera) {
  return {
    x: worldX * TILE_SIZE - camera.x,
    y: worldY * TILE_SIZE - camera.y,
  };
}

function isOnScreen(screenX, screenY, padding = 0) {
  return (
    screenX >= -padding
    && screenY >= -padding
    && screenX <= canvas.width + padding
    && screenY <= canvas.height + padding
  );
}

function getCurrentZone(map, me) {
  if (!Array.isArray(map.zones)) return null;
  return map.zones.find((zone) => (
    me.x >= zone.x1
    && me.x <= zone.x2
    && me.y >= zone.y1
    && me.y <= zone.y2
  )) || null;
}

function drawZoneOverlay(map, me, camera) {
  const zone = getCurrentZone(map, me);
  if (!zone) return;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(12, 12, 230, 64);
  ctx.fillStyle = '#e8edf5';
  ctx.font = '13px sans-serif';
  ctx.fillText(`Zone: ${zone.label}`, 20, 34);

  const hints = [];
  const nearLeft = me.x - 2 <= zone.x1;
  const nearRight = me.x + 2 >= zone.x2;
  const nearTop = me.y - 2 <= zone.y1;
  const nearBottom = me.y + 2 >= zone.y2;
  if (nearLeft) hints.push('⬅ edge');
  if (nearRight) hints.push('edge ➡');
  if (nearTop) hints.push('⬆ edge');
  if (nearBottom) hints.push('edge ⬇');

  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#b8c7dd';
  ctx.fillText(hints.length ? hints.join(' • ') : 'Explore to discover nearby zones.', 20, 56);
  ctx.restore();

  if (camera.x <= 8 || camera.y <= 8) {
    ctx.save();
    ctx.strokeStyle = 'rgba(163, 211, 255, 0.7)';
    ctx.lineWidth = 2;
    if (camera.x <= 8) {
      ctx.beginPath();
      ctx.moveTo(4, canvas.height / 2 - 16);
      ctx.lineTo(4, canvas.height / 2 + 16);
      ctx.stroke();
    }
    if (camera.y <= 8) {
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2 - 16, 4);
      ctx.lineTo(canvas.width / 2 + 16, 4);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function render() {
  if (!snapshot) return;
  const map = snapshot.map;
  const me = snapshot.players.find((p) => p.id === selfId);
  if (!me) return;

  const lightingMode = getLightingMode();
  const tileColors = lightingMode === 'night' ? NIGHT_COLORS : DAY_COLORS;
  const camera = getCamera(map, me);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (lightingMode === 'day') {
    ctx.fillStyle = '#b9e5ff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const minTileX = Math.max(0, Math.floor(camera.x / TILE_SIZE));
  const maxTileX = Math.min(map.width - 1, Math.ceil((camera.x + canvas.width) / TILE_SIZE));
  const minTileY = Math.max(0, Math.floor(camera.y / TILE_SIZE));
  const maxTileY = Math.min(map.height - 1, Math.ceil((camera.y + canvas.height) / TILE_SIZE));

  for (let y = minTileY; y <= maxTileY; y += 1) {
    for (let x = minTileX; x <= maxTileX; x += 1) {
      const tile = map.tiles[y]?.[x] ?? 99;
      const screen = worldToScreen(x, y, camera);
      ctx.fillStyle = tileColors[tile] || '#000';
      ctx.fillRect(screen.x, screen.y, TILE_SIZE, TILE_SIZE);

      if (tile === 5) {
        ctx.fillStyle = 'rgba(180,240,255,0.25)';
        ctx.fillRect(screen.x, screen.y, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  snapshot.projectiles.forEach((proj) => {
    const screen = worldToScreen(proj.x, proj.y, camera);
    if (!isOnScreen(screen.x, screen.y, 12)) return;
    ctx.fillStyle = '#e8e39c';
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  snapshot.enemies.forEach((enemy) => {
    const screen = worldToScreen(enemy.x, enemy.y, camera);
    if (!isOnScreen(screen.x, screen.y, 20)) return;
    const stunned = enemy.stunnedUntil > Date.now() / 1000;
    ctx.fillStyle = stunned ? '#c47dfa' : '#c53939';
    ctx.fillRect(screen.x - 10, screen.y - 10, 20, 20);
  });

  snapshot.players.forEach((player) => {
    const isSelf = player.id === selfId;
    const screen = worldToScreen(player.x, player.y, camera);
    if (!isOnScreen(screen.x, screen.y, 24)) return;

    ctx.fillStyle = isSelf ? '#4ec3ff' : '#f7f7f7';
    if (player.tagged) ctx.fillStyle = '#ffb26a';
    ctx.fillRect(screen.x - 9, screen.y - 9, 18, 18);

    const dirX = player.facingX ?? 1;
    const dirY = player.facingY ?? 0;
    const mag = Math.hypot(dirX, dirY) || 1;
    const tipX = screen.x + (dirX / mag) * 14;
    const tipY = screen.y + (dirY / mag) * 14;
    ctx.strokeStyle = isSelf ? '#004d73' : '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(screen.x, screen.y);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    ctx.fillStyle = '#10151d';
    ctx.font = '12px sans-serif';
    ctx.fillText(player.username, screen.x - 20, screen.y - 12);
  });

  if (lightingMode === 'night' && snapshot.visionRadius) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const center = worldToScreen(me.x, me.y, camera);
    const radiusPx = snapshot.visionRadius * TILE_SIZE;
    const gradient = ctx.createRadialGradient(
      center.x,
      center.y,
      radiusPx * 0.25,
      center.x,
      center.y,
      radiusPx
    );
    gradient.addColorStop(0, 'rgba(255, 245, 200, 0.05)');
    gradient.addColorStop(1, 'rgba(255, 245, 200, 0.35)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  drawZoneOverlay(map, me, camera);
}

function renderHud() {
  if (!snapshot) return;
  const me = snapshot.players.find((p) => p.id === selfId);
  if (!me) return;

  const lightingMode = getLightingMode();
  const phaseLabel = lightingMode === 'day' ? 'DAY' : 'NIGHT';
  phaseInfo.innerHTML = `<strong>Cycle:</strong> ${phaseLabel} | <strong>Time:</strong> ${snapshot.timer}s`;
  playerInfo.innerHTML = `<strong>${me.username}</strong> — XP ${me.xp}, Level ${me.level}`;
  inventoryInfo.innerHTML = `
    <strong>Inventory</strong><br>
    wood: ${me.inventory.wood} | stone: ${me.inventory.stone}<br>
    cloth: ${me.inventory.cloth} | oil: ${me.inventory.oil} | pebbles: ${me.inventory.pebbles}
  `;
  const selectedWeaponLabel = me.selectedWeapon === 'slingshot' ? 'Slingshot' : 'Bat';
  const flashlightStatus = lightingMode === 'night' ? `Active (range T${me.gear.torch})` : 'Standby (daylight)';
  gearInfo.innerHTML = `<strong>Gear</strong><br>Torch T${me.gear.torch} | Bat T${me.gear.bat} | Slingshot T${me.gear.slingshot}<br><strong>Flashlight:</strong> ${flashlightStatus}<br><strong>Selected:</strong> ${selectedWeaponLabel} (Q to swap)`;

  const everyone = snapshot.players
    .map((p) => `${p.objectiveReached ? '✅' : '⬜'} ${p.username}`)
    .join('<br>');
  teamInfo.innerHTML = `<strong>Objective status</strong><br>${everyone}`;

  eventsList.innerHTML = snapshot.events.map((ev) => `<li>${ev.message}</li>`).join('');
}
