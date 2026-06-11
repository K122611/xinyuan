const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// ============ 窗口 & 托盘 ============
let mainWindow = null;
let petWindow = null;
let tray = null;
let isQuitting = false;

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

const petBoundsPath = path.join(app.getPath('userData'), 'pet-bounds.json');

// ============ 主窗口 ============
function createMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../public/icon.png'),
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============ 宠物悬浮窗 ============
function createPetWindow() {
  if (petWindow) return;

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const saved = loadPetBounds();

  petWindow = new BrowserWindow({
    width: 280,
    height: 380,
    x: saved?.x ?? width - 300,
    y: saved?.y ?? height - 420,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    petWindow.loadURL('http://localhost:5173/#/floating-pet').catch(() => {
      petWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'), {
        hash: '/floating-pet',
      });
    });
  } else {
    petWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'), {
      hash: '/floating-pet',
    });
  }

  // 窗口始终接收鼠标事件，确保拖动可靠

  petWindow.on('closed', () => {
    petWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pet-window-closed');
    }
  });

  petWindow.on('moved', () => {
    savePetBounds(petWindow.getBounds());
  });
}

// ============ 系统托盘 ============
function createTray() {
  try {
    const iconPath = path.join(__dirname, '../public/icon.png');
    const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    tray = new Tray(icon.isEmpty() ? nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==') : icon);
  } catch {
    tray = new Tray(nativeImage.createEmpty());
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: '💬 打开聊天', click: () => createMainWindow() },
    { label: '🐾 显示桌宠', click: () => { createPetWindow(); petWindow.show(); } },
    { label: '🙈 隐藏桌宠', click: () => { if (petWindow) petWindow.hide(); } },
    { type: 'separator' },
    { label: '❌ 退出心元', click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setToolTip('心元 EMO-Mate');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => createMainWindow());
}

// ============ 宠物位置持久化 ============
function loadPetBounds() {
  try {
    if (fs.existsSync(petBoundsPath)) {
      return JSON.parse(fs.readFileSync(petBoundsPath, 'utf-8'));
    }
  } catch {}
  return null;
}

function savePetBounds(bounds) {
  try {
    fs.writeFileSync(petBoundsPath, JSON.stringify(bounds));
  } catch {}
}

// ============ IPC ============
function setupIPC() {
  ipcMain.handle('main:show', () => createMainWindow());
  ipcMain.handle('main:hide', () => { if (mainWindow) mainWindow.hide(); return true; });
  ipcMain.handle('main:is-visible', () => !!mainWindow && mainWindow.isVisible());

  ipcMain.handle('pet:show', () => {
    if (!petWindow) createPetWindow();
    petWindow.show();
    return true;
  });

  ipcMain.handle('pet:hide', () => {
    if (petWindow) petWindow.hide();
    return true;
  });

  ipcMain.handle('pet:close', () => {
    if (petWindow) { petWindow.close(); petWindow = null; }
    return true;
  });

  ipcMain.handle('pet:toggle', () => {
    if (!petWindow) { createPetWindow(); return true; }
    petWindow.isVisible() ? petWindow.hide() : petWindow.show();
    return true;
  });

  ipcMain.handle('pet:is-visible', () => !!petWindow && petWindow.isVisible());
  ipcMain.handle('pet:get-bounds', () => petWindow ? petWindow.getBounds() : loadPetBounds());
  ipcMain.handle('pet:set-bounds', (_e, bounds) => {
    if (petWindow && bounds) petWindow.setBounds(bounds);
  });

  // --- 手动拖拽窗口 ---
  ipcMain.on('pet:move-window', (_e, { dx, dy }) => {
    if (petWindow && !petWindow.isDestroyed()) {
      const [x, y] = petWindow.getPosition();
      petWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
    }
  });

  ipcMain.handle('pet:send-message', (_e, message) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:message', message);
    }
  });

  ipcMain.handle('pet:sync-state', (_e, petState) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:state-update', petState);
    }
  });

  ipcMain.on('pet:dblclick', () => {
    createMainWindow();
  });

  ipcMain.handle('app:quit', () => {
    isQuitting = true;
    app.quit();
    return true;
  });
}

// ============ 应用生命周期 ============
app.whenReady().then(() => {
  setupIPC();
  createMainWindow();
  createPetWindow();
  createTray();
});

app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  isQuitting = true;
  if (petWindow) petWindow.destroy();
  if (tray) tray.destroy();
});
