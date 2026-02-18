const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Game } = require('./game');

const PORT = process.env.PORT || 3000;
const TICK_RATE = 60;
const BROADCAST_MS = 100;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'client')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const game = new Game();

let clientCounter = 1;
const clientSockets = new Map();

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

wss.on('connection', (ws) => {
  const clientId = `p${clientCounter++}`;
  clientSockets.set(clientId, ws);

  send(ws, { type: 'hello', clientId });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join' && typeof msg.username === 'string') {
      const username = msg.username.trim().slice(0, 20) || `Ranger-${clientId}`;
      const player = game.addPlayer(clientId, username);
      send(ws, { type: 'joined', playerId: player.id, username: player.username });
      return;
    }

    if (msg.type === 'input') {
      game.setInput(clientId, msg.payload || {});
    }
  });

  ws.on('close', () => {
    game.removePlayer(clientId);
    clientSockets.delete(clientId);
  });
});

let last = Date.now() / 1000;
setInterval(() => {
  const now = Date.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  game.tick(dt, now);
}, 1000 / TICK_RATE);

setInterval(() => {
  const snapshot = game.getSnapshot();
  const payload = JSON.stringify({ type: 'snapshot', snapshot });
  clientSockets.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  });
}, BROADCAST_MS);

server.listen(PORT, () => {
  console.log(`Night Shift server running on http://localhost:${PORT}`);
});
