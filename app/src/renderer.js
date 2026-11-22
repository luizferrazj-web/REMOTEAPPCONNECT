const $ = (id) => document.getElementById(id);
let ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const CHUNK = 16 * 1024;

const password = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
$('myPass').textContent = password;
$('fixedPass').value = localStorage.getItem('fixedPass') || '';
$('saveFixed').onclick = () => {
  const v = $('fixedPass').value;
  if (v && v.length < 8) return alert('A senha fixa precisa ter pelo menos 8 caracteres.');
  if (v) localStorage.setItem('fixedPass', v); else localStorage.removeItem('fixedPass');
  alert(v ? 'Senha fixa salva.' : 'Senha fixa removida.');
};
const validPassword = (p) => p === password || (!!localStorage.getItem('fixedPass') && p === localStorage.getItem('fixedPass'));
$('status').addEventListener('dblclick', () => {
  if ((window.IDEIA_CONFIG.firebase || {}).apiKey) return;
  const s = prompt('Endereço do servidor de sinalização', localStorage.getItem('server') || 'ws://localhost:8080');
  if (s) { localStorage.setItem('server', s); location.reload(); }
});

let myId, pc, ctrl, fileCh, isHost = false, peerId = null, hostDisplays = null, offerTimer;

const transport = window.createTransport({
  onStatus: (t) => { $('status').textContent = t; },
  onRegistered: (id, iceServers) => {
    myId = id;
    if (iceServers && iceServers.length) ICE = { iceServers };
    localStorage.setItem('id', id);
    $('myId').textContent = id.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
    $('status').textContent = 'Pronto';
  },
  onError: () => { alert('ID não encontrado ou offline.'); endSession(); },
  onSignal: (from, data) => onSignal(from, data),
});
const send = (to, data) => transport.send(to, data);

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
    if (!validPassword(d.password)) return send(from, { kind: 'denied', reason: 'Senha incorreta.' });
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
    window.native.displays().then((list) => ctrl && ctrl.readyState === 'open' ? ctrl.send(JSON.stringify({ kind: 'displays', list })) : (hostDisplays = list));
  } else if (d.kind === 'answer' && pc) {
    clearTimeout(offerTimer);
    await pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
  } else if (d.kind === 'ice' && pc) {
    pc.addIceCandidate(d.candidate).catch(() => {});
  } else if (d.kind === 'denied') {
    clearTimeout(offerTimer);
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
  offerTimer = setTimeout(() => { alert('Sem resposta: a máquina está offline ou fechada.'); endSession(); }, 20000);
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
  clearTimeout(offerTimer);
  if (pc) { pc.onconnectionstatechange = null; pc.close(); }
  pc = ctrl = fileCh = null;
  $('video').srcObject = null;
  $('monitor').style.display = 'none';
  hostDisplays = null;
  $('session').style.display = 'none';
  $('home').style.display = 'flex';
  $('log').innerHTML = '';
}

// ---- Controle remoto ----
function setupCtrl(ch) {
  ctrl = ch;
  ch.onopen = () => {
    if (isHost && hostDisplays) ch.send(JSON.stringify({ kind: 'displays', list: hostDisplays }));
  };
  ch.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.kind === 'displays' && !isHost) {
      const sel = $('monitor');
      sel.innerHTML = '';
      m.list.forEach((d) => sel.add(new Option(d.name, d.id)));
      sel.style.display = m.list.length > 1 ? '' : 'none';
      sel.onchange = () => ctrl.send(JSON.stringify({ kind: 'display', id: Number(sel.value) }));
    } else if (m.kind === 'display' && isHost) {
      await window.native.selectDisplay(m.id);
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) { const old = sender.track; await sender.replaceTrack(stream.getVideoTracks()[0]); old.stop(); }
      } catch { /* mantém o monitor atual */ }
    } else if (m.t && isHost && $('allowControl').checked) window.native.input(m);
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
  v.onkeydown = (e) => {
    e.preventDefault();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    emit({ t: 'key', k: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
  };
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

transport.start();
