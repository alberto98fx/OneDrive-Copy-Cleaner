const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const chokidar = require('chokidar');

let mainWindow = null;
let watcher = null;
let currentRoot = null;

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tif', '.tiff',
  '.heic', '.heif', '.arw', '.cr2', '.nef', '.orf', '.rw2', '.dng'
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadFile('renderer.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- Helpers ----------
function isImage(filePath) {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

function walkDir(dir, fileCallback) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules/dist when scanning app dir accidentally
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      try { walkDir(full, fileCallback); } catch (_) {}
    } else {
      fileCallback(full);
    }
  }
}

// Copy name detectors; returns base name of original if detected
function detectOriginalBase(basename) {
  // remove extension elsewhere; this works on the base name without ext
  // 1) "Name - Copy" / "Name - Copy (2)"
  let m = basename.match(/^(.*)\s-\s[Cc]opy(?:\s\(\d+\))?$/);
  if (m) return m[1];

  // 2) "Name - Copia" / "Name - Copia (2)" (Italian)
  m = basename.match(/^(.*)\s-\s[Cc]opia(?:\s\(\d+\))?$/);
  if (m) return m[1];

  // 3) "Copy of Name"
  m = basename.match(/^[Cc]opy\s+of\s+(.+)$/);
  if (m) return m[1];

  // 4) "Copia di Name" (Italian)
  m = basename.match(/^[Cc]opia\s+di\s+(.+)$/);
  if (m) return m[1];

  // 5) "Name (2)" or higher; treat as copy only if original exists
  m = basename.match(/^(.*)\s\((\d+)\)$/);
  if (m) {
    const n = parseInt(m[2], 10);
    if (!isNaN(n) && n >= 2) return m[1];
  }

  return null;
}

function fileExists(p) {
  try { fs.accessSync(p, fs.constants.F_OK); return true; } catch (_) { return false; }
}

function fileStat(p) {
  try { return fs.statSync(p); } catch (_) { return null; }
}

function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function toDisplayItem(copyPath) {
  const dir = path.dirname(copyPath);
  const ext = path.extname(copyPath);
  const base = path.basename(copyPath, ext);
  const originalBase = detectOriginalBase(base);
  const statCopy = fileStat(copyPath);

  let originalPath = null;
  let originalExists = false;

  if (originalBase) {
    originalPath = path.join(dir, originalBase + ext);
    originalExists = fileExists(originalPath);
  }

  return {
    path: copyPath,
    dir,
    name: path.basename(copyPath),
    ext,
    originalBase,
    originalPath,
    originalExists,
    size: statCopy ? statCopy.size : 0,
    mtimeMs: statCopy ? statCopy.mtimeMs : 0,
    deletable: Boolean(originalBase && originalExists),
    hashStatus: 'idle' // idle | computing | match | mismatch | error
  };
}

function isLikelyCopyPath(p) {
  if (!isImage(p)) return false;
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  return detectOriginalBase(base) !== null;
}

function scanRoot(root) {
  const results = [];
  try {
    walkDir(root, (full) => {
      if (isLikelyCopyPath(full)) results.push(toDisplayItem(full));
    });
  } catch (e) {
    console.error('Scan error', e);
  }
  return results;
}

function sendUpdate(channel, payload) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function safeDelete(paths, strictHash) {
  const actuallyDelete = [];
  for (const p of paths) {
    const ext = path.extname(p);
    const base = path.basename(p, ext);
    const dir = path.dirname(p);
    const originalBase = detectOriginalBase(base);
    if (!originalBase) continue;
    const originalPath = path.join(dir, originalBase + ext);
    if (!fileExists(originalPath)) continue;

    if (strictHash) {
      try {
        const [h1, h2] = await Promise.all([sha1File(p), sha1File(originalPath)]);
        if (h1 !== h2) continue; // skip if not identical
      } catch (e) { continue; }
    }

    actuallyDelete.push(p);
  }

  if (actuallyDelete.length === 0) return { deleted: 0, paths: [] };
  // Use Electron’s native Recycle Bin API (works on Windows)
  const results = await Promise.allSettled(actuallyDelete.map(p => shell.trashItem(p)));
  const ok = [];
  results.forEach((r, i) => { if (r.status === 'fulfilled') ok.push(actuallyDelete[i]); });
  return { deleted: ok.length, paths: ok };
}

// ---------- IPC ----------
ipcMain.handle('select-root', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
});

ipcMain.handle('scan', async (_evt, root) => {
  currentRoot = root;
  return scanRoot(root);
});

ipcMain.handle('start-watch', async (_evt, root) => {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  currentRoot = root;
  watcher = chokidar.watch(root, { ignoreInitial: true, awaitWriteFinish: true, depth: 99 });
  const onFsChange = (eventPath) => {
    if (!isImage(eventPath)) return; // only care images
    // A conservative approach: re-scan whole root (simpler, robust enough)
    const data = scanRoot(currentRoot);
    sendUpdate('fs-updated', data);
  };
  watcher
    .on('add', onFsChange)
    .on('change', onFsChange)
    .on('unlink', onFsChange)
    .on('addDir', onFsChange)
    .on('unlinkDir', onFsChange);
  return true;
});

ipcMain.handle('stop-watch', async () => {
  if (watcher) { await watcher.close(); watcher = null; }
  return true;
});

ipcMain.handle('hash-compare', async (_evt, copyPath, originalPath) => {
  try {
    const [h1, h2] = await Promise.all([sha1File(copyPath), sha1File(originalPath)]);
    return { ok: true, match: h1 === h2, h1, h2 };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('delete-selected', async (_evt, paths, strictHash) => {
  const res = await safeDelete(paths, strictHash);
  // after deletion, emit refresh
  if (currentRoot) sendUpdate('fs-updated', scanRoot(currentRoot));
  return res;
});

ipcMain.handle('delete-folder-copies', async (_evt, folderPath, strictHash) => {
  // Find all copy candidates within folderPath
  const toDelete = [];
  walkDir(folderPath, (full) => {
    if (isLikelyCopyPath(full)) {
      // double-check local original exists
      const ext = path.extname(full);
      const base = path.basename(full, ext);
      const origBase = detectOriginalBase(base);
      if (!origBase) return;
      const originalPath = path.join(path.dirname(full), origBase + ext);
      if (!fileExists(originalPath)) return;
      toDelete.push(full);
    }
  });
  const res = await safeDelete(toDelete, strictHash);
  if (currentRoot) sendUpdate('fs-updated', scanRoot(currentRoot));
  return res;
});