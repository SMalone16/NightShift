/**
 * Tile-based A* pathfinding helper.
 *
 * The returned path is a list of grid tiles [{x, y}, ...]
 * that starts with the first step after the start tile and
 * ends on the goal tile.
 */
function findPathAStar(options) {
  const {
    start,
    goal,
    width,
    height,
    isWalkable,
  } = options;

  if (!start || !goal || !isWalkable) return [];

  if (!isInside(start.x, start.y, width, height) || !isInside(goal.x, goal.y, width, height)) {
    return [];
  }

  if (start.x === goal.x && start.y === goal.y) {
    return [];
  }

  if (!isWalkable(goal.x, goal.y)) {
    return [];
  }

  const startKey = toKey(start.x, start.y);
  const goalKey = toKey(goal.x, goal.y);

  const open = [{ x: start.x, y: start.y, f: manhattan(start, goal) }];
  const openKeys = new Set([startKey]);
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const closed = new Set();

  while (open.length > 0) {
    const currentIndex = findLowestFScoreIndex(open);
    const current = open.splice(currentIndex, 1)[0];
    const currentKey = toKey(current.x, current.y);
    openKeys.delete(currentKey);

    if (currentKey === goalKey) {
      return reconstructPath(cameFrom, currentKey);
    }

    closed.add(currentKey);

    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];

    for (let i = 0; i < neighbors.length; i += 1) {
      const next = neighbors[i];
      const nextKey = toKey(next.x, next.y);

      if (!isInside(next.x, next.y, width, height)) continue;
      if (!isWalkable(next.x, next.y)) continue;
      if (closed.has(nextKey)) continue;

      const tentativeG = (gScore.get(currentKey) ?? Infinity) + 1;
      if (tentativeG >= (gScore.get(nextKey) ?? Infinity)) continue;

      cameFrom.set(nextKey, currentKey);
      gScore.set(nextKey, tentativeG);

      if (!openKeys.has(nextKey)) {
        open.push({
          x: next.x,
          y: next.y,
          f: tentativeG + manhattan(next, goal),
        });
        openKeys.add(nextKey);
      } else {
        const existing = open.find((item) => item.x === next.x && item.y === next.y);
        if (existing) {
          existing.f = tentativeG + manhattan(next, goal);
        }
      }
    }
  }

  return [];
}

function reconstructPath(cameFrom, endKey) {
  const path = [];
  let current = endKey;

  while (cameFrom.has(current)) {
    const { x, y } = fromKey(current);
    path.push({ x, y });
    current = cameFrom.get(current);
  }

  path.reverse();
  return path;
}

function findLowestFScoreIndex(open) {
  let best = 0;
  for (let i = 1; i < open.length; i += 1) {
    if (open[i].f < open[best].f) {
      best = i;
    }
  }
  return best;
}

function toKey(x, y) {
  return `${x},${y}`;
}

function fromKey(key) {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

function isInside(x, y, width, height) {
  return x >= 0 && y >= 0 && x < width && y < height;
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

module.exports = {
  findPathAStar,
};
