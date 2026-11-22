// Teste ponta a ponta: abre dois apps, conecta B -> A e confere tela, controle, arquivos e desconexão.
//   SIGNALING=local (padrão, sobe um PeerServer local) | public (serviço público padrão do app)
//   ELECTRON_BIN aponta para outro binário do Electron.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.join(__dirname, '..');
const BIN = process.env.ELECTRON_BIN || require('electron');
const PUBLIC = process.env.SIGNALING === 'public';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ideia-e2e-'));
const procs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, label) => { console.log(`${ok ? 'OK  ' : 'FALHA'} ${label}`); if (!ok) throw new Error(label); };

async function until(fn, ms, label) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(500); }
  throw new Error(`tempo esgotado: ${label}`);
}

async function launch(name, port) {
  const p = spawn(BIN, [APP, '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(TMP, name)}`], { stdio: ['ignore', 'ignore', 'pipe'] });
  p.stderr.on('data', (d) => String(d).split('\n').filter((l) => /input error|AddIceCandidate|Uncaught/.test(l)).forEach((l) => console.log(`[${name}] ${l}`)));
  procs.push(p);
  const page = await until(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { return null; }
  }, 30000, `${name} abrir`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0;
  const pending = new Map();
  const alerts = [];
  const cdp = (method, params = {}) => new Promise((r) => { pending.set(++seq, r); ws.send(JSON.stringify({ id: seq, method, params })); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
    else if (m.method === 'Page.javascriptDialogOpening') { alerts.push(m.params.message); console.log(`[${name}] alerta: ${m.params.message}`); cdp('Page.handleJavaScriptDialog', { accept: true }); }
    else if (m.method === 'Runtime.exceptionThrown') console.log(`[${name}] erro: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.log(`[${name}] console: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  };
  const ev = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(`${name}: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
    return r.result.result.value;
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  return { ev, alerts, name };
}

const text = (x, id) => x.ev(`document.getElementById('${id}').textContent`);
const shown = (x, id) => x.ev(`getComputedStyle(document.getElementById('${id}')).display !== 'none'`);
const connect = (x, id, pass) => x.ev(`document.getElementById('remoteId').value='${id}'; document.getElementById('remotePass').value='${pass}'; document.getElementById('connect').click(); 1`);
const brightness = (x) => x.ev(`(() => { const v = document.getElementById('video'); if (!v.videoWidth) return 0; const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 64, 36); return g.getImageData(0, 0, 64, 36).data.reduce((a, b, i) => (i % 4 === 3 ? a : a + b), 0); })()`);

async function transfer(from, to, name, body) {
  await from.ev(`sendFile(new File([${JSON.stringify(body)}], '${name}')); 1`);
  const saved = await until(() => to.ev(`(document.querySelector('#log .item[data-path]') || {dataset:{}}).dataset.path || ''`), 20000, `receber ${name}`);
  check(fs.readFileSync(saved, 'utf8') === body, `arquivo ${from.name} -> ${to.name} salvo em ${saved}`);
  fs.unlinkSync(saved);
}

(async () => {
  console.log(`sinalização=${PUBLIC ? 'pública' : 'local'} plataforma=${process.platform}`);
  if (!PUBLIC) {
    procs.push(spawn(process.execPath, [path.join(APP, 'node_modules', 'peer', 'dist', 'bin', 'peerjs.js'), '--port', '9123', '--path', '/', '--host', '127.0.0.1'], { stdio: 'ignore' }));
    await sleep(1500);
  }
  const A = await launch('A', 9331);
  const B = await launch('B', 9332);
  for (const x of [A, B]) {
    await x.ev(`${PUBLIC ? "localStorage.removeItem('server');" : "localStorage.setItem('server','ws://127.0.0.1:9123/');"} location.reload(); 1`);
  }
  await sleep(1500);
  for (const x of [A, B]) await until(async () => (await text(x, 'status')) === 'Pronto', 30000, `${x.name} registrar na sinalização`);
  const id = (await text(A, 'myId')).replace(/\s/g, '');
  const pass = await text(A, 'myPass');
  check(/^\d{9}$/.test(id), `A recebeu ID ${id}`);
  const status = await A.ev('window.native.status()');
  console.log('status A:', JSON.stringify(status));

  await connect(B, id, 'senha-errada');
  await until(() => B.alerts.some((a) => a.includes('Senha incorreta')), 25000, 'recusa de senha errada');
  check(await shown(B, 'home') && await shown(A, 'home'), 'senha errada é recusada e os dois voltam ao início');

  await connect(B, id, pass);
  const px = await until(() => brightness(B), 45000, 'vídeo da tela remota');
  check(px > 0, `B vê a tela de A (brilho ${px})`);
  check(!(await shown(B, 'overlay')), 'aviso de "conectando" some');
  console.log('caminho:', await B.ev(`pc.getStats().then((s) => { let o = ''; s.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') o = s.get(r.localCandidateId).candidateType + ' <-> ' + s.get(r.remoteCandidateId).candidateType; }); return o; })`));

  await transfer(B, A, 'de-b.txt', 'conteúdo enviado por B '.repeat(5000));
  await transfer(A, B, 'de-a.txt', 'conteúdo enviado por A '.repeat(5000));

  if (status.control) {
    const { mouse } = require('@nut-tree-fork/nut-js');
    const moved = async (fx, fy) => {
      await B.ev(`sendCtrl({ t: 'move', x: ${fx}, y: ${fy} }); 1`);
      const [w, h] = await A.ev(`[screen.width, screen.height].map((v) => v * (${process.platform === 'darwin'} ? 1 : devicePixelRatio))`);
      let pos;
      for (let i = 0; i < 20; i++) {
        await sleep(300);
        pos = await mouse.getPosition();
        if (Math.abs(pos.x - fx * w) < 8 && Math.abs(pos.y - fy * h) < 8) return true;
      }
      console.log(`  cursor em ${pos.x},${pos.y} — esperado ${Math.round(fx * w)},${Math.round(fy * h)}`);
      return false;
    };
    const ok = [await moved(0.3, 0.4), await moved(0.5, 0.5), await moved(0.2, 0.6)].every(Boolean);
    // Nos runners de macOS a permissão de Acessibilidade pode não estar concedida ao app.
    if (process.platform === 'darwin' && !ok) console.log('AVISO mouse não obedeceu (permissão de Acessibilidade do macOS)');
    else check(ok, 'mouse de A obedece ao comando de B');
  } else console.log('AVISO controle de mouse indisponível nesta máquina — não testado');

  await B.ev(`document.getElementById('disconnect').click(); 1`);
  await until(async () => (await shown(A, 'home')) && (await shown(B, 'home')), 10000, 'desconexão');
  check(true, 'desconectar devolve os dois ao início');
  console.log('TUDO OK');
})().then(() => 0, (e) => { console.error('TESTE FALHOU:', e.message); return 1; }).then((code) => {
  procs.forEach((p) => p.kill());
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* perfil ainda em uso */ }
  process.exit(code);
});
