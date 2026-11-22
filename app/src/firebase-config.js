// Preencha com os dados do seu projeto Firebase (Configurações do projeto > Seus apps > Web).
// Essas chaves web não são secretas; a segurança vem das regras em firebase/database.rules.json.
// Se apiKey/databaseURL ficarem vazios, o app usa o servidor WebSocket (server/).
window.IDEIA_CONFIG = {
  firebase: {
    apiKey: '',
    databaseURL: '', // ex.: https://SEU-PROJETO-default-rtdb.firebaseio.com
  },
  // STUN descobre o caminho direto; TURN retransmite quando a rede bloqueia a conexão direta.
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    {
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};
