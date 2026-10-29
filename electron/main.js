// Eagle desktop shell (Linux, Windows, macOS, Raspberry Pi)
const { app, BrowserWindow, ipcMain, net, shell, session, Menu } = require('electron');
const path = require('path');

// Hosts the app may reach. Requests go through the main process, so sources
// without browser CORS headers (NDBC buoys, some NOAA endpoints) still work.
const ALLOWED_HOSTS = new Set([
  'api.open-meteo.com', 'marine-api.open-meteo.com', 'air-quality-api.open-meteo.com',
  'api.weather.gov', 'aviationweather.gov', 'www.ndbc.noaa.gov',
  'api.weather.com', 'cwcgom.aoml.noaa.gov', 'gibs.earthdata.nasa.gov',
]);

const args = process.argv.slice(1);
const KIOSK = args.includes('--kiosk');
// Raspberry Pi and some older GPUs render more reliably without GPU compositing.
if (args.includes('--no-gpu') || process.env.EAGLE_NO_GPU === '1') app.disableHardwareAcceleration();

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 360, minHeight: 480,
    backgroundColor: '#0a1018', title: 'Eagle', autoHideMenuBar: true,
    kiosk: KIOSK, fullscreen: KIOSK,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
}

ipcMain.handle('eagle:fetch', async (_evt, url, type = 'json') => {
  let u;
  try { u = new URL(url); } catch { return { ok: false, error: 'Bad URL' }; }
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) return { ok: false, error: 'Host not allowed: ' + u.hostname };
  try {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': 'Eagle/1.0 (desktop weather and marine viewer)', Accept: type === 'json' ? 'application/geo+json, application/json' : '*/*' },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 204) return { ok: true, status: 204, data: type === 'json' ? [] : '' };
    if (!res.ok) return { ok: false, status: res.status };
    if (type === 'json') return { ok: true, data: await res.json() };
    if (type === 'dataurl') {
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = (res.headers.get('content-type') || 'image/png').split(';')[0];
      return { ok: true, data: `data:${ct};base64,${buf.toString('base64')}` };
    }
    return { ok: true, data: await res.text() };
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'Timed out' : e.message };
  }
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'geolocation'));
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
