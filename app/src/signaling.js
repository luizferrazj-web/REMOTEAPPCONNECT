// Transportes de sinalização: Firebase Realtime Database (padrão, sem servidor próprio)
// ou WebSocket (server/). Ambos expõem { start(), send(to, data) }.
(function () {
  const cfg = window.IDEIA_CONFIG || {};
  const fb = cfg.firebase || {};

  function randomId() { return String(Math.floor(100000000 + Math.random() * 900000000)); }

  function firebaseTransport(h) {
    const db = fb.databaseURL.replace(/\/$/, '');
    let token, uid, myId, source, seen = new Set();

    async function auth() {
      const saved = localStorage.getItem('fbRefresh');
      if (saved) {
        const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${fb.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(saved)}`,
        });
        if (r.ok) {
          const j = await r.json();
          token = j.id_token; uid = j.user_id;
          localStorage.setItem('fbRefresh', j.refresh_token);
          return;
        }
      }
      const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${fb.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnSecureToken: true }),
      });
      if (!r.ok) throw new Error('Falha na autenticação anônima do Firebase');
      const j = await r.json();
      token = j.idToken; uid = j.localId;
      localStorage.setItem('fbRefresh', j.refreshToken);
    }

    const url = (path) => `${db}/${path}.json?auth=${token}`;

    async function claimId() {
      let id = localStorage.getItem('id');
      for (let i = 0; i < 5; i++) {
        if (!/^\d{9}$/.test(id || '')) id = randomId();
        const cur = await (await fetch(url(`users/${id}`))).json();
        if (!cur || cur.uid === uid) {
          const r = await fetch(url(`users/${id}`), { method: 'PUT', body: JSON.stringify({ uid, ts: Date.now() }) });
          if (r.ok) return id;
        }
        id = null;
      }
      throw new Error('Não foi possível reservar um ID');
    }

    function listen() {
      if (source) source.close();
      source = new EventSource(url(`signals/${myId}`));
      const handle = (key, v) => {
        if (!v || seen.has(key)) return;
        seen.add(key);
        fetch(url(`signals/${myId}/${key}`), { method: 'DELETE' });
        if (Date.now() - v.ts < 60000) h.onSignal(v.from, v.data);
      };
      const onPut = (e) => {
        const { path, data } = JSON.parse(e.data);
        if (path === '/') Object.entries(data || {}).forEach(([k, v]) => handle(k, v));
        else handle(path.slice(1), data);
      };
      source.addEventListener('put', onPut);
      source.addEventListener('auth_revoked', () => start());
      source.onerror = () => { if (source.readyState === EventSource.CLOSED) setTimeout(start, 3000); };
    }

    async function start() {
      try {
        h.onStatus('Conectando ao Firebase…');
        await auth();
        if (!myId) myId = await claimId();
        h.onRegistered(myId, cfg.iceServers);
        listen();
        clearTimeout(start.timer);
        start.timer = setTimeout(start, 45 * 60 * 1000); // renova o token
      } catch (err) {
        h.onStatus('Firebase offline — tentando de novo…');
        setTimeout(start, 5000);
      }
    }

    async function send(to, data) {
      const exists = await (await fetch(url(`users/${to}/uid`))).json();
      if (!exists) return h.onError('not-found');
      fetch(url(`signals/${to}`), { method: 'POST', body: JSON.stringify({ from: myId, data, ts: Date.now() }) });
    }

    return { start, send };
  }

  // Servidor público do PeerJS: funciona na internet sem conta nem configuração.
  function publicTransport(h) {
    const host = cfg.publicSignaling || 'wss://0.peerjs.com/peerjs?key=peerjs';
    let ws, myId, hb, tries = 0;
    // Token fixo: permite retomar o mesmo ID depois de uma queda de rede.
    const token = localStorage.getItem('peerToken') || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    localStorage.setItem('peerToken', token);
    function start() {
      clearInterval(hb);
      myId = tries++ === 0 && /^\d{9}$/.test(localStorage.getItem('id') || '') ? localStorage.getItem('id') : randomId();
      const sock = new WebSocket(`${host}&id=${myId}&token=${token}`);
      ws = sock;
      sock.onclose = () => {
        if (sock.taken || ws !== sock) return;
        clearInterval(hb);
        h.onStatus('Servidor offline — tentando de novo…');
        setTimeout(start, 3000);
      };
      sock.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'OPEN') {
          h.onRegistered(myId, cfg.iceServers);
          hb = setInterval(() => sock.readyState === 1 && sock.send(JSON.stringify({ type: 'HEARTBEAT' })), 5000);
        } else if (m.type === 'ID-TAKEN') { sock.taken = true; start(); }
        else if (m.type === 'EXPIRE') h.onError('not-found');
        else if (m.type === 'OFFER') h.onSignal(m.src, m.payload);
      };
    }
    return { start, send: (to, data) => ws.send(JSON.stringify({ type: 'OFFER', dst: to, payload: data })) };
  }

  function wsTransport(h) {
    const server = localStorage.getItem('server') || cfg.wsServer || 'ws://localhost:8080';
    let ws;
    function start() {
      ws = new WebSocket(server);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'register', id: localStorage.getItem('id') }));
      ws.onclose = () => { h.onStatus('Servidor offline — tentando de novo…'); setTimeout(start, 3000); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'registered') h.onRegistered(m.id, m.iceServers || cfg.iceServers);
        else if (m.type === 'error') h.onError(m.code);
        else if (m.type === 'signal') h.onSignal(m.from, m.data);
      };
    }
    return { start, send: (to, data) => ws.send(JSON.stringify({ type: 'signal', to, data })) };
  }

  window.createTransport = (h) => {
    if (fb.apiKey && fb.databaseURL) return firebaseTransport(h);
    if (cfg.wsServer || localStorage.getItem('server')) return wsTransport(h);
    return publicTransport(h);
  };
})();
