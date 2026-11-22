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

## Acesso sem supervisão
No cartão "Seu computador", defina uma **senha fixa** (mín. 8 caracteres) e deixe o app aberto: você conecta sempre com o mesmo ID e essa senha. Ela fica salva localmente no app.

## Hospedar servidor + TURN (Docker)
```bash
cd deploy && cp .env.example .env   # edite PUBLIC_HOST, TURN_USER, TURN_PASS
docker compose up -d
```
Sobe a sinalização (porta 8080) e um coturn (3478 e UDP 49160-49200). Os apps recebem a config TURN automaticamente do servidor. Para internet, coloque um proxy TLS (ex.: Caddy/nginx) na frente da 8080 e use `wss://`.

## Vários monitores e atalhos
Com mais de um monitor na máquina remota, aparece um seletor na barra da sessão. Atalhos com Ctrl/Alt/Meta/Shift são repassados (ex.: Ctrl+C).

## Limitações
Teclas de mídia e algumas combinações do sistema não são repassadas; no Linux Wayland captura/controle são limitados; monitores com escalas DPI diferentes podem ter o mouse levemente impreciso.
