window.IDEIA_CONFIG = {
  // Servidor de sinalização (PeerServer) só para as máquinas se encontrarem.
  // Vazio = serviço público gratuito do PeerJS. Para usar o seu: 'wss://meu-servidor.com/'.
  server: '',
  // STUN descobre o caminho direto entre as máquinas. Para redes que bloqueiam a
  // conexão direta, acrescente aqui um servidor TURN: { urls, username, credential }.
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }],
};
