const fs = require('fs');
const path = require('path');
const { promises: fsPromises } = fs;

const DATA_PATH = path.join(__dirname, 'data', 'users.json');
const FLUSH_DEBOUNCE_MS = 3000;
const FLUSH_INTERVAL_MS = 5000;

let usersCache = null;
let dirtyUsernames = new Set();
let flushTimer = null;
let flushInFlight = false;
let flushRequested = false;

function loadUsers() {
  if (usersCache) return usersCache;
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    usersCache = JSON.parse(raw || '{}');
  } catch (err) {
    usersCache = {};
  }
  return usersCache;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushUsers();
  }, FLUSH_DEBOUNCE_MS);
}

async function flushUsers() {
  if (!usersCache || dirtyUsernames.size === 0) {
    return;
  }

  if (flushInFlight) {
    flushRequested = true;
    return;
  }

  flushInFlight = true;
  const toFlush = dirtyUsernames;
  dirtyUsernames = new Set();

  try {
    await fsPromises.writeFile(DATA_PATH, JSON.stringify(usersCache, null, 2));
  } catch (err) {
    for (const username of toFlush) {
      dirtyUsernames.add(username);
    }
    console.error('Failed to flush user profiles:', err);
  } finally {
    flushInFlight = false;
    if (flushRequested) {
      flushRequested = false;
      flushUsers();
    }
  }
}

function markUserDirty(username) {
  dirtyUsernames.add(username);
  scheduleFlush();
}

setInterval(() => {
  flushUsers();
}, FLUSH_INTERVAL_MS).unref();

async function flushAndExit(code = 0) {
  try {
    await flushUsers();
  } finally {
    process.exit(code);
  }
}

process.once('SIGINT', () => flushAndExit(0));
process.once('SIGTERM', () => flushAndExit(0));
process.once('SIGHUP', () => flushAndExit(0));
process.once('beforeExit', () => flushUsers());

function getUserProfile(username) {
  const users = loadUsers();
  if (!users[username]) {
    users[username] = { xp: 0, level: 1, character: 'ranger' };
    markUserDirty(username);
  }
  return users[username];
}

function levelFromXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
}

function addXp(username, amount) {
  const profile = getUserProfile(username);
  profile.xp += amount;
  profile.level = levelFromXp(profile.xp);
  markUserDirty(username);
  return profile;
}

function touchUser(username, profile) {
  const users = loadUsers();
  users[username] = {
    xp: profile.xp,
    level: profile.level,
    character: profile.character || 'ranger',
  };
  markUserDirty(username);
}

module.exports = {
  getUserProfile,
  addXp,
  touchUser,
  levelFromXp,
};
