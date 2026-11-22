const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  input: (ev) => ipcRenderer.invoke('input', ev),
});
