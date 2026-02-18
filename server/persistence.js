const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'data', 'users.json');

let usersCache = null;

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

function saveUsers() {
  if (!usersCache) return;
  fs.writeFileSync(DATA_PATH, JSON.stringify(usersCache, null, 2));
}

function getUserProfile(username) {
  const users = loadUsers();
  if (!users[username]) {
    users[username] = { xp: 0, level: 1 };
    saveUsers();
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
  saveUsers();
  return profile;
}

function touchUser(username, profile) {
  const users = loadUsers();
  users[username] = {
    xp: profile.xp,
    level: profile.level,
  };
  saveUsers();
}

module.exports = {
  getUserProfile,
  addXp,
  touchUser,
  levelFromXp,
};
