const { generateMap, isWalkable } = require('./map');
const { findPathAStar } = require('./pathfinding');
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
  ENEMY_SPAWN_MIN,
  ENEMY_SPAWN_MAX,
  ENEMY_NIGHT_SCALING_FACTOR,
  ENEMY_SPAWN_PLAYER_BUFFER,
  ENEMY_SPAWN_CHECKPOINT_BUFFER,
  ENEMY_SPAWN_OBJECTIVE_BUFFER,
} = require('./constants');
const { getUserProfile, addXp, touchUser } = require('./persistence');

const PLAYER_SPEED = 5; // tiles per second
const ENEMY_SPEED = 3.2;
const TAG_DURATION = 1.0;
const ATTACK_COOLDOWN = 0.45;
const SAFE_ZONE_ATTACK_COOLDOWN = 0.9;
const PLAYER_BUCKET_SIZE = 4;
const ENEMY_PATH_RECALC_INTERVAL = 0.5;
const ENEMY_PATH_GOAL_EPSILON = 0.15;
const ENEMY_PATH_REACH_EPSILON = 0.08;
const FLASHLIGHT_DRAIN_PER_SECOND = 1;
const PLAYER_HEALTH_MAX = 100;
const ENEMY_CONTACT_DAMAGE = 20;
const ENEMY_CONTACT_DAMAGE_COOLDOWN = 1.1;
const PLAYER_RESPAWN_INVULNERABILITY = 2.5;
const ENEMY_HEALTH_BASE = 3;

const BAT_DURABILITY_BY_TIER = {
  0: 0,
  1: 24,
  2: 36,
  3: 52,
};

const FLASHLIGHT_BATTERY_BY_TIER = {
  0: 0,
  1: 100,
  2: 130,
  3: 165,
};

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

// Combat-facing stats are authoritative on the server and mirrored to clients via snapshots.
function makeCombatState() {
  return {
    batDurability: {
      current: 0,
      max: 0,
    },
    flashlightBattery: {
      current: 0,
      max: 0,
    },
  };
}

