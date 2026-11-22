# IDEIA Remote

Acesso remoto simples e gratuito (estilo AnyDesk) para Windows, macOS e Linux: tela remota, controle de mouse e teclado e transferência de arquivos.

## Usar
1. Baixe o instalador em **Releases** e instale nos dois computadores.
2. No computador que será acessado, anote o **ID** e a **senha** mostrados no app.
3. No outro, digite esse ID e a senha em "Conectar".

Durante a sessão, arraste arquivos para o painel lateral (funciona nos dois sentidos); o que chega é salvo na pasta Downloads.

Para acessar um computador sem ninguém por perto, defina uma **senha fixa** (mín. 8 caracteres) no cartão "Seu computador" e deixe o app aberto.

## Como funciona
- As máquinas se encontram por um servidor de sinalização. Por padrão é o serviço público gratuito do [PeerJS](https://peerjs.com), usado pela biblioteca oficial `peerjs`; ele não tem garantia de disponibilidade.
- Depois disso a conexão é direta entre as duas máquinas (WebRTC, criptografada): tela, controle e arquivos não passam pelo servidor.
- A senha nunca é enviada: o app prova que a conhece com um hash amarrado às chaves daquela conexão. Cinco senhas erradas em 10 minutos bloqueiam novas tentativas.

## Limitações
- **Sem retransmissor (TURN)**: se a rede de um dos lados bloquear conexões diretas (algumas redes 4G/5G, corporativas ou com CGNAT), a conexão não fecha. A solução é configurar um TURN em `app/src/config.js`.
- **macOS**: é preciso autorizar *Gravação de Tela* e *Acessibilidade* (o app avisa). O instalador é só para Apple Silicon e não é assinado pela Apple: na primeira vez, abra com botão direito > Abrir.
- **Windows**: o instalador não é assinado; o SmartScreen pede "Mais informações > Executar assim mesmo".
- **Linux**: captura e controle funcionam em X11; em Wayland são limitados.
- Teclas de mídia e alguns atalhos do sistema não são repassados.

## Desenvolvimento
```bash
cd app
npm install
npm start          # abre o app
npm test           # teste ponta a ponta com dois apps e um servidor local
npm run dist       # gera o instalador do sistema atual
```
`SIGNALING=public npm test` roda o mesmo teste pelo serviço público. O workflow **Build** gera os instaladores dos três sistemas, testa o app empacotado e, em tags `v*`, anexa tudo à Release.

## Servidor próprio (opcional)
`deploy/docker-compose.yml` sobe um PeerServer (porta 9000) e um coturn. Depois aponte `server` e `iceServers` em `app/src/config.js` para ele. Esta configuração ainda não foi testada.
