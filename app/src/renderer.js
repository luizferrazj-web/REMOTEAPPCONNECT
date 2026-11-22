const $ = (id) => document.getElementById(id);
const SERVER = localStorage.getItem('server') || 'ws://localhost:8080';
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const CHUNK = 16 * 1024;

const password = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
$('myPass').textContent = password;
$('status').addEventListener('dblclick', () => {
  const s = prompt('Endereço do servidor de sinalização', SERVER);
  if (s) { localStorage.setItem('server', s); location.reload(); }
});

let ws, myId, pc, ctrl, fileCh, isHost = false, peerId = null;

function connectSignaling() {
  ws = new WebSocket(SERVER);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'register', id: localStorage.getItem('id') }));
  ws.onclose = () => { $('status').textContent = 'Servidor offline — tentando de novo…'; setTimeout(connectSignaling, 3000); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'registered') {
      myId = m.id;
      localStorage.setItem('id', myId);
      $('myId').textContent = myId.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
      $('status').textContent = 'Pronto (duplo clique para trocar o servidor)';
    } else if (m.type === 'error') {
      alert('ID não encontrado ou offline.');
      endSession();
    } else if (m.type === 'signal') onSignal(m.from, m.data);
  };
}
const send = (to, data) => ws.send(JSON.stringify({ type: 'signal', to, data }));

function newPC(remote) {
  pc = new RTCPeerConnection(ICE);
  peerId = remote;
  pc.onicecandidate = (e) => e.candidate && send(remote, { kind: 'ice', candidate: e.candidate });
  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) endSession();
  };
}

async function onSignal(from, d) {
  if (d.kind === 'offer') {
    if (pc) return send(from, { kind: 'denied', reason: 'Máquina ocupada.' });
    if (d.password !== password) return send(from, { kind: 'denied', reason: 'Senha incorreta.' });
    isHost = true;
    newPC(from);
    pc.ondatachannel = (e) => (e.channel.label === 'ctrl' ? setupCtrl(e.channel) : setupFile(e.channel));
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    } catch { return endSession(); }
    await pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send(from, { kind: 'answer', sdp: answer.sdp });
    showSession(`Controlado por ${from}`);
  } else if (d.kind === 'answer' && pc) {
    await pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
  } else if (d.kind === 'ice' && pc) {
    pc.addIceCandidate(d.candidate).catch(() => {});
  } else if (d.kind === 'denied') {
    alert(d.reason);
    endSession();
  }
}

$('connect').onclick = async () => {
  const to = $('remoteId').value.replace(/\s/g, '');
  if (!/^\d{9}$/.test(to)) return alert('Digite um ID de 9 dígitos.');
  if (pc) return;
  isHost = false;
  newPC(to);
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.ontrack = (e) => { $('video').srcObject = e.streams[0]; };
  setupCtrl(pc.createDataChannel('ctrl'));
  setupFile(pc.createDataChannel('file'));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send(to, { kind: 'offer', sdp: offer.sdp, password: $('remotePass').value });
  showSession(`Conectado a ${to}`);
  bindInput();
};

$('disconnect').onclick = endSession;

function showSession(text) {
  $('home').style.display = 'none';
  $('session').style.display = 'flex';
  $('peerInfo').textContent = text;
  $('screenWrap').style.display = isHost ? 'none' : 'flex';
}

function endSession() {
  if (pc) { pc.onconnectionstatechange = null; pc.close(); }
  pc = ctrl = fileCh = null;
  $('video').srcObject = null;
  $('session').style.display = 'none';
  $('home').style.display = 'flex';
  $('log').innerHTML = '';
}

// ---- Controle remoto ----
function setupCtrl(ch) {
  ctrl = ch;
  ch.onmessage = (e) => {
    if (isHost && $('allowControl').checked) window.native.input(JSON.parse(e.data));
  };
}

function bindInput() {
  const v = $('video');
  const norm = (e) => {
    const r = v.getBoundingClientRect();
    const ar = v.videoWidth / v.videoHeight || r.width / r.height;
    let w = r.width, h = r.height;
    if (w / h > ar) w = h * ar; else h = w / ar;
    const ox = (r.width - w) / 2, oy = (r.height - h) / 2;
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left - ox) / w)), y: Math.min(1, Math.max(0, (e.clientY - r.top - oy) / h)) };
  };
  const emit = (o) => ctrl && ctrl.readyState === 'open' && ctrl.send(JSON.stringify(o));
  let last = 0;
  v.onmousemove = (e) => { if (Date.now() - last > 30) { last = Date.now(); emit({ t: 'move', ...norm(e) }); } };
  v.onmousedown = (e) => { v.focus(); emit({ t: 'down', b: e.button, ...norm(e) }); };
  v.onmouseup = (e) => emit({ t: 'up', b: e.button, ...norm(e) });
  v.oncontextmenu = (e) => e.preventDefault();
  v.onwheel = (e) => { e.preventDefault(); emit({ t: 'scroll', dy: e.deltaY }); };
  v.onkeydown = (e) => { e.preventDefault(); emit({ t: 'key', k: e.key }); };
}

// ---- Transferência de arquivos ----
const log = (text) => {
  const d = document.createElement('div');
  d.className = 'item';
  d.textContent = text;
  $('log').prepend(d);
  return d;
};

function setupFile(ch) {
  fileCh = ch;
  ch.binaryType = 'arraybuffer';
  ch.bufferedAmountLowThreshold = 1 << 20;
  let incoming = null;
  ch.onmessage = (e) => {
    if (typeof e.data === 'string') {
      const m = JSON.parse(e.data);
      if (m.kind === 'start') incoming = { name: m.name, size: m.size, parts: [], got: 0, el: log(`↓ ${m.name} 0%`) };
      else if (m.kind === 'end' && incoming) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(incoming.parts));
        a.download = incoming.name.replace(/[\\/]/g, '_');
        a.click();
        incoming.el.textContent = `✓ Recebido: ${incoming.name}`;
        incoming = null;
      }
    } else if (incoming) {
      incoming.parts.push(e.data);
      incoming.got += e.data.byteLength;
      incoming.el.textContent = `↓ ${incoming.name} ${Math.round((incoming.got / incoming.size) * 100)}%`;
    }
  };
}

let sending = Promise.resolve();
function sendFile(file) {
  sending = sending.then(async () => {
    if (!fileCh || fileCh.readyState !== 'open') return log('Conexão de arquivos indisponível.');
    const el = log(`↑ ${file.name} 0%`);
    fileCh.send(JSON.stringify({ kind: 'start', name: file.name, size: file.size }));
    for (let off = 0; off < file.size; off += CHUNK) {
      if (fileCh.bufferedAmount > 4 << 20) await new Promise((r) => (fileCh.onbufferedamountlow = r));
      fileCh.send(await file.slice(off, off + CHUNK).arrayBuffer());
      el.textContent = `↑ ${file.name} ${Math.round((Math.min(off + CHUNK, file.size) / file.size) * 100)}%`;
    }
    fileCh.send(JSON.stringify({ kind: 'end' }));
    el.textContent = `✓ Enviado: ${file.name}`;
  });
}

$('pick').onclick = () => $('fileInput').click();
$('fileInput').onchange = (e) => { [...e.target.files].forEach(sendFile); e.target.value = ''; };
const drop = $('files');
drop.ondragover = (e) => { e.preventDefault(); $('drop').classList.add('over'); };
drop.ondragleave = () => $('drop').classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); $('drop').classList.remove('over'); [...e.dataTransfer.files].forEach(sendFile); };

connectSignaling();
