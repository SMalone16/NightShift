const { TILE, MAP_WIDTH, MAP_HEIGHT } = require('./constants');

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

  // A small market strip in top-right.
  for (let y = 2; y <= 5; y += 1) {
    for (let x = MAP_WIDTH - 8; x <= MAP_WIDTH - 4; x += 1) {
      grid[y][x] = TILE.STALL;
    }
  }

  // Main paths through camp.
  carvePath(grid, 2, Math.floor(MAP_HEIGHT / 2), MAP_WIDTH - 3, Math.floor(MAP_HEIGHT / 2));
  carvePath(grid, Math.floor(MAP_WIDTH / 3), 2, Math.floor(MAP_WIDTH / 3), MAP_HEIGHT - 3);

  // Objective near bottom-right with a path around it.
  const objective = { x: MAP_WIDTH - 5, y: MAP_HEIGHT - 4 };
  grid[objective.y][objective.x] = TILE.OBJECTIVE;
  carvePath(grid, Math.floor(MAP_WIDTH / 2), Math.floor(MAP_HEIGHT / 2), objective.x, objective.y);

  const checkpoints = [
    { x: 5, y: 4 },
    { x: Math.floor(MAP_WIDTH / 2), y: MAP_HEIGHT - 5 },
    { x: MAP_WIDTH - 10, y: 8 },
  ];
  checkpoints.forEach((cp) => {
    grid[cp.y][cp.x] = TILE.CHECKPOINT;
  });

  placeRandomTiles(grid, TILE.TREE, 42, (x, y) => Math.abs(x - objective.x) + Math.abs(y - objective.y) > 5);
  placeRandomTiles(grid, TILE.ROCK, 28);
  placeRandomTiles(grid, TILE.CHEST, 12);

  const spawns = [
    { x: 2, y: 2 },
    { x: 3, y: MAP_HEIGHT - 3 },
    { x: 6, y: Math.floor(MAP_HEIGHT / 2) },
    { x: 2, y: Math.floor(MAP_HEIGHT / 2) + 2 },
  ];

  return {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    tiles: grid,
    objective,
    checkpoints,
    spawns,
  };
}

module.exports = {
  generateMap,
  isWalkable,
};
