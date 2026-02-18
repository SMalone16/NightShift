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
const MAP_WIDTH = 34;
const MAP_HEIGHT = 22;

const PHASES = {
  GATHER: 'gather',
  CHASE: 'chase',
};

const PHASE_LENGTH_SECONDS = {
  [PHASES.GATHER]: 45,
  [PHASES.CHASE]: 60,
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

module.exports = {
  TILE,
  TILE_SIZE,
  MAP_WIDTH,
  MAP_HEIGHT,
  PHASES,
  PHASE_LENGTH_SECONDS,
  RECIPES,
  MATERIALS,
};
