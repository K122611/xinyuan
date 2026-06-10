const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// ============ 窗口管理 ============
let mainWindow = null;
let petWindow = null;
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

// 主窗口配置
const MAIN_WINDOW_OPTIONS = {
  width: 1200,
  height: 800,
  minWidth: 800,
  minHeight: 600,
  frame: false,
  titleBarStyle: 'hidden',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
  },
  icon: path.join(__dirname, '../public/icon.png'),
};

// 宠物悬浮窗配置
const PET_WINDOW_OPTIONS = {
  width: 320,
  height: 420,
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  resizable: false,
  skipTaskbar: true,
  hasShadow: false,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
  },
};

// ============ 创建主窗口 ============
function createMainWindow() {
  mainWindow = new BrowserWindow(MAIN_WINDOW_OPTIONS);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
  }

  const { session } = require('electron');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============ 创建宠物悬浮窗 ============
function createPetWindow() {
  if (petWindow) return;

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  petWindow = new BrowserWindow({
    ...PET_WINDOW_OPTIONS,
    // 默认放在右下角
    x: width - 340,
    y: height - 450,
  });

  if (isDev) {
    petWindow.loadURL('http://localhost:5173/#/floating-pet');
  } else {
    petWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: '/floating-pet',
    });
  }

  // 允许点击穿透（宠物身体部分透明）
  petWindow.setIgnoreMouseEvents(false);

  petWindow.on('closed', () => {
    petWindow = null;
    if (mainWindow) {
      mainWindow.webContents.send('pet-window-closed');
    }
  });
}

// ============ IPC 处理 ============
function setupIPC() {
  // 主窗口 ↔ 宠物窗口 双向通信

  // 显示宠物窗
  ipcMain.handle('pet:show', () => {
    if (!petWindow) createPetWindow();
    petWindow.show();
    return true;
  });

  // 隐藏宠物窗
  ipcMain.handle('pet:hide', () => {
    if (petWindow) petWindow.hide();
    return true;
  });

  // 关闭宠物窗
  ipcMain.handle('pet:close', () => {
    if (petWindow) {
      petWindow.close();
      petWindow = null;
    }
    return true;
  });

  // 切换宠物窗
  ipcMain.handle('pet:toggle', () => {
    if (petWindow && petWindow.isVisible()) {
      petWindow.hide();
      return false;
    } else {
      if (!petWindow) createPetWindow();
      petWindow.show();
      return true;
    }
  });

  // 主窗口 → 宠物窗 消息转发
  ipcMain.handle('pet:send-message', (_event, message) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:message', message);
    }
    return true;
  });

  // 宠物窗口可被拖拽（点击拖拽移动）
  ipcMain.on('pet:drag-start', () => {
    if (petWindow) {
      petWindow.setMovable(true);
    }
  });

  // 双击宠物 → 显示主窗口
  ipcMain.on('pet:dblclick', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      // 切换到聊天页
      mainWindow.webContents.send('navigate-to', 'chat');
    }
  });

  // 宠物资讯同步（任何窗口更新了宠物状态）
  ipcMain.handle('pet:sync-state', (_event, petState) => {
    // 广播到另一个窗口
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:state-update', petState);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pet:state-update', petState);
    }
    return true;
  });

  // 获取宠物窗口状态
  ipcMain.handle('pet:is-visible', () => {
    return !!(petWindow && petWindow.isVisible());
  });
}

// ============ 应用生命周期 ============
app.whenReady().then(() => {
  setupIPC();
  createMainWindow();

  // macOS
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (petWindow) petWindow.close();
});
