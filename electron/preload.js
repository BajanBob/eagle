// Exposes a narrow, allow-listed network bridge to the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eagleNative', {
  fetch: (url, type) => ipcRenderer.invoke('eagle:fetch', String(url), type === 'text' || type === 'dataurl' ? type : 'json'),
  platform: process.platform,
});
