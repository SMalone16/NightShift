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

const TILE_SIZE = 32;
const MAP_WIDTH = 64;
const MAP_HEIGHT = 40;

const PHASES = {
  DAY: 'day',
  NIGHT: 'night',
};

const PHASE_LENGTH_SECONDS = {
  [PHASES.DAY]: 45,
  [PHASES.NIGHT]: 60,
};

const RECIPES = {
  torch: {
    base: { wood: 2, cloth: 1 },
    upgrade: { wood: 2, oil: 1 },
  },
  bat: {
    base: { wood: 3 },
    upgrade: { wood: 2, stone: 1 },
  },
  slingshot: {
    base: { wood: 2, pebbles: 2 },
    upgrade: { wood: 1, pebbles: 2, cloth: 1 },
  },
};

const MATERIALS = ['wood', 'stone', 'cloth', 'oil', 'pebbles'];

const HIDDEN_TILE = 99;
const VISION_RADIUS_BASE_TILES = 4;
const VISION_RADIUS_PER_TORCH_TIER = 2;

const SPECIAL_TILE_VISIBILITY = {
  checkpoint: 'always',
  objective: 'hidden-until-seen',
};

const ENEMY_SPAWN_MIN = 2;
const ENEMY_SPAWN_MAX = 12;
const ENEMY_NIGHT_SCALING_FACTOR = 2;
const ENEMY_SPAWN_PLAYER_BUFFER = 8;
const ENEMY_SPAWN_CHECKPOINT_BUFFER = 6;
const ENEMY_SPAWN_OBJECTIVE_BUFFER = 8;

module.exports = {
  TILE,
  HIDDEN_TILE,
  TILE_SIZE,
  MAP_WIDTH,
  MAP_HEIGHT,
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
};
