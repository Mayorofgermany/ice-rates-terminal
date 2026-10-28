const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  loadCache: (mode) => ipcRenderer.invoke('cache:load', mode),
  saveCache: (mode, d) => ipcRenderer.invoke('cache:save', mode, d),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  pinWindow: (on) => ipcRenderer.invoke('window:pin', on),
  copyText: (t) => ipcRenderer.invoke('clipboard:write', t),
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, p) => cb(p)),
  fetchHistory: (args) => ipcRenderer.invoke('history:fetch', args),
  fetchBankPage: (url) => ipcRenderer.invoke('bank:fetchPage', url),
  loadBanks: () => ipcRenderer.invoke('banks:load'),
  saveBanks: (d) => ipcRenderer.invoke('banks:save', d),
  fetchRates: (mode) => ipcRenderer.invoke('rates:fetch', mode)
});
