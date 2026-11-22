# IDEIA Remote

Acesso remoto simples e gratuito (estilo AnyDesk) para Windows, macOS e Linux, com tela remota, controle e transferência de arquivos.

## Como funciona
- `server/`: servidor de sinalização (WebSocket). Só faz o handshake; vídeo, controle e arquivos trafegam direto entre as máquinas (WebRTC P2P).
- `app/`: aplicativo Electron. Cada máquina mostra um **ID** e uma **senha**; para acessar outra, digite o ID e a senha dela.
- **Arquivos**: arraste para o painel lateral durante a sessão (funciona nos dois sentidos).

## Executar
```bash
# 1) Servidor (em uma máquina acessível por todas)
cd server && npm install && npm start

# 2) App (em cada máquina)
cd app && npm install && npm start
```
Por padrão o app usa `ws://localhost:8080`. Dê **duplo clique** no texto de status para informar o endereço do seu servidor (use `wss://` na internet).

## Instaladores
`cd app && npm run dist` (gera para o SO atual), ou rode o workflow **Build** no GitHub Actions para os três sistemas.

## Permissões
- **macOS**: autorizar *Gravação de Tela* e *Acessibilidade* em Ajustes do Sistema > Privacidade.
- **Linux**: captura/controle funcionam melhor em X11 (Wayland é limitado).

## Limitações do MVP
Apenas o monitor principal; teclado sem combinações com Ctrl/Alt; sem TURN (algumas redes exigem); sem criptografia além do DTLS do WebRTC e sem acesso não supervisionado com senha fixa.
