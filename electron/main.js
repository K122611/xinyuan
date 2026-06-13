import { app, BrowserWindow, screen, shell, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  connectServo,
  disconnectServo,
  sendAngle,
  sendAngleImmediate,
  getStatus,
  startBreathing,
  stopBreathing,
  listPorts,
} from './servo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ========== Servo IPC 处理器 ==========
function setupServoIPC() {
  ipcMain.handle('servo:connect', async () => {
    return await connectServo();
  });

  ipcMain.handle('servo:disconnect', async () => {
    return await disconnectServo();
  });

  ipcMain.handle('servo:status', () => {
    return getStatus();
  });

  ipcMain.handle('servo:setAngle', (_event, angle) => {
    return sendAngle(angle);
  });

  ipcMain.handle('servo:setAngleImmediate', (_event, angle) => {
    return sendAngleImmediate(angle);
  });

  ipcMain.handle('servo:startBreathing', (_event, cfg) => {
    return startBreathing(cfg);
  });

  ipcMain.handle('servo:stopBreathing', () => {
    return stopBreathing();
  });

  ipcMain.handle('servo:listPorts', async () => {
    return await listPorts();
  });
}

// ========== Supabase IPC ==========
function setupSupabaseIPC() {
  ipcMain.handle('get-supabase-config', () => {
    return {
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    };
  });
}

// ========== 窗口创建 ==========
function createWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: Math.min(1200, screenWidth),
    height: Math.min(800, screenHeight),
    minWidth: 800,
    minHeight: 600,
    title: '心元 EMO-Mate',
    icon: path.join(__dirname, '../public/favicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    frame: true,
    backgroundColor: '#0f0f1a',
    show: false,
  });

  win.once('ready-to-show', () => {
    win.show();
    if (isDev) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

// ========== 启动 ==========
app.whenReady().then(() => {
  setupSupabaseIPC();
  setupServoIPC();
  createWindow();

  // 自动尝试连接舵机
  connectServo().then((result) => {
    console.log('[Main] 舵机自动连接:', result.message);
  });
});

app.on('window-all-closed', async () => {
  await disconnectServo();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
