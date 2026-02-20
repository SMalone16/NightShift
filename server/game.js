const { generateMap, isWalkable } = require('./map');
const {
  TILE,
  HIDDEN_TILE,
  PHASES,
  PHASE_LENGTH_SECONDS,
  RECIPES,
  MATERIALS,
  VISION_RADIUS_BASE_TILES,
  VISION_RADIUS_PER_TORCH_TIER,
  SPECIAL_TILE_VISIBILITY,
} = require('./constants');
const { getUserProfile, addXp, touchUser } = require('./persistence');

const PLAYER_SPEED = 5; // tiles per second
const ENEMY_SPEED = 3.2;
const TAG_DURATION = 1.0;
const ATTACK_COOLDOWN = 0.45;

function makeEmptyInventory() {
  return {
    wood: 0,
    stone: 0,
    cloth: 0,
    oil: 0,
    pebbles: 0,
  };
}

function makeGear() {
  return { torch: 0, bat: 0, slingshot: 0 };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function distManhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function hasMats(inv, cost) {
  return Object.entries(cost).every(([k, v]) => (inv[k] || 0) >= v);
}

function spendMats(inv, cost) {
  Object.entries(cost).forEach(([k, v]) => {
    inv[k] -= v;
  });
}

class Game {
  constructor() {
    this.map = generateMap();
    this.players = new Map();
    this.enemies = [];
    this.projectiles = [];
    this.nextEnemyId = 1;
    this.nextProjectileId = 1;
    this.phase = PHASES.DAY;
    this.phaseTimer = PHASE_LENGTH_SECONDS[PHASES.DAY];
    this.roundStatus = 'running';
    this.events = [];
    this.lastEnemySpawnTick = 0;
  }

  addPlayer(clientId, username) {
    const spawn = this.map.spawns[this.players.size % this.map.spawns.length];
    const profile = getUserProfile(username);
    const player = {
      id: clientId,
      username,
      x: spawn.x,
      y: spawn.y,
      facingX: 1,
      facingY: 0,
      inputs: { up: false, down: false, left: false, right: false },
      wantsCraft: false,
      wantsAttack: false,
      wantsWeaponSwap: false,
      selectedWeapon: 'bat',
      inventory: makeEmptyInventory(),
      gear: makeGear(),
      taggedUntil: 0,
      attackCooldownUntil: 0,
      objectiveReached: false,
      xp: profile.xp,
      level: profile.level,
    };
    this.players.set(clientId, player);
    this.logEvent(`${username} joined the shift.`);
    return player;
  }

  removePlayer(clientId) {
    const player = this.players.get(clientId);
    if (!player) return;
    touchUser(player.username, { xp: player.xp, level: player.level });
    this.players.delete(clientId);
    this.logEvent(`${player.username} signed off.`);
  }

  setInput(clientId, payload) {
    const p = this.players.get(clientId);
    if (!p) return;
    p.inputs.up = !!payload.up;
    p.inputs.down = !!payload.down;
    p.inputs.left = !!payload.left;
    p.inputs.right = !!payload.right;
    p.wantsCraft = !!payload.craft;
    p.wantsAttack = !!payload.attack;
    p.wantsWeaponSwap = !!payload.swapWeapon;

    if (payload.selectedWeapon === 'bat' || payload.selectedWeapon === 'slingshot') {
      this.setSelectedWeapon(p, payload.selectedWeapon);
    }
  }

  tick(dt, now) {
    this.phaseTimer -= dt;
    if (this.phaseTimer <= 0) {
      this.advancePhase(now);
    }

    this.updatePlayers(dt, now);
    this.updateProjectiles(dt, now);

    if (this.phase === PHASES.NIGHT) {
      this.updateEnemies(dt, now);
      this.checkObjectiveWin();
      this.checkChaseTimeout();
    }
  }

  advancePhase(now) {
    if (this.phase === PHASES.DAY) {
      this.phase = PHASES.NIGHT;
      this.phaseTimer = PHASE_LENGTH_SECONDS[PHASES.NIGHT];
      this.spawnEnemies();
      this.players.forEach((p) => {
        p.objectiveReached = false;
      });
      this.logEvent('Night has fallen. Get to objective together!');
    } else {
      this.resetRound(false, now);
    }
  }

  resetRound(success, now) {
    if (success) {
      this.players.forEach((p) => {
        const updated = addXp(p.username, 30);
        p.xp = updated.xp;
        p.level = updated.level;
      });
      this.logEvent('Round success! Team extracted and gained XP.');
    } else {
      this.logEvent('Round failed. Resetting camp...');
    }

    this.phase = PHASES.DAY;
    this.phaseTimer = PHASE_LENGTH_SECONDS[PHASES.DAY];
    this.enemies = [];
    this.projectiles = [];
    this.map = generateMap();
    const spawns = this.map.spawns;
    let i = 0;
    this.players.forEach((p) => {
      const s = spawns[i % spawns.length];
      p.x = s.x;
      p.y = s.y;
      p.objectiveReached = false;
      p.taggedUntil = now;
      i += 1;
    });
  }

  spawnEnemies() {
    this.enemies = [];
    const count = Math.max(2, Math.min(6, this.players.size + 1));
    for (let i = 0; i < count; i += 1) {
      const ex = this.map.width - 4 - (i % 3);
      const ey = 3 + i * 2;
      this.enemies.push({
        id: this.nextEnemyId++,
        x: ex,
        y: ey,
        stunnedUntil: 0,
      });
    }
  }

  updatePlayers(dt, now) {
    this.players.forEach((p) => {
      const slow = now < p.taggedUntil ? 0.45 : 1;
      const dx = (p.inputs.right ? 1 : 0) - (p.inputs.left ? 1 : 0);
      const dy = (p.inputs.down ? 1 : 0) - (p.inputs.up ? 1 : 0);
      const mag = Math.hypot(dx, dy) || 1;
      const step = (PLAYER_SPEED * slow * dt) / mag;
      if (dx !== 0 || dy !== 0) {
        p.facingX = dx / mag;
        p.facingY = dy / mag;
        this.tryMovePlayer(p, p.x + dx * step, p.y + dy * step);
      }

      this.handleTileInteractions(p);

      if (p.wantsCraft) {
        this.autoCraft(p);
        p.wantsCraft = false;
      }

      if (p.wantsWeaponSwap) {
        const nextWeapon = p.selectedWeapon === 'slingshot' ? 'bat' : 'slingshot';
        this.setSelectedWeapon(p, nextWeapon);
        p.wantsWeaponSwap = false;
      }

      if (p.wantsAttack && now >= p.attackCooldownUntil) {
        this.handleAttack(p, now);
        p.attackCooldownUntil = now + ATTACK_COOLDOWN;
      }
    });
  }

  setSelectedWeapon(player, weapon) {
    if (weapon !== 'bat' && weapon !== 'slingshot') return;
    if (player.gear[weapon] <= 0) return;
    player.selectedWeapon = weapon;
  }

  tryMovePlayer(player, nx, ny) {
    const tx = Math.round(nx);
    const ty = Math.round(ny);
    if (!this.isTileWalkable(tx, ty)) return;
    player.x = clamp(nx, 1, this.map.width - 2);
    player.y = clamp(ny, 1, this.map.height - 2);
  }

  isTileWalkable(x, y) {
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return false;
    return isWalkable(this.map.tiles[y][x]);
  }

  handleTileInteractions(player) {
    const tx = Math.round(player.x);
    const ty = Math.round(player.y);
    const tile = this.map.tiles[ty][tx];

    if (tile === TILE.CHEST) {
      this.map.tiles[ty][tx] = TILE.GRASS;
      const rewards = ['wood', 'stone', 'cloth', 'oil', 'pebbles'];
      const loot = rewards[Math.floor(Math.random() * rewards.length)];
      const amount = 2 + Math.floor(Math.random() * 3);
      player.inventory[loot] += amount;
      this.rewardXp(player, 8);
      this.logEvent(`${player.username} opened a chest (+${amount} ${loot}).`);
    }

    const offsets = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    offsets.forEach((o) => {
      const rx = tx + o.x;
      const ry = ty + o.y;
      const t = this.map.tiles[ry]?.[rx];
      if (t === TILE.TREE) {
        this.map.tiles[ry][rx] = TILE.GRASS;
        player.inventory.wood += 2;
        this.rewardXp(player, 3);
      } else if (t === TILE.ROCK) {
        this.map.tiles[ry][rx] = TILE.GRASS;
        player.inventory.stone += 2;
        player.inventory.pebbles += 1;
        this.rewardXp(player, 3);
      }
    });

    if (this.phase === PHASES.NIGHT && this.map.tiles[ty][tx] === TILE.OBJECTIVE) {
      player.objectiveReached = true;
    }
  }

  autoCraft(player) {
    const order = ['torch', 'bat', 'slingshot'];
    for (const item of order) {
      if (player.gear[item] < 1 && hasMats(player.inventory, RECIPES[item].base)) {
        spendMats(player.inventory, RECIPES[item].base);
        player.gear[item] = 1;
        this.logEvent(`${player.username} crafted ${item} T1.`);
        return;
      }
    }

    for (const item of order) {
      if (player.gear[item] >= 1 && player.gear[item] < 3 && hasMats(player.inventory, RECIPES[item].upgrade)) {
        spendMats(player.inventory, RECIPES[item].upgrade);
        player.gear[item] += 1;
        this.logEvent(`${player.username} upgraded ${item} to T${player.gear[item]}.`);
        return;
      }
    }
  }

  handleAttack(player, now) {
    if (player.selectedWeapon === 'slingshot' && player.gear.slingshot > 0) {
      const dirMag = Math.hypot(player.facingX, player.facingY) || 1;
      const dirX = player.facingX / dirMag;
      const dirY = player.facingY / dirMag;
      const tier = player.gear.slingshot;
      const speed = 8 + tier;
      const ttl = 0.65 + 0.15 * tier;

      this.projectiles.push({
        id: this.nextProjectileId++,
        ownerId: player.id,
        x: player.x,
        y: player.y,
        vx: dirX * speed,
        vy: dirY * speed,
        ttl,
        stun: 0.55 + 0.12 * player.gear.slingshot,
      });
      this.logEvent(`${player.username} fired slingshot.`);
      return;
    }

    if (player.selectedWeapon === 'bat' && player.gear.bat > 0) {
      this.enemies.forEach((e) => {
        if (Math.abs(e.x - player.x) <= 1 && Math.abs(e.y - player.y) <= 1) {
          e.stunnedUntil = now + 0.5 + 0.2 * player.gear.bat;
        }
      });
      this.logEvent(`${player.username} swung bat.`);
    }
  }

  updateProjectiles(dt, now) {
    this.projectiles.forEach((proj) => {
      proj.ttl -= dt;
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      this.enemies.forEach((e) => {
        if (Math.abs(e.x - proj.x) < 0.7 && Math.abs(e.y - proj.y) < 0.7) {
          e.stunnedUntil = Math.max(e.stunnedUntil, now + proj.stun);
          proj.ttl = 0;
        }
      });
    });
    this.projectiles = this.projectiles.filter((p) => p.ttl > 0 && this.isTileWalkable(Math.round(p.x), Math.round(p.y)));
  }

  updateEnemies(dt, now) {
    this.enemies.forEach((enemy) => {
      if (enemy.stunnedUntil > now) return;
      const target = this.findNearestTarget(enemy);
      if (!target) return;

      const dx = Math.sign(target.x - enemy.x);
      const dy = Math.sign(target.y - enemy.y);
      const step = ENEMY_SPEED * dt;
      const nx = enemy.x + dx * step;
      const ny = enemy.y + dy * step;

      if (this.canEnemyMoveTo(nx, enemy.y)) enemy.x = nx;
      if (this.canEnemyMoveTo(enemy.x, ny)) enemy.y = ny;

      if (Math.abs(enemy.x - target.x) < 0.75 && Math.abs(enemy.y - target.y) < 0.75) {
        target.taggedUntil = now + TAG_DURATION;
      }
    });
  }

  canEnemyMoveTo(x, y) {
    const tx = Math.round(x);
    const ty = Math.round(y);
    const tile = this.map.tiles[ty]?.[tx];
    if (tile === undefined) return false;
    if (tile === TILE.CHECKPOINT) return false;
    return isWalkable(tile);
  }

  isPlayerSafe(player) {
    const tx = Math.round(player.x);
    const ty = Math.round(player.y);
    return this.phase === PHASES.NIGHT && this.map.tiles[ty][tx] === TILE.CHECKPOINT;
  }

  findNearestTarget(enemy) {
    let best = null;
    this.players.forEach((p) => {
      if (this.isPlayerSafe(p)) return;
      const d = distManhattan({ x: enemy.x, y: enemy.y }, p);
      if (!best || d < best.dist) best = { player: p, dist: d };
    });
    return best?.player || null;
  }

  checkObjectiveWin() {
    if (this.players.size === 0) return;
    const allSafe = [...this.players.values()].every((p) => p.objectiveReached);
    if (allSafe) {
      this.resetRound(true, Date.now() / 1000);
    }
  }

  checkChaseTimeout() {
    if (this.phase === PHASES.NIGHT && this.phaseTimer <= 0) {
      this.resetRound(false, Date.now() / 1000);
    }
  }

  rewardXp(player, amount) {
    const updated = addXp(player.username, amount);
    player.xp = updated.xp;
    player.level = updated.level;
  }

  logEvent(message) {
    this.events.push({ message, at: Date.now() });
    if (this.events.length > 12) this.events.shift();
  }

  getLightingMode() {
    return this.phase === PHASES.DAY ? 'day' : 'night';
  }

  getVisionRadiusForPlayer(player) {
    if (this.getLightingMode() === 'day') {
      return Infinity;
    }
    return VISION_RADIUS_BASE_TILES + player.gear.torch * VISION_RADIUS_PER_TORCH_TIER;
  }

  isWithinVision(player, entity, radius) {
    return Math.hypot(entity.x - player.x, entity.y - player.y) <= radius;
  }

  getVisibleTilesForPlayer(player, radius) {
    const visible = Array.from({ length: this.map.height }, () => Array.from({ length: this.map.width }, () => false));
    const radiusSq = radius * radius;
    const px = player.x;
    const py = player.y;

    for (let y = 0; y < this.map.height; y += 1) {
      for (let x = 0; x < this.map.width; x += 1) {
        const dx = x - px;
        const dy = y - py;
        if (dx * dx + dy * dy <= radiusSq) {
          visible[y][x] = true;
        }
      }
    }

    if (SPECIAL_TILE_VISIBILITY.checkpoint === 'always') {
      this.map.checkpoints.forEach((cp) => {
        visible[cp.y][cp.x] = true;
      });
    }

    if (SPECIAL_TILE_VISIBILITY.objective === 'always') {
      visible[this.map.objective.y][this.map.objective.x] = true;
    }

    return visible;
  }

  getMaskedMapForPlayer(visibleTiles) {
    const tiles = this.map.tiles.map((row, y) => row.map((tile, x) => {
      if (!visibleTiles[y][x]) return HIDDEN_TILE;
      return tile;
    }));

    return {
      width: this.map.width,
      height: this.map.height,
      worldWidth: this.map.worldWidth || this.map.width,
      worldHeight: this.map.worldHeight || this.map.height,
      tiles,
      objective: this.map.objective,
      checkpoints: this.map.checkpoints,
      spawns: this.map.spawns,
      zones: this.map.zones || [],
    };
  }

  getSnapshotForPlayer(clientId) {
    const now = Date.now() / 1000;
    const player = this.players.get(clientId);
    const lightingMode = this.getLightingMode();
    const isNight = lightingMode === 'night';
    const visionRadius = player ? this.getVisionRadiusForPlayer(player) : 0;
    const visibleTiles = player && isNight ? this.getVisibleTilesForPlayer(player, visionRadius) : null;

    return {
      map: player && isNight ? this.getMaskedMapForPlayer(visibleTiles) : this.map,
      phase: this.phase,
      lightingMode,
      timer: Math.ceil(this.phaseTimer),
      players: [...this.players.values()]
        .filter((p) => !player || !isNight || this.isWithinVision(player, p, visionRadius))
        .map((p) => ({
          id: p.id,
          username: p.username,
          x: p.x,
          y: p.y,
          facingX: p.facingX,
          facingY: p.facingY,
          inventory: p.inventory,
          gear: p.gear,
          selectedWeapon: p.selectedWeapon,
          tagged: now < p.taggedUntil,
          objectiveReached: p.objectiveReached,
          xp: p.xp,
          level: p.level,
        })),
      enemies: this.enemies.filter((e) => !player || !isNight || this.isWithinVision(player, e, visionRadius)),
      projectiles: this.projectiles.filter((proj) => !player || !isNight || this.isWithinVision(player, proj, visionRadius)),
      events: this.events,
      recipes: RECIPES,
      materials: MATERIALS,
      visibility: SPECIAL_TILE_VISIBILITY,
      visionRadius: isNight ? visionRadius : null,
    };
  }
}

module.exports = {
  Game,
};
