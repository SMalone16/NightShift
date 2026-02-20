const { TILE, MAP_WIDTH, MAP_HEIGHT } = require('./constants');

const ZONES = [
  { id: 'camp', label: 'Camp', x1: 1, y1: 1, x2: 20, y2: 15 },
  { id: 'market', label: 'Market', x1: MAP_WIDTH - 20, y1: 1, x2: MAP_WIDTH - 2, y2: 14 },
  { id: 'forest', label: 'Forest', x1: 10, y1: 12, x2: MAP_WIDTH - 14, y2: MAP_HEIGHT - 10 },
  { id: 'outskirts', label: 'Outskirts', x1: 1, y1: MAP_HEIGHT - 12, x2: MAP_WIDTH - 2, y2: MAP_HEIGHT - 2 },
];

const SAFE_ZONE_BLUEPRINTS = [
  { id: 'safe-a', name: 'Safe Zone A', checkpointIndex: 0, maxHits: 5 },
  { id: 'safe-b', name: 'Safe Zone B', checkpointIndex: 1, maxHits: 5 },
  { id: 'safe-c', name: 'Safe Zone C', checkpointIndex: 2, maxHits: 6 },
  { id: 'safe-d', name: 'Safe Zone D', checkpointIndex: 3, maxHits: 6 },
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createGrid(width, height, value) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => value));
}

function isWalkable(tile) {
  return [TILE.GRASS, TILE.PATH, TILE.CHECKPOINT, TILE.OBJECTIVE, TILE.CHEST].includes(tile);
}

function placeRandomTiles(grid, tile, count, filterFn = () => true) {
  let placed = 0;
  let tries = 0;
  while (placed < count && tries < count * 40) {
    const x = randomInt(1, MAP_WIDTH - 2);
    const y = randomInt(1, MAP_HEIGHT - 2);
    if (grid[y][x] === TILE.GRASS && filterFn(x, y)) {
      grid[y][x] = tile;
      placed += 1;
    }
    tries += 1;
  }
}

function carvePath(grid, x1, y1, x2, y2) {
  let x = x1;
  let y = y1;
  while (x !== x2) {
    grid[y][x] = TILE.PATH;
    x += x < x2 ? 1 : -1;
  }
  while (y !== y2) {
    grid[y][x] = TILE.PATH;
    y += y < y2 ? 1 : -1;
  }
  grid[y][x] = TILE.PATH;
}

function getEntrancesForCheckpoint(grid, checkpoint) {
  const candidates = [
    { x: checkpoint.x, y: checkpoint.y - 1 },
    { x: checkpoint.x + 1, y: checkpoint.y },
    { x: checkpoint.x, y: checkpoint.y + 1 },
    { x: checkpoint.x - 1, y: checkpoint.y },
  ];

  return candidates.filter((pos) => {
    const tile = grid[pos.y]?.[pos.x];
    return tile !== undefined && tile !== TILE.TREE && tile !== TILE.ROCK && tile !== TILE.STALL;
  });
}

function buildSafeZones(grid, checkpoints) {
  return SAFE_ZONE_BLUEPRINTS.map((zoneDef) => {
    const checkpoint = checkpoints[zoneDef.checkpointIndex];
    const entrances = getEntrancesForCheckpoint(grid, checkpoint);

    return {
      id: zoneDef.id,
      name: zoneDef.name,
      tiles: [{ x: checkpoint.x, y: checkpoint.y }],
      entrances,
      maxHits: zoneDef.maxHits,
      remainingHits: zoneDef.maxHits,
      destroyed: false,
    };
  });
}

function generateMap() {
  const grid = createGrid(MAP_WIDTH, MAP_HEIGHT, TILE.GRASS);

  // Block borders so players stay in bounds.
  for (let x = 0; x < MAP_WIDTH; x += 1) {
    grid[0][x] = TILE.TREE;
    grid[MAP_HEIGHT - 1][x] = TILE.TREE;
  }
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    grid[y][0] = TILE.TREE;
    grid[y][MAP_WIDTH - 1] = TILE.TREE;
  }

  // A market block in top-right.
  for (let y = 2; y <= 11; y += 1) {
    for (let x = MAP_WIDTH - 18; x <= MAP_WIDTH - 6; x += 1) {
      grid[y][x] = TILE.STALL;
    }
  }

  // Main paths through camp.
  const midY = Math.floor(MAP_HEIGHT / 2);
  carvePath(grid, 2, midY, MAP_WIDTH - 3, midY);
  carvePath(grid, Math.floor(MAP_WIDTH / 4), 2, Math.floor(MAP_WIDTH / 4), MAP_HEIGHT - 3);
  carvePath(grid, Math.floor(MAP_WIDTH / 2), 4, Math.floor(MAP_WIDTH / 2), MAP_HEIGHT - 5);

  // Objective near bottom-right with a path around it.
  const objective = { x: MAP_WIDTH - 7, y: MAP_HEIGHT - 6 };
  carvePath(grid, Math.floor(MAP_WIDTH / 2), midY, objective.x, objective.y);
  grid[objective.y][objective.x] = TILE.OBJECTIVE;

  const checkpoints = [
    { x: 6, y: 5 },
    { x: Math.floor(MAP_WIDTH / 3), y: MAP_HEIGHT - 8 },
    { x: Math.floor(MAP_WIDTH / 2), y: midY + 4 },
    { x: MAP_WIDTH - 14, y: 10 },
  ];
  checkpoints.forEach((cp) => {
    grid[cp.y][cp.x] = TILE.CHECKPOINT;
  });

  const interiorTiles = (MAP_WIDTH - 2) * (MAP_HEIGHT - 2);
  placeRandomTiles(grid, TILE.TREE, Math.floor(interiorTiles * 0.095), (x, y) => Math.abs(x - objective.x) + Math.abs(y - objective.y) > 7);
  placeRandomTiles(grid, TILE.ROCK, Math.floor(interiorTiles * 0.06));
  placeRandomTiles(grid, TILE.CHEST, Math.floor(interiorTiles * 0.022));

  const spawns = [
    { x: 3, y: 3 },
    { x: 4, y: MAP_HEIGHT - 4 },
    { x: 8, y: midY },
    { x: 5, y: midY + 3 },
    { x: 10, y: 6 },
    { x: 12, y: MAP_HEIGHT - 7 },
  ];

  const safeZones = buildSafeZones(grid, checkpoints);

  return {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    worldWidth: MAP_WIDTH,
    worldHeight: MAP_HEIGHT,
    tiles: grid,
    objective,
    checkpoints,
    safeZones,
    spawns,
    zones: ZONES,
  };
}

module.exports = {
  generateMap,
  isWalkable,
};
