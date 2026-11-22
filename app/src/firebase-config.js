// Preencha com os dados do seu projeto Firebase (Configurações do projeto > Seus apps > Web).
// Essas chaves web não são secretas; a segurança vem das regras em firebase/database.rules.json.
// Se apiKey/databaseURL ficarem vazios, o app usa o servidor WebSocket (server/).
window.IDEIA_CONFIG = {
  firebase: {
    apiKey: '',
    databaseURL: '', // ex.: https://SEU-PROJETO-default-rtdb.firebaseio.com
  },
  // Opcional: servidores TURN para redes restritivas.
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};
