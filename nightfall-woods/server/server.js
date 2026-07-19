/* Nightfall Woods — multiplayer relay server.
 *
 * A tiny authoritative-relay WebSocket server: it assigns each player an id,
 * tells newcomers who's already here, and broadcasts position/rotation/night
 * updates to everyone else. Deliberately minimal — no world simulation, no
 * database. The forest and the creature stay client-side; this just lets
 * players see each other moving around the same woods.
 *
 * Run:
 *   cd nightfall-woods/server && npm install && npm start
 * Then in the game's start screen, tick "Play multiplayer" and point it at
 *   ws://localhost:8080   (or your host's address for LAN/remote play)
 */
'use strict';

const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

let nextId = 1;
const clients = new Map(); // id -> { ws, name, x, z, ry, night }

function broadcast(obj, exceptId) {
  const msg = JSON.stringify(obj);
  for (const [id, c] of clients) {
    if (id === exceptId) continue;
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(msg);
  }
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const client = { ws, name: 'Wanderer', x: 0, z: 10, ry: 0, night: 99 };
  clients.set(id, client);

  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }

    if (m.t === 'hello') {
      client.name = String(m.name || 'Wanderer').slice(0, 24);
      // tell the newcomer who's already connected
      const peers = [];
      for (const [pid, c] of clients) {
        if (pid === id) continue;
        peers.push({ id: pid, name: c.name });
      }
      ws.send(JSON.stringify({ t: 'welcome', id, peers }));
      // announce the newcomer to everyone else
      broadcast({ t: 'join', id, name: client.name }, id);
      console.log(`[+] ${client.name} joined (id ${id}) — ${clients.size} online`);
    } else if (m.t === 'state') {
      client.x = m.x; client.z = m.z; client.ry = m.ry; client.night = m.night;
      broadcast({ t: 'state', id, x: m.x, z: m.z, ry: m.ry, night: m.night, name: client.name }, id);
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    broadcast({ t: 'leave', id });
    console.log(`[-] ${client.name} left (id ${id}) — ${clients.size} online`);
  });

  ws.on('error', () => { /* connection errors clean up via close */ });
});

console.log(`Nightfall Woods relay listening on ws://localhost:${PORT}`);
