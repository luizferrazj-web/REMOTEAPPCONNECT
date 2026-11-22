const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  input: (ev) => ipcRenderer.invoke('input', ev),
  displays: () => ipcRenderer.invoke('displays'),
  selectDisplay: (id) => ipcRenderer.invoke('select-display', id),
  status: () => ipcRenderer.invoke('status'),
  showFile: (p) => ipcRenderer.invoke('show-file', p),
  openPrivacy: () => ipcRenderer.invoke('open-privacy'),
  onDownload: (cb) => ipcRenderer.on('download-done', (_e, d) => cb(d)),
});
