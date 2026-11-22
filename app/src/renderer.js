const $ = (id) => document.getElementById(id);
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
const cfg = window.IDEIA_CONFIG;
const PREFIX = 'ideia-remote-';
const serverUrl = localStorage.getItem('server') || cfg.server;

$('status').addEventListener('dblclick', () => {
  const s = prompt('Endereço do servidor de sinalização (vazio = serviço público)', serverUrl || '');
  if (s === null) return;
  if (s) localStorage.setItem('server', s); else localStorage.removeItem('server');
  location.reload();
});

// peer: ligação com o servidor de sinalização. conn: canal de controle da sessão atual.
// pc: a conexão direta entre as máquinas, por onde passam tela, controle e arquivos.
let peer, myId, conn, pc, fileCh, isHost = false, peerId = null, waitTimer;
const failures = [];

function peerOptions() {
  const o = { debug: 0, config: { iceServers: cfg.iceServers } };
  if (serverUrl) {
    const u = new URL(serverUrl);
    o.secure = u.protocol === 'wss:' || u.protocol === 'https:';
    o.host = u.hostname;
    o.port = Number(u.port) || (o.secure ? 443 : 80);
    o.path = u.pathname || '/';
  }
  return o;
}

function startPeer() {
  const saved = localStorage.getItem('id');
  myId = /^\d{9}$/.test(saved || '') ? saved : String(Math.floor(100000000 + Math.random() * 900000000));
  $('status').textContent = 'Conectando ao servidor…';
  peer = new Peer(PREFIX + myId, peerOptions());
  peer.on('open', () => {
    localStorage.setItem('id', myId);
    $('myId').textContent = myId.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
    $('status').textContent = 'Pronto';
  });
  peer.on('connection', onIncoming);
  peer.on('disconnected', () => {
    $('status').textContent = 'Sem conexão com o servidor — reconectando…';
    setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 3000);
  });
  peer.on('close', () => {
    $('status').textContent = 'Sem conexão com o servidor — reconectando…';
    setTimeout(startPeer, 4000);
  });
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') { localStorage.removeItem('id'); peer.destroy(); }
    else if (err.type === 'peer-unavailable') { if (conn && !isHost && !pc) fail('ID não encontrado ou computador offline.'); }
    else console.error('servidor de sinalização:', err.type);
  });
}

async function sha256(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, '0')).join('');
}
const fingerprint = (desc) => (desc.sdp.match(/a=fingerprint:(\S+ \S+)/) || [])[1];

// A prova amarra a senha às chaves desta conexão: um intermediário não consegue reaproveitá-la.
function proof(pass, nonce, rtc, viewerSide) {
  const local = fingerprint(rtc.currentLocalDescription), remote = fingerprint(rtc.currentRemoteDescription);
  if (!local || !remote) throw new Error('conexão sem impressão digital');
  return sha256([pass, nonce, viewerSide ? local : remote, viewerSide ? remote : local].join('\n'));
}

const setOverlay = (text) => { $('overlay').textContent = text; $('overlay').style.display = text ? 'flex' : 'none'; };
const sendCtrl = (obj) => { if (conn && conn.open) conn.send(obj); };

function fail(message) {
  endSession();
  alert(message);
}

const NETWORK_FAIL = 'Não foi possível conectar: a rede de um dos computadores bloqueou a conexão direta.';

// ---- Lado que é acessado ----
function onIncoming(c) {
  const from = c.peer.slice(PREFIX.length);
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');
  let authed = false;
  const deny = (reason) => { c.send({ kind: 'denied', reason }); setTimeout(() => c.close(), 500); };

  c.on('open', () => {
    const recent = failures.filter((t) => Date.now() - t < 10 * 60 * 1000);
    if (conn) return deny('Máquina ocupada.');
    if (recent.length >= 5) return deny('Muitas tentativas com senha errada. Aguarde alguns minutos.');
    c.send({ kind: 'challenge', nonce });
  });
  c.on('data', async (m) => {
    if (authed) return onCtrl(m);
    if (m.kind !== 'auth') return;
    const fixed = localStorage.getItem('fixedPass');
    const rtc = c.peerConnection;
    const ok = m.proof === await proof(password, nonce, rtc, false) || (!!fixed && m.proof === await proof(fixed, nonce, rtc, false));
    if (!ok) { failures.push(Date.now()); return deny('Senha incorreta.'); }
    if (conn) return deny('Máquina ocupada.');
    authed = true;
    isHost = true;
    conn = c;
    pc = rtc;
    peerId = from;
    watchConnection();
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
    } catch (err) {
      conn = pc = peerId = null;
      return deny('O computador remoto não conseguiu capturar a tela (verifique a permissão de gravação de tela).');
    }
    if (conn !== c) return stream.getTracks().forEach((t) => t.stop());
    c.send({ kind: 'ok', displays: await window.native.displays() });
    setupFile(pc.createDataChannel('file'));
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    c.send({ kind: 'sdp', desc: { type: offer.type, sdp: offer.sdp } });
    showSession(`Sua tela está sendo acessada por ${from}`);
  });
  c.on('close', () => { if (conn === c) endSession(); });
}

