const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen } = require('electron');
const path = require('path');

let nut = null;
try { nut = require('@nut-tree-fork/nut-js'); nut.mouse.config.mouseSpeed = 100000; } catch { /* controle indisponível */ }

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    title: 'IDEIA Remote',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  // Compartilha a tela principal sem diálogo de seleção.
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    callback({ video: sources[0] });
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());

const KEYS = {
  Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape', ' ': 'Space',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
};

ipcMain.handle('input', async (_e, ev) => {
  if (!nut) return;
  const { Button, Point, keyboard, mouse, Key } = nut;
  const d = screen.getPrimaryDisplay();
  const sf = d.scaleFactor;
  try {
    if (ev.t === 'move' || ev.t === 'down' || ev.t === 'up') {
      await mouse.setPosition(new Point(Math.round(ev.x * d.size.width * sf), Math.round(ev.y * d.size.height * sf)));
      const btn = ev.b === 2 ? Button.RIGHT : ev.b === 1 ? Button.MIDDLE : Button.LEFT;
      if (ev.t === 'down') await mouse.pressButton(btn);
      if (ev.t === 'up') await mouse.releaseButton(btn);
    } else if (ev.t === 'scroll') {
      if (ev.dy > 0) await mouse.scrollDown(Math.ceil(Math.abs(ev.dy) / 40));
      else if (ev.dy < 0) await mouse.scrollUp(Math.ceil(Math.abs(ev.dy) / 40));
    } else if (ev.t === 'key') {
      if (KEYS[ev.k]) await keyboard.type(Key[KEYS[ev.k]]);
      else if (ev.k.length === 1) await keyboard.type(ev.k);
    }
  } catch (err) { console.error('input error', err.message); }
});
