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
} from './servo.js';
import { XiaozhiBridge } from './xiaozhi-bridge.js';
import { AIConversation } from './ai-conversation.js';
import { sapiToPcm16 } from './sapi-tts.mjs';

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

// ========== XiaoZhi Bridge 实例 ==========
let xiaozhiBridge = null;

// 初始化桥接器（创建 + 绑定事件）
function initXiaozhiBridge() {
  if (xiaozhiBridge) return xiaozhiBridge;
  
  xiaozhiBridge = new XiaozhiBridge({
    log: (...args) => console.log('[XiaoZhi Bridge]', ...args),
    enableWss: true, wssPort: 443,
    enableMqtt: true, mqttPorts: [1883],
    onMessage: ({ deviceId, text }) => {
      console.log('[XiaoZhi] 💬', deviceId, ':', text);
    },
    onAudio: ({ deviceId, audioPath }) => {
      console.log('[XiaoZhi] 🎤', deviceId, '->', audioPath);
    },
    onTtsRequest: ({ deviceId, text }) => {
      console.log('[XiaoZhi] 🔊 TTS:', deviceId, '->', text);
    },
    onPhoto: ({ deviceId }) => {
      console.log('[XiaoZhi] 📸 Photo:', deviceId);
    },
  });

  xiaozhiBridge.on('deviceConnected', ({ deviceId, info }) => {
    console.log('[XiaoZhi] ✅ 设备上线:', deviceId, info);
  });

  xiaozhiBridge.on('deviceDisconnected', ({ deviceId }) => {
    console.log('[XiaoZhi] ❌ 设备离线:', deviceId);
  });

  xiaozhiBridge.on('chat', ({ deviceId, text }) => {
    console.log('[XiaoZhi] 💬', deviceId, ':', text);
  });

  xiaozhiBridge.on('servo', ({ deviceId, angle, speed }) => {
    console.log('[XiaoZhi] 🔩 Servo:', deviceId, angle + '°');
    sendAngleImmediate(angle);
  });

  xiaozhiBridge.on('expression', ({ deviceId, expression }) => {
    console.log('[XiaoZhi] 😀 Expression:', deviceId, expression);
  });

  return xiaozhiBridge;
}

// ========== XiaoZhi Bridge IPC ==========
function setupXiaozhiIPC() {
  ipcMain.handle('xiaozhi:status', () => {
    if (!xiaozhiBridge) return { running: false, port: 8888, devices: [] };
    return {
      running: xiaozhiBridge.running,
      port: xiaozhiBridge.port,
      devices: xiaozhiBridge.getDevices(),
    };
  });

  ipcMain.handle('xiaozhi:start', async () => {
    const bridge = initXiaozhiBridge();
    if (bridge.running) {
      return { success: true, message: '已在运行', port: bridge.port };
    }
    const result = await bridge.start();
    // 桥接器启动后初始化 AI 会话引擎
    initAIConversation();
    return result;
  });

  ipcMain.handle('xiaozhi:stop', async () => {
    if (!xiaozhiBridge) return { success: true, message: '未初始化' };
    return await xiaozhiBridge.stop();
  });

  ipcMain.handle('xiaozhi:sendTts', (_event, { deviceId, text, voice }) => {
    if (!xiaozhiBridge) return { success: false, message: '桥接器未启动' };
    return xiaozhiBridge.sendTts(deviceId, text, voice);
  });

  ipcMain.handle('xiaozhi:sendExpression', (_event, { deviceId, expression, duration }) => {
    if (!xiaozhiBridge) return { success: false, message: '桥接器未启动' };
    return xiaozhiBridge.sendExpression(deviceId, expression, duration);
  });

  ipcMain.handle('xiaozhi:sendServo', (_event, { deviceId, angle, speed }) => {
    if (!xiaozhiBridge) return { success: false, message: '桥接器未启动' };
    return xiaozhiBridge.sendServo(deviceId, angle, speed);
  });

  ipcMain.handle('xiaozhi:sendChat', (_event, { deviceId, text, emotion }) => {
    if (!xiaozhiBridge) return { success: false, message: '桥接器未启动' };
    return xiaozhiBridge.sendChat(deviceId, text, emotion);
  });

  ipcMain.handle('xiaozhi:requestPhoto', (_event, { deviceId }) => {
    if (!xiaozhiBridge) return { success: false, message: '桥接器未启动' };
    return xiaozhiBridge.requestPhoto(deviceId);
  });
}

// ========== AI Conversation 实例 ==========
let aiConversation = null;

function initAIConversation() {
  if (!xiaozhiBridge || !xiaozhiBridge.running) return null;
  if (aiConversation) return aiConversation;

  console.log('[Main] 初始化 AI 会话引擎...');
  aiConversation = new AIConversation(xiaozhiBridge, sapiToPcm16);

  aiConversation.on('status', ({ sessionId, phase, text, details, error }) => {
    const msg = [`[AI/${phase}]`, sessionId?.slice(0, 8)];
    if (text) msg.push(text);
    if (details) msg.push(details);
    if (error) msg.push('❌', error);
    console.log(msg.join(' '));
  });

  console.log('[Main] ✅ AI 会话引擎就绪');
  return aiConversation;
}

// ========== AI Conversation IPC ==========
function setupAIConversationIPC() {
  // 获取已连接设备列表
  ipcMain.handle('ai:get-sessions', () => {
    if (!aiConversation) return [];
    return aiConversation.getSessions();
  });

  // 让设备朗读文字
  ipcMain.handle('ai:speak-text', async (_event, { sessionId, text }) => {
    if (!aiConversation) {
      return { success: false, error: 'AI 会话引擎未初始化，请先启动桥接器' };
    }
    console.log(`[IPC] ai:speak-text session=${sessionId?.slice(0, 8)} text="${text?.slice(0, 40)}..."`);
    const result = await aiConversation.speakText(sessionId, text);
    console.log(`[IPC] ai:speak-text result:`, JSON.stringify(result));
    return result;
  });

  // 获取 AI 引擎状态
  ipcMain.handle('ai:status', () => {
    return {
      ready: !!aiConversation,
      bridgeRunning: xiaozhiBridge?.running || false,
      sessions: aiConversation ? aiConversation.getSessions() : [],
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
  setupXiaozhiIPC();
  setupAIConversationIPC();
  createWindow();

  // 自动尝试连接舵机
  connectServo().then((result) => {
    console.log('[Main] 舵机自动连接:', result.message);
  });

  // 自动启动 XiaoZhi 桥接器
  const bridge = initXiaozhiBridge();
  bridge.start().then((res) => {
    console.log('[Main] 小智桥接器:', res.message || `端口 ${res.port}`);
    // 桥接器启动后初始化 AI 会话引擎
    initAIConversation();
  });
});

app.on('window-all-closed', async () => {
  if (xiaozhiBridge) await xiaozhiBridge.stop();
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