// ---- Lado que acessa ----
$('connect').onclick = () => {
  const to = $('remoteId').value.replace(/\s/g, '');
  if (!/^\d{9}$/.test(to)) return alert('Digite um ID de 9 dígitos.');
  if (to === myId) return alert('Esse é o ID deste computador. Digite o ID do outro.');
  if (conn) return;
  if (!peer || !peer.open) return alert('Ainda sem conexão com o servidor. Aguarde aparecer "Pronto" e tente de novo.');
  const pass = $('remotePass').value.trim();
  isHost = false;
  peerId = to;
  const c = peer.connect(PREFIX + to, { reliable: true, serialization: 'json' });
  conn = c;
  showSession(`Conectado a ${to}`);
  setOverlay('Conectando…');
  waitTimer = setTimeout(() => fail('Sem resposta: o outro computador está offline, com o app fechado, ou a rede bloqueou a conexão.'), 30000);

  c.on('data', async (m) => {
    if (conn !== c) return;
    if (m.kind === 'challenge') {
      const rtc = c.peerConnection;
      rtc.ondatachannel = (e) => { if (e.channel.label === 'file') setupFile(e.channel); };
      rtc.ontrack = (e) => {
        const v = $('video');
        v.srcObject = e.streams[0] || new MediaStream([e.track]);
        v.onloadeddata = () => setOverlay('');
        v.play().catch(() => {});
      };
      c.send({ kind: 'auth', proof: await proof(pass, m.nonce, rtc, true) });
    } else if (m.kind === 'denied') {
      fail(m.reason);
    } else if (m.kind === 'ok') {
      clearTimeout(waitTimer);
      pc = c.peerConnection;
      watchConnection();
      setOverlay('Carregando a tela…');
      showDisplays(m.displays);
      bindInput();
    } else if (pc) onCtrl(m);
  });
  c.on('error', () => { if (conn === c && !pc) fail(NETWORK_FAIL); });
  c.on('close', () => { if (conn === c) endSession(); });
};

function watchConnection() {
  const mine = pc;
  mine.addEventListener('connectionstatechange', () => {
    if (pc !== mine) return;
    if (mine.connectionState === 'disconnected') setOverlay('Conexão instável — reconectando…');
    else if (mine.connectionState === 'connected' && $('video').videoWidth) setOverlay('');
    else if (mine.connectionState === 'failed') fail('A conexão caiu.');
  });
}

$('disconnect').onclick = () => {
  sendCtrl({ kind: 'bye' });
  setTimeout(endSession, 150);
};

function showSession(text) {
  $('home').style.display = 'none';
  $('session').style.display = 'flex';
  $('peerInfo').textContent = text;
  $('screenWrap').style.display = isHost ? 'none' : 'flex';
  $('files').style.flex = isHost ? '1' : '';
}

function endSession() {
  clearTimeout(waitTimer);
  const c = conn, old = pc;
  conn = pc = fileCh = peerId = null;
  if (old) old.getSenders().forEach((s) => s.track && s.track.stop());
  if (c) c.close();
  $('video').srcObject = null;
  setOverlay('');
  $('monitor').style.display = 'none';
  $('session').style.display = 'none';
  $('home').style.display = 'flex';
  $('log').innerHTML = '';
}

function showDisplays(list) {
  const sel = $('monitor');
  sel.innerHTML = '';
  list.forEach((d) => sel.add(new Option(d.name, d.id)));
  sel.style.display = list.length > 1 ? '' : 'none';
  sel.onchange = () => sendCtrl({ kind: 'display', id: Number(sel.value) });
}

// ---- Mensagens de controle (já autenticadas) ----
async function onCtrl(m) {
  if (m.kind === 'bye') endSession();
  else if (m.kind === 'sdp') {
    // A tela entra na mesma conexão já autenticada; a negociação passa pelo próprio canal.
    await pc.setRemoteDescription(m.desc);
    if (m.desc.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendCtrl({ kind: 'sdp', desc: { type: answer.type, sdp: answer.sdp } });
    }
  } else if (m.kind === 'display' && isHost) {
    await window.native.selectDisplay(m.id);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) { const old = sender.track; await sender.replaceTrack(stream.getVideoTracks()[0]); old.stop(); }
    } catch { /* mantém o monitor atual */ }
  } else if (m.t && isHost && $('allowControl').checked) window.native.input(m);
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
  const emit = sendCtrl;
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

const saving = [];
window.native.onDownload((d) => {
  const s = saving.shift();
  if (!s) return;
  URL.revokeObjectURL(s.url);
  s.el.textContent = d.ok ? `✓ Recebido: ${d.name} (pasta Downloads — clique para abrir)` : `✗ Falha ao salvar ${d.name}`;
  if (d.ok) { s.el.style.cursor = 'pointer'; s.el.dataset.path = d.path; s.el.onclick = () => window.native.showFile(d.path); }
});

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
        incoming.el.textContent = `Salvando ${incoming.name}…`;
        saving.push({ el: incoming.el, url: a.href });
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

window.native.status().then((s) => {
  const warn = [];
  if (!s.control) warn.push('O controle de mouse e teclado não está disponível neste computador.');
  if (s.platform === 'darwin' && !s.screen) warn.push('Autorize "Gravação de Tela" para este app, senão a tela aparece preta para quem conecta.');
  if (s.platform === 'darwin' && !s.accessibility) warn.push('Autorize "Acessibilidade" para permitir o controle remoto.');
  if (!warn.length) return;
  $('warn').textContent = warn.join(' ');
  $('warn').style.display = 'block';
  if (s.platform === 'darwin') $('warn').onclick = () => window.native.openPrivacy();
});

startPeer();
