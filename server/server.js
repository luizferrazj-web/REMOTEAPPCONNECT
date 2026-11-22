// Servidor de sinalização: só troca mensagens de handshake WebRTC.
// Vídeo, controle e arquivos vão direto entre as máquinas (P2P).
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });
const peers = new Map(); // id -> socket

// TURN opcional: TURN_URL=turn:host:3478 TURN_USER=... TURN_PASS=...
const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
if (process.env.TURN_URL) {
  iceServers.push({ urls: process.env.TURN_URL, username: process.env.TURN_USER, credential: process.env.TURN_PASS });
}

function newId() {
  let id;
  do { id = String(Math.floor(100000000 + Math.random() * 900000000)); } while (peers.has(id));
  return id;
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'register') {
      const wanted = /^\d{9}$/.test(msg.id || '') && !peers.has(msg.id) ? msg.id : newId();
      ws.id = wanted;
      peers.set(wanted, ws);
      ws.send(JSON.stringify({ type: 'registered', id: wanted, iceServers }));
    } else if (msg.type === 'signal' && ws.id) {
      const target = peers.get(msg.to);
      if (!target) return ws.send(JSON.stringify({ type: 'error', code: 'not-found', to: msg.to }));
      target.send(JSON.stringify({ type: 'signal', from: ws.id, data: msg.data }));
    }
  });
  ws.on('close', () => { if (ws.id && peers.get(ws.id) === ws) peers.delete(ws.id); });
});

console.log(`Sinalização ouvindo na porta ${PORT}`);
