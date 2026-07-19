/* Nightfall Woods — multiplayer client.
 * Thin WebSocket wrapper around the relay server in server/server.js.
 * Entirely optional: if the player never connects, the game runs fully
 * offline in single-player. Exposes window.Net.
 *
 * Wire protocol (JSON messages):
 *   server -> client: {t:'welcome', id, peers:[{id,name}]}
 *                     {t:'join', id, name}
 *                     {t:'state', id, x, z, ry, night, name}
 *                     {t:'leave', id}
 *   client -> server: {t:'hello', name}
 *                     {t:'state', x, z, ry, night}
 */
'use strict';

const Net = (() => {
  let ws = null;
  let selfId = null;
  let connected = false;
  let handlers = {};   // { onWelcome, onJoin, onState, onLeave, onOpen, onClose, onError }
  let sendTimer = null;
  let getLocalState = null;

  function connect(url, name, localStateFn, cbs) {
    handlers = cbs || {};
    getLocalState = localStateFn;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      if (handlers.onError) handlers.onError('Bad server URL');
      return;
    }
    ws.addEventListener('open', () => {
      connected = true;
      ws.send(JSON.stringify({ t: 'hello', name: name || 'Wanderer' }));
      // push local state ~12x/sec
      sendTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN && getLocalState) {
          const s = getLocalState();
          if (s) ws.send(JSON.stringify({ t: 'state', x: s.x, z: s.z, ry: s.ry, night: s.night }));
        }
      }, 80);
      if (handlers.onOpen) handlers.onOpen();
    });
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.t) {
        case 'welcome': selfId = m.id; if (handlers.onWelcome) handlers.onWelcome(m); break;
        case 'join': if (handlers.onJoin) handlers.onJoin(m); break;
        case 'state': if (m.id !== selfId && handlers.onState) handlers.onState(m); break;
        case 'leave': if (handlers.onLeave) handlers.onLeave(m); break;
      }
    });
    ws.addEventListener('close', () => {
      connected = false;
      if (sendTimer) { clearInterval(sendTimer); sendTimer = null; }
      if (handlers.onClose) handlers.onClose();
    });
    ws.addEventListener('error', () => {
      if (handlers.onError) handlers.onError('Connection error');
    });
  }

  function disconnect() {
    if (sendTimer) { clearInterval(sendTimer); sendTimer = null; }
    if (ws) { try { ws.close(); } catch {} ws = null; }
    connected = false;
  }

  return {
    connect, disconnect,
    get connected() { return connected; },
    get id() { return selfId; },
  };
})();

window.Net = Net;
