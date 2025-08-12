const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectRoot: () => ipcRenderer.invoke('select-root'),
  scan: (root) => ipcRenderer.invoke('scan', root),
  startWatch: (root) => ipcRenderer.invoke('start-watch', root),
  stopWatch: () => ipcRenderer.invoke('stop-watch'),
  hashCompare: (copyPath, originalPath) => ipcRenderer.invoke('hash-compare', copyPath, originalPath),
  deleteSelected: (paths, strictHash) => ipcRenderer.invoke('delete-selected', paths, strictHash),
  deleteFolderCopies: (folderPath, strictHash) => ipcRenderer.invoke('delete-folder-copies', folderPath, strictHash),
  onFsUpdated: (cb) => ipcRenderer.on('fs-updated', (_evt, data) => cb(data))
});