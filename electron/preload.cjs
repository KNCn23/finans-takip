// Arayüze yalnızca bu dar API açılır; Node.js'e doğrudan erişim yoktur.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('finans', {
  isElectron: true,
  load: () => ipcRenderer.invoke('storage:load'),
  save: (text) => ipcRenderer.invoke('storage:save', text),
  saveSync: (text) => ipcRenderer.sendSync('storage:saveSync', text),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  readBackup: (name) => ipcRenderer.invoke('backup:read', name),
  createBackup: (label, text) => ipcRenderer.invoke('backup:create', label, text),
  openBackupFolder: () => ipcRenderer.invoke('backup:openFolder'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  chooseMirrorDir: () => ipcRenderer.invoke('config:chooseMirrorDir'),
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  openFile: (opts) => ipcRenderer.invoke('file:open', opts),
  showInFolder: (file) => ipcRenderer.invoke('file:showInFolder', file),
  printToPDF: (opts) => ipcRenderer.invoke('print:pdf', opts),
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
  fetchRates: () => ipcRenderer.invoke('rates:tcmb'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  onMenu: (cb) => {
    const listener = (_e, action) => cb(action)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  },
})