function makeHealthState() {
  return {
    current: PLAYER_HEALTH_MAX,
    max: PLAYER_HEALTH_MAX,
  };
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
    this.mapStaticMetadata = this.buildMapStaticMetadata();
    this.sharedNightMap = this.buildSharedNightMap();
    this.maskedMapCache = new Map();
    this.players = new Map();
    this.enemies = [];
    this.projectiles = [];
    this.nextEnemyId = 1;
    this.nextProjectileId = 1;
    this.phase = PHASES.DAY;
    this.phaseTimer = PHASE_LENGTH_SECONDS[PHASES.DAY];
    this.roundStatus = 'running';
    this.nightNumber = 0;
    this.events = [];
    this.lastEnemySpawnTick = 0;
  }

  buildMapStaticMetadata() {
    return {
      width: this.map.width,
      height: this.map.height,
      worldWidth: this.map.worldWidth || this.map.width,
      worldHeight: this.map.worldHeight || this.map.height,
      objective: this.map.objective,
      checkpoints: this.map.checkpoints,
      spawns: this.map.spawns,
      zones: this.map.zones || [],
    };
  }

  buildSharedNightMap() {
    const tiles = Array.from(
      { length: this.map.height },
      () => Array.from({ length: this.map.width }, () => HIDDEN_TILE),
    );

    return {
      ...this.mapStaticMetadata,
      tiles,
      safeZones: this.map.safeZones || [],
    };
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
      combat: makeCombatState(),
      health: makeHealthState(),
      taggedUntil: 0,
      enemyContactCooldownUntil: 0,
      invulnerableUntil: 0,
      downs: 0,
      attackCooldownUntil: 0,
      lastAttackAt: 0,
      lastAttackType: null,
      objectiveReached: false,
      xp: profile.xp,
      level: profile.level,
      safeZoneState: { entranceZoneId: null, activeZoneId: null },
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
    this.maskedMapCache.delete(clientId);
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
      this.nightNumber += 1;
      this.spawnEnemies();
      this.players.forEach((p) => {
        p.objectiveReached = false;
      });
      this.logEvent(`Night ${this.nightNumber} has fallen. ${this.enemies.length} enemies are hunting. Get to objective together!`);
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
    this.mapStaticMetadata = this.buildMapStaticMetadata();
    this.sharedNightMap = this.buildSharedNightMap();
    this.maskedMapCache.clear();
    const spawns = this.map.spawns;
    let i = 0;
    this.players.forEach((p) => {
      const s = spawns[i % spawns.length];
      p.x = s.x;
      p.y = s.y;
      p.objectiveReached = false;
      p.taggedUntil = now;
      p.enemyContactCooldownUntil = 0;
      p.invulnerableUntil = now;
      p.health = makeHealthState();
      p.safeZoneState = { entranceZoneId: null, activeZoneId: null };
      i += 1;
    });
  }

  spawnEnemies() {
    this.enemies = [];
    const count = this.getEnemyCountForNight();
    const spawnTiles = this.getEnemySpawnCandidates();
    const maxSpawns = Math.min(count, spawnTiles.length);

    for (let i = 0; i < maxSpawns; i += 1) {
      const idx = Math.floor(Math.random() * spawnTiles.length);
      const spawn = spawnTiles.splice(idx, 1)[0];
      this.enemies.push({
        id: this.nextEnemyId++,
        x: spawn.x,
        y: spawn.y,
        hp: ENEMY_HEALTH_BASE,
        maxHp: ENEMY_HEALTH_BASE,
        stunnedUntil: 0,
        zoneAttackCooldownUntil: 0,
        path: [],
        pathIndex: 0,
        pathTargetKey: null,
        nextPathRecalcAt: 0,
      });
    }

    if (this.enemies.length < count) {
      this.logEvent(`Night ${this.nightNumber}: only ${this.enemies.length}/${count} enemies could be deployed.`);
    }

    this.logEvent(`Night ${this.nightNumber}: ${this.enemies.length} enemies spawned.`);
  }

  getEnemyCountForNight() {
    const base = this.players.size + 1;
    const bonus = Math.floor(Math.max(0, this.nightNumber - 1) / ENEMY_NIGHT_SCALING_FACTOR);
    return clamp(base + bonus, ENEMY_SPAWN_MIN, ENEMY_SPAWN_MAX);
  }

  getEnemySpawnCandidates() {
    const candidates = [];

    for (let y = 0; y < this.map.height; y += 1) {
      for (let x = 0; x < this.map.width; x += 1) {
        if (!this.canUseEnemySpawnTile(x, y)) continue;
        candidates.push({ x, y });
      }
    }

    return candidates;
  }

  canUseEnemySpawnTile(x, y) {
    if (!isWalkable(this.map.tiles[y][x])) return false;

    const tooCloseToPlayerSpawn = this.map.spawns.some((spawn) => distManhattan(spawn, { x, y }) < ENEMY_SPAWN_PLAYER_BUFFER);
    if (tooCloseToPlayerSpawn) return false;

    const tooCloseToCheckpoint = this.map.checkpoints.some((checkpoint) => distManhattan(checkpoint, { x, y }) < ENEMY_SPAWN_CHECKPOINT_BUFFER);
    if (tooCloseToCheckpoint) return false;

    if (distManhattan(this.map.objective, { x, y }) < ENEMY_SPAWN_OBJECTIVE_BUFFER) return false;

    return true;
  }

  updatePlayers(dt, now) {
    this.players.forEach((p) => {
      this.updateFlashlightBattery(p, dt);

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

      this.updatePlayerSafeZoneState(p);
    });
  }

  updatePlayerSafeZoneState(player) {
    if (!player.safeZoneState) {
      player.safeZoneState = { entranceZoneId: null, activeZoneId: null };
    }

    const insideZone = this.getSafeZoneAtPosition(player.x, player.y, true);
    const entranceZone = this.getSafeZoneAtEntrancePosition(player.x, player.y, true);
    if (entranceZone && this.isPlayerAtSafeZoneEntrance(player, entranceZone)) {
      player.safeZoneState.entranceZoneId = entranceZone.id;
    }

    if (!insideZone || insideZone.destroyed) {
      player.safeZoneState.activeZoneId = null;
      if (!this.getSafeZoneAtEntrancePosition(player.x, player.y, true)) {
        player.safeZoneState.entranceZoneId = null;
      }
      return;
    }

    if (player.safeZoneState.activeZoneId === insideZone.id) return;

    if (player.safeZoneState.entranceZoneId === insideZone.id) {
      player.safeZoneState.activeZoneId = insideZone.id;
    }
  }

  setSelectedWeapon(player, weapon) {
    if (weapon !== 'bat' && weapon !== 'slingshot') return;
    if (player.gear[weapon] <= 0) return;
    player.selectedWeapon = weapon;
  }

  // Flashlight battery drains at night while active and recharges instantly during day.
  updateFlashlightBattery(player, dt) {
    const maxBattery = this.getFlashlightBatteryMax(player.gear.torch);
    const battery = player.combat.flashlightBattery;
    battery.max = maxBattery;

    if (maxBattery <= 0) {
      battery.current = 0;
      return;
    }

    if (this.phase === PHASES.DAY) {
      battery.current = maxBattery;
      return;
    }

    battery.current = clamp(battery.current - (FLASHLIGHT_DRAIN_PER_SECOND * dt), 0, maxBattery);
  }

  isFlashlightActive(player) {
    return this.phase === PHASES.NIGHT
      && player.gear.torch > 0
      && player.combat.flashlightBattery.current > 0;
  }

  getFlashlightBatteryMax(torchTier) {
    return FLASHLIGHT_BATTERY_BY_TIER[torchTier] || 0;
  }

  getBatDurabilityMax(batTier) {
    return BAT_DURABILITY_BY_TIER[batTier] || 0;
  }

  setWeaponFallback(player) {
    if (player.selectedWeapon === 'bat' && player.gear.bat <= 0 && player.gear.slingshot > 0) {
      player.selectedWeapon = 'slingshot';
      return;
    }

    if (player.selectedWeapon === 'slingshot' && player.gear.slingshot <= 0 && player.gear.bat > 0) {
      player.selectedWeapon = 'bat';
    }
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
        this.applyGearStats(player, item);
        this.logEvent(`${player.username} crafted ${item} T1.`);
        return;
      }
    }

    for (const item of order) {
      if (player.gear[item] >= 1 && player.gear[item] < 3 && hasMats(player.inventory, RECIPES[item].upgrade)) {
        spendMats(player.inventory, RECIPES[item].upgrade);
        player.gear[item] += 1;
        this.applyGearStats(player, item);
        this.logEvent(`${player.username} upgraded ${item} to T${player.gear[item]}.`);
        return;
      }
    }
  }

  // Keep stat initialization tied to crafted/upgraded gear to avoid client-side duplication.
  applyGearStats(player, item) {
    if (item === 'bat') {
      const maxDurability = this.getBatDurabilityMax(player.gear.bat);
      player.combat.batDurability.max = maxDurability;
      player.combat.batDurability.current = maxDurability;
      return;
    }

    if (item === 'torch') {
      const maxBattery = this.getFlashlightBatteryMax(player.gear.torch);
      player.combat.flashlightBattery.max = maxBattery;
      player.combat.flashlightBattery.current = maxBattery;
    }
  }

  handleAttack(player, now) {
    if (player.selectedWeapon === 'slingshot' && player.gear.slingshot > 0) {
      if ((player.inventory.pebbles || 0) <= 0) {
        this.logEvent(`${player.username} tried to fire slingshot, but has no pebbles.`);
        return;
      }

      player.inventory.pebbles -= 1;
      player.lastAttackAt = now;
      player.lastAttackType = 'fire';
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
      const durability = player.combat.batDurability;
      if (durability.current <= 0) {
        player.gear.bat = 0;
        this.setWeaponFallback(player);
        this.logEvent(`${player.username}'s bat broke.`);
        return;
      }

      durability.current = Math.max(0, durability.current - 1);
      player.lastAttackAt = now;
      player.lastAttackType = 'swing';

      const defeatedEnemyIds = [];
      const swingToken = `swing:${player.id}:${now.toFixed(3)}`;
      this.enemies.forEach((e) => {
        if (Math.abs(e.x - player.x) <= 1 && Math.abs(e.y - player.y) <= 1) {
          const wasDefeated = this.applyDamageToEnemy(e, {
            now,
            damage: 1,
            stunDuration: 0.5 + 0.2 * player.gear.bat,
            sourceToken: `${swingToken}:${e.id}`,
            attackerName: player.username,
            sourceType: 'bat',
          });
          if (wasDefeated) {
            defeatedEnemyIds.push(e.id);
          }
        }
      });

      if (defeatedEnemyIds.length > 0) {
        this.enemies = this.enemies.filter((enemy) => !defeatedEnemyIds.includes(enemy.id));
      }

      this.logEvent(`${player.username} swung bat.`);

      if (durability.current <= 0) {
        player.gear.bat = 0;
        durability.max = 0;
        this.setWeaponFallback(player);
        this.logEvent(`${player.username}'s bat broke.`);
      }
    }
  }

  updateProjectiles(dt, now) {
    this.projectiles.forEach((proj) => {
      proj.ttl -= dt;
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;

      let defeatedEnemyId = null;
      const ownerName = this.players.get(proj.ownerId)?.username || 'Unknown';
      for (let i = 0; i < this.enemies.length; i += 1) {
        const e = this.enemies[i];
        if (Math.abs(e.x - proj.x) < 0.7 && Math.abs(e.y - proj.y) < 0.7) {
          const wasDefeated = this.applyDamageToEnemy(e, {
            now,
            damage: 1,
            stunDuration: proj.stun,
            sourceToken: `projectile:${proj.id}:${e.id}`,
            attackerName: ownerName,
            sourceType: 'projectile',
          });
          if (wasDefeated) {
            defeatedEnemyId = e.id;
          }
          proj.ttl = 0;
          break;
        }
      }

      if (defeatedEnemyId !== null) {
        this.enemies = this.enemies.filter((enemy) => enemy.id !== defeatedEnemyId);
      }
    });
    this.projectiles = this.projectiles.filter((p) => p.ttl > 0 && this.isTileWalkable(Math.round(p.x), Math.round(p.y)));
  }

  applyDamageToEnemy(enemy, { now, damage, stunDuration = 0, sourceToken, attackerName = 'Unknown', sourceType = 'attack' }) {
    if (!enemy || enemy.hp <= 0) return false;
    if (sourceToken && enemy.lastDamageSourceToken === sourceToken) {
      return false;
    }

    if (sourceToken) {
      enemy.lastDamageSourceToken = sourceToken;
    }

    if (stunDuration > 0) {
      enemy.stunnedUntil = Math.max(enemy.stunnedUntil, now + stunDuration);
    }

    enemy.hp = Math.max(0, (enemy.hp || 0) - damage);
    if (enemy.hp > 0) {
      return false;
    }

    this.logEvent(`Enemy ${enemy.id} defeated by ${attackerName} (${sourceType}).`);
    return true;
  }

  updateEnemies(dt, now) {
    const targetingContext = this.buildEnemyTargetingContext();

    this.enemies.forEach((enemy) => {
      if (enemy.stunnedUntil > now) return;
      const target = this.findNearestTarget(enemy, targetingContext);
      if (!target) return;

      const targetX = target.type === 'zone' ? target.position.x : target.player.x;
      const targetY = target.type === 'zone' ? target.position.y : target.player.y;

      const blocked = !this.followEnemyPath(enemy, { x: targetX, y: targetY }, dt, now);
      if (blocked) {
        enemy.nextPathRecalcAt = 0;
      }

      if (target.type === 'zone') {
        this.tryAttackSafeZone(enemy, target.zone, target.position, now);
        return;
      }

      if (Math.abs(enemy.x - target.player.x) < 0.75 && Math.abs(enemy.y - target.player.y) < 0.75) {
        this.applyEnemyContactDamage(target.player, now);
      }
    });
  }

  applyEnemyContactDamage(player, now) {
    if (now < player.enemyContactCooldownUntil || now < player.invulnerableUntil) return;

    player.enemyContactCooldownUntil = now + ENEMY_CONTACT_DAMAGE_COOLDOWN;
    player.taggedUntil = now + TAG_DURATION;
    player.health.current = clamp(player.health.current - ENEMY_CONTACT_DAMAGE, 0, player.health.max);

    if (player.health.current > 0) return;

    this.handlePlayerDowned(player, now);
  }

  handlePlayerDowned(player, now) {
    const spawn = this.getSpawnForPlayer(player.id);
    player.x = spawn.x;
    player.y = spawn.y;
    player.health.current = player.health.max;
    player.invulnerableUntil = now + PLAYER_RESPAWN_INVULNERABILITY;
    player.enemyContactCooldownUntil = now + PLAYER_RESPAWN_INVULNERABILITY;
    player.taggedUntil = player.invulnerableUntil;
    player.objectiveReached = false;
    player.safeZoneState = { entranceZoneId: null, activeZoneId: null };
    player.downs = (player.downs || 0) + 1;

    this.logEvent(`${player.username} was downed and respawned at camp.`);
  }

  getSpawnForPlayer(playerId) {
    const playerIds = [...this.players.keys()];
    const playerIndex = Math.max(0, playerIds.indexOf(playerId));
    return this.map.spawns[playerIndex % this.map.spawns.length];
  }

  buildEnemyTargetingContext() {
    const unsafePlayers = [];
    const playerBuckets = new Map();

    this.players.forEach((player) => {
      if (this.isPlayerInSafeZone(player)) return;
      unsafePlayers.push(player);

      const bucketX = Math.floor(player.x / PLAYER_BUCKET_SIZE);
      const bucketY = Math.floor(player.y / PLAYER_BUCKET_SIZE);
      const key = `${bucketX},${bucketY}`;
      const bucket = playerBuckets.get(key) || [];
      bucket.push(player);
      playerBuckets.set(key, bucket);
    });

    return { unsafePlayers, playerBuckets };
  }

  tryAttackSafeZone(enemy, zone, attackPoint, now) {
    if (zone.destroyed || enemy.zoneAttackCooldownUntil > now) return;

    if (Math.abs(enemy.x - attackPoint.x) >= 0.8 || Math.abs(enemy.y - attackPoint.y) >= 0.8) {
      return;
    }

    zone.remainingHits -= 1;
    enemy.zoneAttackCooldownUntil = now + SAFE_ZONE_ATTACK_COOLDOWN;

    if (zone.remainingHits <= 0) {
      zone.remainingHits = 0;
      zone.destroyed = true;
      this.players.forEach((player) => {
        if (player.safeZoneState?.activeZoneId === zone.id) {
          player.safeZoneState.activeZoneId = null;
        }
      });
      this.logEvent(`${zone.name} was destroyed! Players inside are now exposed.`);
      return;
    }

    this.logEvent(`${zone.name} was hit (${zone.remainingHits}/${zone.maxHits}).`);
  }

  canEnemyMoveTo(x, y) {
    const tx = Math.round(x);
    const ty = Math.round(y);
    if (!this.isEnemyWalkableTile(tx, ty)) return false;
    const intactSafeZone = this.getSafeZoneAtPosition(tx, ty, true);
    if (intactSafeZone && !intactSafeZone.destroyed) return false;
    return true;
  }

  isEnemyWalkableTile(tx, ty) {
    const tile = this.map.tiles[ty]?.[tx];
    if (tile === undefined) return false;
    return isWalkable(tile);
  }

  followEnemyPath(enemy, targetPos, dt, now) {
    const startTile = this.getEnemyTilePosition(enemy);
    const goalTile = { x: Math.round(targetPos.x), y: Math.round(targetPos.y) };
    const goalKey = `${goalTile.x},${goalTile.y}`;
    const needsRecalc = !enemy.path
      || enemy.pathIndex >= enemy.path.length
      || enemy.pathTargetKey !== goalKey
      || now >= enemy.nextPathRecalcAt;

    if (needsRecalc) {
      enemy.path = this.computeEnemyPath(startTile, goalTile);
      enemy.pathIndex = 0;
      enemy.pathTargetKey = goalKey;
      enemy.nextPathRecalcAt = now + ENEMY_PATH_RECALC_INTERVAL;
    }

    if (!enemy.path || enemy.path.length === 0) {
      return false;
    }

    while (enemy.pathIndex < enemy.path.length) {
      const tile = enemy.path[enemy.pathIndex];
      if (!this.canEnemyMoveTo(tile.x, tile.y)) {
        return false;
      }

      if (Math.abs(enemy.x - tile.x) <= ENEMY_PATH_REACH_EPSILON && Math.abs(enemy.y - tile.y) <= ENEMY_PATH_REACH_EPSILON) {
        enemy.x = tile.x;
        enemy.y = tile.y;
        enemy.pathIndex += 1;
        continue;
      }

      const moved = this.moveEnemyTowardPoint(enemy, tile.x, tile.y, ENEMY_SPEED * dt);
      if (!moved) {
        return false;
      }

      return true;
    }

    return this.moveEnemyTowardPoint(enemy, targetPos.x, targetPos.y, ENEMY_SPEED * dt, ENEMY_PATH_GOAL_EPSILON);
  }

  moveEnemyTowardPoint(enemy, targetX, targetY, maxStep, epsilon = ENEMY_PATH_REACH_EPSILON) {
    const dx = targetX - enemy.x;
    const dy = targetY - enemy.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= epsilon) {
      enemy.x = targetX;
      enemy.y = targetY;
      return true;
    }

    const step = Math.min(maxStep, distance);
    const nx = enemy.x + (dx / distance) * step;
    const ny = enemy.y + (dy / distance) * step;

    if (!this.canEnemyMoveTo(nx, ny)) {
      return false;
    }

    enemy.x = nx;
    enemy.y = ny;
    return true;
  }

  computeEnemyPath(startTile, goalTile) {
    return findPathAStar({
      start: startTile,
      goal: goalTile,
      width: this.map.width,
      height: this.map.height,
      isWalkable: (x, y) => this.canEnemyMoveTo(x, y),
    });
  }

  getEnemyTilePosition(enemy) {
    return {
      x: Math.round(enemy.x),
      y: Math.round(enemy.y),
    };
  }

  isPlayerInSafeZone(player) {
    return !!this.getProtectedSafeZoneForPlayer(player);
  }

  isPlayerAtSafeZoneEntrance(player, zone) {
    const tx = Math.round(player.x);
    const ty = Math.round(player.y);
    return zone.entrances.some((entrance) => entrance.x === tx && entrance.y === ty);
  }

  getProtectedSafeZoneForPlayer(player) {
    if (this.phase !== PHASES.NIGHT) return null;
    const safeZone = this.getSafeZoneAtPosition(player.x, player.y, true);
    if (!safeZone || safeZone.destroyed) return null;

    if (!player.safeZoneState || player.safeZoneState.activeZoneId !== safeZone.id) {
      return null;
    }

    return safeZone;
  }

  getSafeZoneAtPosition(x, y, intactOnly = false) {
    const tx = Math.round(x);
    const ty = Math.round(y);
    const found = this.map.safeZones?.find((zone) => zone.tiles.some((tile) => tile.x === tx && tile.y === ty));
    if (!found) return null;
    if (intactOnly && found.destroyed) return null;
    return found;
  }

  getSafeZoneAtEntrancePosition(x, y, intactOnly = false) {
    const tx = Math.round(x);
    const ty = Math.round(y);
    const found = this.map.safeZones?.find((zone) => zone.entrances.some((entrance) => entrance.x === tx && entrance.y === ty));
    if (!found) return null;
    if (intactOnly && found.destroyed) return null;
    return found;
  }

  findNearestTarget(enemy, targetingContext = this.buildEnemyTargetingContext()) {
    const { unsafePlayers, playerBuckets } = targetingContext;

    if (unsafePlayers.length > 0) {
      let best = null;
      const enemyBucketX = Math.floor(enemy.x / PLAYER_BUCKET_SIZE);
      const enemyBucketY = Math.floor(enemy.y / PLAYER_BUCKET_SIZE);
      const nearbyPlayers = [];

      for (let y = enemyBucketY - 1; y <= enemyBucketY + 1; y += 1) {
        for (let x = enemyBucketX - 1; x <= enemyBucketX + 1; x += 1) {
          const bucket = playerBuckets.get(`${x},${y}`);
          if (!bucket) continue;
          nearbyPlayers.push(...bucket);
        }
      }

      const candidates = nearbyPlayers.length > 0 ? nearbyPlayers : unsafePlayers;
      candidates.forEach((p) => {
        const d = distManhattan({ x: enemy.x, y: enemy.y }, p);
        if (!best || d < best.dist) best = { player: p, dist: d };
      });
      return best ? { type: 'player', player: best.player } : null;
    }

    let bestZone = null;
    const occupiedSafeZones = this.map.safeZones.filter((zone) => {
      if (zone.destroyed) return false;
      return [...this.players.values()].some((player) => this.getProtectedSafeZoneForPlayer(player)?.id === zone.id);
    });

    occupiedSafeZones.forEach((zone) => {
      zone.entrances.forEach((entrance) => {
        const d = distManhattan({ x: enemy.x, y: enemy.y }, entrance);
        if (!bestZone || d < bestZone.dist) {
          bestZone = { zone, position: entrance, dist: d };
        }
      });
    });

    if (!bestZone) return null;
    return { type: 'zone', zone: bestZone.zone, position: bestZone.position };
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
    const flashlightTier = this.isFlashlightActive(player) ? player.gear.torch : 0;
    return VISION_RADIUS_BASE_TILES + flashlightTier * VISION_RADIUS_PER_TORCH_TIER;
  }

  isWithinVision(player, entity, radius) {
    return Math.hypot(entity.x - player.x, entity.y - player.y) <= radius;
  }

  getVisibleTilesForPlayer(player, radius) {
    const radiusSq = radius * radius;
    const px = player.x;
    const py = player.y;
    const minX = clamp(Math.floor(px - radius), 0, this.map.width - 1);
    const maxX = clamp(Math.ceil(px + radius), 0, this.map.width - 1);
    const minY = clamp(Math.floor(py - radius), 0, this.map.height - 1);
    const maxY = clamp(Math.ceil(py + radius), 0, this.map.height - 1);
    const visibleByRow = new Map();

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - px;
        const dy = y - py;
        if (dx * dx + dy * dy <= radiusSq) {
          const row = visibleByRow.get(y) || new Set();
          row.add(x);
          visibleByRow.set(y, row);
        }
      }
    }

    if (SPECIAL_TILE_VISIBILITY.checkpoint === 'always') {
      this.map.checkpoints.forEach((cp) => {
        const row = visibleByRow.get(cp.y) || new Set();
        row.add(cp.x);
        visibleByRow.set(cp.y, row);
      });
    }

    if (SPECIAL_TILE_VISIBILITY.objective === 'always') {
      const row = visibleByRow.get(this.map.objective.y) || new Set();
      row.add(this.map.objective.x);
      visibleByRow.set(this.map.objective.y, row);
    }

    return visibleByRow;
  }

  getMaskedMapForPlayer(player, radius) {
    const px = Math.round(player.x);
    const py = Math.round(player.y);
    const cacheKey = `${player.id}:${px}:${py}:${radius}`;
    const cached = this.maskedMapCache.get(player.id);
    if (cached && cached.key === cacheKey) {
      return cached.map;
    }

    const visibleTiles = this.getVisibleTilesForPlayer(player, radius);
    const tiles = Array.from(
      { length: this.map.height },
      () => Array.from({ length: this.map.width }, () => HIDDEN_TILE),
    );

    visibleTiles.forEach((visibleColumns, y) => {
      visibleColumns.forEach((x) => {
        tiles[y][x] = this.map.tiles[y][x];
      });
    });

    const maskedMap = {
      ...this.mapStaticMetadata,
      tiles,
      safeZones: this.map.safeZones || [],
    };

    this.maskedMapCache.set(player.id, { key: cacheKey, map: maskedMap });

    return maskedMap;
  }

  getVisibleEntitiesForPlayer(player, isNight, visionRadius, now = Date.now() / 1000) {
    return {
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
          combat: p.combat,
          health: p.health,
          flashlightActive: this.isFlashlightActive(p),
          invulnerable: now < p.invulnerableUntil,
          selectedWeapon: p.selectedWeapon,
          tagged: now < p.taggedUntil,
          lastAttackAt: p.lastAttackAt,
          lastAttackType: p.lastAttackType,
          objectiveReached: p.objectiveReached,
          xp: p.xp,
          level: p.level,
        })),
      enemies: this.enemies
        .filter((e) => !player || !isNight || this.isWithinVision(player, e, visionRadius))
        .map((e) => ({
          id: e.id,
          x: e.x,
          y: e.y,
          hp: e.hp,
          maxHp: e.maxHp,
          stunnedUntil: e.stunnedUntil,
        })),

      projectiles: this.projectiles.filter((proj) => !player || !isNight || this.isWithinVision(player, proj, visionRadius)),
    };
  }

  getSharedSnapshot() {
    const lightingMode = this.getLightingMode();
    const isNight = lightingMode === 'night';
    const baseSnapshot = {
      phase: this.phase,
      lightingMode,
      timer: Math.ceil(this.phaseTimer),
      events: this.events,
      recipes: RECIPES,
      materials: MATERIALS,
      visibility: SPECIAL_TILE_VISIBILITY,
      map: isNight ? this.sharedNightMap : this.map,
      visionRadius: null,
    };

    if (isNight) {
      return baseSnapshot;
    }

    return {
      ...baseSnapshot,
      ...this.getVisibleEntitiesForPlayer(null, false, 0),
    };
  }

  getSnapshotDeltaForPlayer(clientId) {
    const player = this.players.get(clientId);
    const lightingMode = this.getLightingMode();
    const isNight = lightingMode === 'night';
    if (!isNight) {
      return {};
    }

    const visionRadius = player ? this.getVisionRadiusForPlayer(player) : 0;

    return {
      map: player && isNight ? this.getMaskedMapForPlayer(player, visionRadius) : this.map,
      ...this.getVisibleEntitiesForPlayer(player, isNight, visionRadius),
      visionRadius: isNight ? visionRadius : null,
    };
  }
}

module.exports = {
  Game,
};
