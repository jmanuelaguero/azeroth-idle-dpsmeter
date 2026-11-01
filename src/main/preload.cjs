const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meterApi', {
  ready: () => ipcRenderer.invoke('meter:ready'),
  onLines: (cb) => ipcRenderer.on('log:lines', (_e, payload) => cb(payload)),
  onNativeLines: (cb) => ipcRenderer.on('native:lines', (_e, lines) => cb(lines)),
  onGameRunning: (cb) => ipcRenderer.on('game:running', (_e, running) => cb(running)),
  onStatus: (cb) => ipcRenderer.on('log:status', (_e, payload) => cb(payload)),
  onRestart: (cb) => ipcRenderer.on('log:restart', () => cb()),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  armReport: (armed) => ipcRenderer.invoke('report:arm', armed),
  onReportNext: (cb) => ipcRenderer.on('report:next', () => cb()),
  listCharacters: () => ipcRenderer.invoke('characters:list'),
  chooseLog: () => ipcRenderer.invoke('log:choose'),
  openLogFolder: () => ipcRenderer.invoke('log:open-folder'),
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),
  setOpacity: (value) => ipcRenderer.invoke('win:opacity', value),
  resize: (width, height) => ipcRenderer.send('win:resize', { width, height }),
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),
});
