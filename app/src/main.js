const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');

let nut = null;
try { nut = require('@nut-tree-fork/nut-js'); nut.mouse.config.mouseSpeed = 100000; } catch { /* controle indisponível */ }

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    title: 'IDEIA Remote',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

let selectedDisplayId = null;
const currentDisplay = () => screen.getAllDisplays().find((d) => d.id === selectedDisplayId) || screen.getPrimaryDisplay();

app.whenReady().then(() => {
  // Compartilha o monitor escolhido sem diálogo de seleção.
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    const id = String(currentDisplay().id);
    callback({ video: sources.find((s) => s.display_id === id) || sources[0] });
  });
  // Arquivos recebidos vão direto para a pasta Downloads, sem diálogo.
  session.defaultSession.on('will-download', (_e, item, wc) => {
    const dir = app.getPath('downloads');
    fs.mkdirSync(dir, { recursive: true });
    const { name, ext } = path.parse(path.basename(item.getFilename()) || 'arquivo');
    let target = path.join(dir, name + ext);
    for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${name} (${i})${ext}`);
    item.setSavePath(target);
    item.once('done', (_e2, state) => {
      if (!wc.isDestroyed()) wc.send('download-done', { name: path.basename(target), path: target, ok: state === 'completed' });
    });
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());

const KEYS = {
  Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape', ' ': 'Space',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
};

function resolveKey(k) {
  const { Key } = nut;
  if (KEYS[k]) return Key[KEYS[k]];
  if (/^[a-z]$/i.test(k)) return Key[k.toUpperCase()];
  if (/^\d$/.test(k)) return Key['Num' + k];
  if (/^F\d{1,2}$/.test(k)) return Key[k];
  return null;
}

ipcMain.handle('displays', () => {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({ id: d.id, name: `Monitor ${i + 1}${d.id === primary ? ' (principal)' : ''}` }));
});

ipcMain.handle('select-display', (_e, id) => { selectedDisplayId = id; });

ipcMain.handle('input', async (_e, ev) => {
  if (!nut) return;
  const { Button, Point, keyboard, mouse, Key } = nut;
  const d = currentDisplay();
  const sf = d.scaleFactor;
  try {
    if (ev.t === 'move' || ev.t === 'down' || ev.t === 'up') {
      const x = d.bounds.x + ev.x * d.bounds.width;
      const y = d.bounds.y + ev.y * d.bounds.height;
      await mouse.setPosition(new Point(Math.round(x * sf), Math.round(y * sf)));
      const btn = ev.b === 2 ? Button.RIGHT : ev.b === 1 ? Button.MIDDLE : Button.LEFT;
      if (ev.t === 'down') await mouse.pressButton(btn);
      if (ev.t === 'up') await mouse.releaseButton(btn);
    } else if (ev.t === 'scroll') {
      if (ev.dy > 0) await mouse.scrollDown(Math.ceil(Math.abs(ev.dy) / 40));
      else if (ev.dy < 0) await mouse.scrollUp(Math.ceil(Math.abs(ev.dy) / 40));
    } else if (ev.t === 'key') {
      const key = resolveKey(ev.k);
      const mods = [];
      if (ev.ctrl) mods.push(Key.LeftControl);
      if (ev.alt) mods.push(Key.LeftAlt);
      if (ev.meta) mods.push(Key.LeftSuper);
      if (ev.shift && (mods.length || (key && ev.k.length > 1))) mods.push(Key.LeftShift);
      if (mods.length && key) {
        await keyboard.pressKey(...mods, key);
        await keyboard.releaseKey(...mods, key);
      } else if (key) await keyboard.type(key);
      else if (ev.k.length === 1) await keyboard.type(ev.k);
    }
  } catch (err) { console.error('input error', err.message); }
});

ipcMain.handle('status', () => {
  const mac = process.platform === 'darwin';
  return {
    platform: process.platform,
    control: !!nut,
    screen: !mac || systemPreferences.getMediaAccessStatus('screen') === 'granted',
    accessibility: !mac || systemPreferences.isTrustedAccessibilityClient(false),
  };
});

ipcMain.handle('show-file', (_e, p) => {
  const rel = path.relative(app.getPath('downloads'), path.resolve(String(p)));
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) shell.showItemInFolder(path.resolve(String(p)));
});
ipcMain.handle('open-privacy', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'));
