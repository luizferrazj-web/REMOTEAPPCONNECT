const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  input: (ev) => ipcRenderer.invoke('input', ev),
  displays: () => ipcRenderer.invoke('displays'),
  selectDisplay: (id) => ipcRenderer.invoke('select-display', id),
});
