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

const TILE = {
  GRASS: 0,
  TREE: 1,
  ROCK: 2,
  STALL: 3,
  PATH: 4,
  CHECKPOINT: 5,
  OBJECTIVE: 6,
  CHEST: 7,
};

const HIDDEN_TILE = 99;

const TILE_SPRITE_KEYS = {
  [TILE.TREE]: 'tree',
  [TILE.ROCK]: 'rock',
  [TILE.CHEST]: 'chestClosed',
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

const ASSETS = {
  tiles: {
    tree: 'assets/sprites/tiles/tree.png',
    rock: 'assets/sprites/tiles/rock.png',
    chestClosed: 'assets/sprites/tiles/chest_closed.png',
  },
  player: {
    idle: {
      down: 'assets/sprites/player/idle/down.png',
    },
    walk: {
      left: [
        'assets/sprites/player/walk/left_0.png',
        'assets/sprites/player/walk/left_1.png',
        'assets/sprites/player/walk/left_2.png',
      ],
    },
    slingshot: {
      fire: {
        left: [
          'assets/sprites/player/slingshot/fire_left_0.png',
          'assets/sprites/player/slingshot/fire_left_1.png',
          'assets/sprites/player/slingshot/fire_left_2.png',
        ],
      },
    },
  },
};

let assetsReady = false;
let assetLoadError = null;
let loadedAssets = null;

let socket = null;
let selfId = null;
let snapshot = null;
let sharedSnapshot = null;
const playerAnimTimers = new Map();

const PLAYER_FRAME_MS = {
  idle: 280,
  walk: 130,
  fire: 85,
  swing: 85,
};
const ATTACK_ACTION_WINDOW_SECONDS = 0.22;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

function preloadAssets(assetManifest) {
  const loadRecursive = (value) => {
    if (Array.isArray(value)) {
      return Promise.all(value.map(loadRecursive));
    }

    if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      return Promise.all(entries.map(async ([key, nestedValue]) => [key, await loadRecursive(nestedValue)]))
        .then((resolvedEntries) => Object.fromEntries(resolvedEntries));
    }

    if (typeof value === 'string') {
      return loadImage(value);
    }

    return Promise.resolve(value);
  };

  return loadRecursive(assetManifest);
}

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
    if (msg.type === 'snapshotShared') {
      sharedSnapshot = msg.snapshot;
      snapshot = { ...(snapshot || {}), ...(sharedSnapshot || {}) };
      renderHud();
    }
    if (msg.type === 'snapshotDelta') {
      snapshot = { ...(sharedSnapshot || snapshot || {}), ...(msg.snapshot || {}) };
      renderHud();
    }
    if (msg.type === 'snapshot') {
      sharedSnapshot = msg.snapshot;
      snapshot = msg.snapshot;
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

function getDirectionFromFacing(facingX = 1, facingY = 0) {
  if (Math.abs(facingX) >= Math.abs(facingY)) {
    return facingX < 0 ? 'left' : 'right';
  }
  return facingY < 0 ? 'up' : 'down';
}

function getPlayerAnimState(player, now) {
  const animData = playerAnimTimers.get(player.id) || {
    prevX: player.x,
    prevY: player.y,
    lastUpdateAt: now,
    frameElapsed: 0,
    frameIndex: 0,
  };

  const deltaMs = Math.max(0, now - animData.lastUpdateAt);
  const moved = Math.hypot(player.x - animData.prevX, player.y - animData.prevY) > 0.002;
  const direction = getDirectionFromFacing(player.facingX ?? 1, player.facingY ?? 0);
  const locomotion = moved ? 'walk' : 'idle';
  const weaponPosture = player.selectedWeapon === 'slingshot' ? 'slingshot' : 'bat';
  const nowSeconds = Date.now() / 1000;
  const recentAttack = Number(player.lastAttackAt) > 0 && (nowSeconds - Number(player.lastAttackAt)) < ATTACK_ACTION_WINDOW_SECONDS;
  const action = recentAttack && (player.lastAttackType === 'fire' || player.lastAttackType === 'swing')
    ? player.lastAttackType
    : null;

  const frameFamily = action || locomotion;
  const frameDurationMs = PLAYER_FRAME_MS[frameFamily] || PLAYER_FRAME_MS.idle;
  animData.frameElapsed += deltaMs;
  if (animData.frameElapsed >= frameDurationMs) {
    const advancedFrames = Math.floor(animData.frameElapsed / frameDurationMs);
    animData.frameElapsed -= advancedFrames * frameDurationMs;
    animData.frameIndex += advancedFrames;
  }

  animData.prevX = player.x;
  animData.prevY = player.y;
  animData.lastUpdateAt = now;
  playerAnimTimers.set(player.id, animData);

  return {
    direction,
    locomotion,
    weaponPosture,
    action,
    frameIndex: animData.frameIndex,
  };
}

function getAnimationFramesForState(animState) {
  const direction = animState.direction;
  const actionFrames = loadedAssets?.player?.[animState.weaponPosture]?.[animState.action]?.[direction];
  if (Array.isArray(actionFrames) && actionFrames.length) {
    return actionFrames;
  }

  const locomotionFrames = loadedAssets?.player?.[animState.locomotion]?.[direction];
  if (Array.isArray(locomotionFrames) && locomotionFrames.length) {
    return locomotionFrames;
  }

  const fallbackWalkFrames = loadedAssets?.player?.walk?.left;
  if (Array.isArray(fallbackWalkFrames) && fallbackWalkFrames.length && animState.locomotion === 'walk') {
    return fallbackWalkFrames;
  }

  const idleDown = loadedAssets?.player?.idle?.down;
  if (idleDown) return [idleDown];
  return [];
}

function drawSafeZones(map, camera) {
  if (!Array.isArray(map.safeZones)) return;

  map.safeZones.forEach((zone) => {
    zone.tiles.forEach((tile) => {
      const screen = worldToScreen(tile.x, tile.y, camera);
      if (!isOnScreen(screen.x, screen.y, TILE_SIZE)) return;

      ctx.save();
      ctx.fillStyle = zone.destroyed ? 'rgba(120, 30, 30, 0.45)' : 'rgba(90, 170, 220, 0.35)';
      ctx.fillRect(screen.x, screen.y, TILE_SIZE, TILE_SIZE);
      ctx.fillStyle = zone.destroyed ? '#ffd0d0' : '#e8f8ff';
      ctx.font = '10px sans-serif';
      ctx.fillText('SAFE ZONE', screen.x + 2, screen.y + 11);
      if (zone.destroyed) {
        ctx.fillStyle = '#ffd1a8';
        ctx.fillText('DESTROYED', screen.x + 2, screen.y + 22);
      }
      ctx.restore();
    });
  });
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


function formatResourceLabel(material) {
  return material.charAt(0).toUpperCase() + material.slice(1);
}

function drawHudPanel(x, y, width, height, title) {
  ctx.save();
  ctx.fillStyle = 'rgba(10, 14, 22, 0.72)';
  ctx.strokeStyle = 'rgba(151, 173, 212, 0.42)';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = '#e8edf5';
  ctx.font = '12px sans-serif';
  ctx.fillText(title, x + 10, y + 17);
  ctx.restore();
}

function drawMeter({ x, y, width, label, value, max, color, dim = false }) {
  const safeMax = Math.max(0, Number(max) || 0);
  const safeValue = clamp(Number(value) || 0, 0, safeMax || 1);
  const ratio = safeMax > 0 ? safeValue / safeMax : 0;

  ctx.save();
  ctx.fillStyle = '#e8edf5';
  ctx.font = dim ? '11px sans-serif' : '12px sans-serif';
  ctx.fillText(`${label} ${Math.ceil(safeValue)}/${safeMax}`, x, y);

  const barY = y + 6;
  const barHeight = dim ? 6 : 8;
  ctx.fillStyle = 'rgba(54, 64, 82, 0.95)';
  ctx.fillRect(x, barY, width, barHeight);
  ctx.fillStyle = dim ? 'rgba(130, 141, 160, 0.95)' : color;
  ctx.fillRect(x, barY, width * ratio, barHeight);
  ctx.strokeStyle = 'rgba(208, 221, 242, 0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, barY, width, barHeight);
  ctx.restore();
}

function drawGameplayHud(me, lightingMode) {
  const combat = me.combat || {};
  const batDurability = combat.batDurability || { current: 0, max: 0 };
  const flashlightBattery = combat.flashlightBattery || { current: 0, max: 0 };
  const equipped = me.selectedWeapon === 'slingshot' ? 'slingshot' : 'bat';
  const ammo = Number(me.inventory?.pebbles || 0);

  const panelX = 12;
  const panelY = canvas.height - 172;
  const panelWidth = 346;
  const panelHeight = 160;
  drawHudPanel(panelX, panelY, panelWidth, panelHeight, 'COMBAT HUD');

  ctx.save();
  ctx.font = '12px sans-serif';

  const weaponY = panelY + 37;
  const weaponWidth = 108;
  ['bat', 'slingshot'].forEach((weapon, i) => {
    const x = panelX + 10 + i * (weaponWidth + 8);
    const active = equipped === weapon;
    ctx.fillStyle = active ? 'rgba(88, 125, 194, 0.9)' : 'rgba(40, 50, 66, 0.9)';
    ctx.strokeStyle = active ? '#d6e3ff' : '#7d8ca8';
    ctx.lineWidth = active ? 2 : 1;
    ctx.fillRect(x, weaponY, weaponWidth, 24);
    ctx.strokeRect(x, weaponY, weaponWidth, 24);
    ctx.fillStyle = '#e8edf5';
    const label = weapon === 'bat' ? 'BAT' : 'SLINGSHOT';
    ctx.fillText(active ? `${label} [EQUIPPED]` : label, x + 8, weaponY + 16);
  });

  drawMeter({
    x: panelX + 10,
    y: panelY + 78,
    width: 160,
    label: 'Bat Durability',
    value: batDurability.current,
    max: batDurability.max,
    color: '#cb8f5c',
    dim: equipped !== 'bat',
  });

  drawMeter({
    x: panelX + 180,
    y: panelY + 78,
    width: 154,
    label: 'Pebbles',
    value: ammo,
    max: Math.max(20, ammo || 0),
    color: '#98a6ba',
    dim: equipped !== 'slingshot',
  });

  drawMeter({
    x: panelX + 10,
    y: panelY + 116,
    width: 324,
    label: lightingMode === 'night' ? 'Flashlight Battery (ACTIVE)' : 'Flashlight Battery (CHARGING)',
    value: flashlightBattery.current,
    max: flashlightBattery.max,
    color: '#dfd889',
  });

  const resources = Array.isArray(snapshot?.materials) ? snapshot.materials : Object.keys(me.inventory || {});
  const resourcePanelWidth = 246;
  const resourcePanelHeight = 122;
  const resourceX = canvas.width - resourcePanelWidth - 12;
  const resourceY = 12;
  drawHudPanel(resourceX, resourceY, resourcePanelWidth, resourcePanelHeight, 'RESOURCES');

  resources.forEach((material, idx) => {
    const value = me.inventory?.[material] ?? 0;
    ctx.fillStyle = '#d8e2f3';
    ctx.font = '12px sans-serif';
    const row = Math.floor(idx / 2);
    const col = idx % 2;
    const lineX = resourceX + 10 + col * 116;
    const lineY = resourceY + 36 + row * 24;
    ctx.fillText(`${formatResourceLabel(material)}: ${value}`, lineX, lineY);
  });

  ctx.restore();
}

function drawLoadingState() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#10151d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e8edf5';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const message = assetLoadError ? 'Failed to load assets' : 'Loading assets...';
  ctx.fillText(message, canvas.width / 2, canvas.height / 2);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function render() {
  if (!snapshot) return;
  const map = snapshot.map;
  const me = snapshot.players.find((p) => p.id === selfId);
  if (!me) return;

  const lightingMode = getLightingMode();
  const tileColors = lightingMode === 'night' ? NIGHT_COLORS : DAY_COLORS;
  const camera = getCamera(map, me);
  const now = performance.now();

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (lightingMode === 'day') {
    ctx.fillStyle = DAY_COLORS[TILE.GRASS];
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const minTileX = Math.max(0, Math.floor(camera.x / TILE_SIZE));
  const maxTileX = Math.min(map.width - 1, Math.ceil((camera.x + canvas.width) / TILE_SIZE));
  const minTileY = Math.max(0, Math.floor(camera.y / TILE_SIZE));
  const maxTileY = Math.min(map.height - 1, Math.ceil((camera.y + canvas.height) / TILE_SIZE));

  for (let y = minTileY; y <= maxTileY; y += 1) {
    for (let x = minTileX; x <= maxTileX; x += 1) {
      const tile = map.tiles[y]?.[x] ?? HIDDEN_TILE;
      const screen = worldToScreen(x, y, camera);

      const spriteKey = TILE_SPRITE_KEYS[tile];
      const tileSprite = spriteKey ? loadedAssets?.tiles?.[spriteKey] : null;
      const shouldUseBlackout = lightingMode === 'night' && tile === HIDDEN_TILE;

      if (tileSprite && !shouldUseBlackout) {
        ctx.drawImage(tileSprite, screen.x, screen.y, TILE_SIZE, TILE_SIZE);
      } else {
        ctx.fillStyle = tileColors[tile] || '#000';
        ctx.fillRect(screen.x, screen.y, TILE_SIZE, TILE_SIZE);
      }

      if (tile === TILE.CHECKPOINT) {
        ctx.fillStyle = 'rgba(180,240,255,0.25)';
        ctx.fillRect(screen.x, screen.y, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  drawSafeZones(map, camera);

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

    const animState = getPlayerAnimState(player, now);
    const frames = getAnimationFramesForState(animState);
    const sprite = frames.length ? frames[animState.frameIndex % frames.length] : null;
    if (sprite) {
      ctx.drawImage(sprite, screen.x - TILE_SIZE / 2, screen.y - TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
    } else {
      ctx.fillStyle = isSelf ? '#4ec3ff' : '#f7f7f7';
      if (player.tagged) ctx.fillStyle = '#ffb26a';
      ctx.fillRect(screen.x - 9, screen.y - 9, 18, 18);
    }

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

  drawGameplayHud(me, lightingMode);
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
  const resources = Array.isArray(snapshot.materials) ? snapshot.materials : Object.keys(me.inventory || {});
  inventoryInfo.innerHTML = [
    '<strong>Resources</strong>',
    ...resources.map((material) => `${formatResourceLabel(material)}: ${me.inventory?.[material] ?? 0}`),
  ].join('<br>');

  const selectedWeaponLabel = me.selectedWeapon === 'slingshot' ? 'Slingshot' : 'Bat';
  const batDurability = me.combat?.batDurability || { current: 0, max: 0 };
  const flashlightBattery = me.combat?.flashlightBattery || { current: 0, max: 0 };
  const flashlightStatus = me.flashlightActive ? 'Active' : (lightingMode === 'night' ? 'Empty battery' : 'Charging (day)');

  gearInfo.innerHTML = `<strong>Gear</strong><br>Torch T${me.gear.torch} | Bat T${me.gear.bat} | Slingshot T${me.gear.slingshot}<br><strong>Selected:</strong> ${selectedWeaponLabel} (Q to swap)<br><strong>Pebbles:</strong> ${me.inventory.pebbles}<br><strong>Bat durability:</strong> ${Math.ceil(batDurability.current)}/${batDurability.max}<br><strong>Flashlight:</strong> ${Math.ceil(flashlightBattery.current)}/${flashlightBattery.max} (${flashlightStatus})`;

  const everyone = snapshot.players
    .map((p) => `${p.objectiveReached ? '✅' : '⬜'} ${p.username}`)
    .join('<br>');
  const safeZoneStatus = (snapshot.map.safeZones || [])
    .map((zone) => `${zone.name}: ${zone.remainingHits}/${zone.maxHits}${zone.destroyed ? ' (destroyed)' : ''}`)
    .join('<br>');
  teamInfo.innerHTML = `<strong>Objective status</strong><br>${everyone}<br><br><strong>Safe Zones</strong><br>${safeZoneStatus || 'No safe zones available.'}`;

  eventsList.innerHTML = snapshot.events.map((ev) => `<li>${ev.message}</li>`).join('');
}

function gameLoop() {
  if (!assetsReady || assetLoadError) {
    drawLoadingState();
  } else {
    render();
  }

  requestAnimationFrame(gameLoop);
}

preloadAssets(ASSETS)
  .then((resolvedAssets) => {
    loadedAssets = resolvedAssets;
    assetsReady = true;
  })
  .catch((error) => {
    assetLoadError = error;
    console.error(error);
  });

requestAnimationFrame(gameLoop);
