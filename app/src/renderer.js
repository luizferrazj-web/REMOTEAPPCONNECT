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
$('status').addEventListener('dblclick', () => {
  if ((window.IDEIA_CONFIG.firebase || {}).apiKey) return;
  const s = prompt('Endereço do servidor de sinalização', localStorage.getItem('server') || 'ws://localhost:8080');
  if (s) { localStorage.setItem('server', s); location.reload(); }
});

let myId, pc, ctrl, fileCh, isHost = false, peerId = null, hostDisplays = null, waitTimer;
let remoteSet = false, pendingIce = [];

const transport = window.createTransport({
  onStatus: (t) => { $('status').textContent = t; },
  onRegistered: (id, iceServers) => {
    myId = id;
    if (iceServers && iceServers.length) ICE = { iceServers };
    localStorage.setItem('id', id);
    $('myId').textContent = id.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
    $('status').textContent = 'Pronto';
  },
  onError: () => { if (pc && !isHost && pc.connectionState !== 'connected') fail('ID não encontrado ou computador offline.'); },
  onSignal: (from, data) => onSignal(from, data).catch((err) => console.error('sinalização', err)),
});
const send = (to, data) => transport.send(to, data);

async function proof(pass, sdp) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${pass}\n${sdp}`));
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, '0')).join('');
}

const setOverlay = (text) => { $('overlay').textContent = text; $('overlay').style.display = text ? 'flex' : 'none'; };

function fail(message) {
  endSession();
  alert(message);
}

function newPC(remote) {
  const policy = localStorage.getItem('icePolicy') === 'relay' ? 'relay' : 'all';
  pc = new RTCPeerConnection({ ...ICE, iceTransportPolicy: policy });
  peerId = remote;
  remoteSet = false;
  pendingIce = [];
  const mine = pc;
  pc.onicecandidate = (e) => e.candidate && send(remote, { kind: 'ice', candidate: e.candidate.toJSON() });
  pc.onconnectionstatechange = () => {
    if (pc !== mine) return;
    const s = pc.connectionState;
    if (s === 'connected') { clearTimeout(waitTimer); if (!isHost) setOverlay($('video').videoWidth ? '' : 'Carregando a tela…'); }
    else if (s === 'disconnected') setOverlay('Conexão instável — reconectando…');
    else if (s === 'failed') fail('Não foi possível conectar: a rede de um dos computadores bloqueou a conexão.');
  };
}

// Candidatos podem chegar antes da descrição remota; guarda e aplica depois.
async function applyRemote(desc) {
  await pc.setRemoteDescription(desc);
  remoteSet = true;
  pendingIce.splice(0).forEach((c) => pc.addIceCandidate(c).catch(() => {}));
}

async function onSignal(from, d) {
  if (d.kind === 'offer') {
    if (pc) return send(from, { kind: 'denied', reason: 'Máquina ocupada.' });
    isHost = true;
    newPC(from);
    const mine = pc;
    pc.ondatachannel = (e) => (e.channel.label === 'ctrl' ? setupCtrl(e.channel) : setupFile(e.channel));
    const fixed = localStorage.getItem('fixedPass');
    const ok = d.proof === await proof(password, d.sdp) || (!!fixed && d.proof === await proof(fixed, d.sdp));
    if (pc !== mine) return;
    if (!ok) { endSession(); return send(from, { kind: 'denied', reason: 'Senha incorreta.' }); }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      if (pc !== mine) return stream.getTracks().forEach((t) => t.stop());
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    } catch (err) {
      endSession();
      return send(from, { kind: 'denied', reason: 'O computador remoto não conseguiu capturar a tela (verifique as permissões de gravação de tela).' });
    }
    await applyRemote({ type: 'offer', sdp: d.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send(from, { kind: 'answer', sdp: answer.sdp });
    showSession(`Sua tela está sendo acessada por ${from}`);
    window.native.displays().then((list) => (ctrl && ctrl.readyState === 'open' ? ctrl.send(JSON.stringify({ kind: 'displays', list })) : (hostDisplays = list)));
  } else if (!pc || from !== peerId) {
    return;
  } else if (d.kind === 'answer' && !isHost) {
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => fail('Não foi possível conectar: a rede de um dos computadores bloqueou a conexão.'), 30000);
    await applyRemote({ type: 'answer', sdp: d.sdp });
  } else if (d.kind === 'ice') {
    if (remoteSet) pc.addIceCandidate(d.candidate).catch(() => {});
    else pendingIce.push(d.candidate);
  } else if (d.kind === 'denied' && !isHost) {
    fail(d.reason);
  }
}

$('connect').onclick = async () => {
  const to = $('remoteId').value.replace(/\s/g, '');
  if (!/^\d{9}$/.test(to)) return alert('Digite um ID de 9 dígitos.');
  if (to === myId) return alert('Esse é o ID deste computador. Digite o ID do outro.');
  if (pc) return;
  isHost = false;
  newPC(to);
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.ontrack = (e) => {
    const v = $('video');
    v.srcObject = e.streams[0] || new MediaStream([e.track]);
    v.onloadeddata = () => setOverlay('');
    v.play().catch(() => {});
  };
  setupCtrl(pc.createDataChannel('ctrl'));
  setupFile(pc.createDataChannel('file'));
  showSession(`Conectado a ${to}`);
  setOverlay('Conectando…');
  bindInput();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send(to, { kind: 'offer', sdp: offer.sdp, proof: await proof($('remotePass').value.trim(), offer.sdp) });
  waitTimer = setTimeout(() => fail('Sem resposta: o outro computador está offline ou com o app fechado.'), 20000);
};

$('disconnect').onclick = () => {
  if (ctrl && ctrl.readyState === 'open') ctrl.send(JSON.stringify({ kind: 'bye' }));
  setTimeout(endSession, 100);
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
  if (pc) {
    pc.getSenders().forEach((s) => s.track && s.track.stop());
    pc.close();
  }
  pc = ctrl = fileCh = peerId = null;
  $('video').srcObject = null;
  setOverlay('');
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
  ch.onclose = () => { if (ctrl === ch) endSession(); };
  ch.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.kind === 'bye') endSession();
    else if (m.kind === 'displays' && !isHost) {
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

transport.start();
