import { app, BrowserWindow, screen, shell, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
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
import { XiaozhiBridge } from './xiaozhi-bridge.js';
import { AudioSerialBridge } from './audio-bridge.js';
import { speechToPcm16 } from './edge-tts.js';
import { sapiToPcm16 } from './sapi-tts.mjs';
import { AIConversation, opusSelfTest } from './ai-conversation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ========== Opus 自检（启动时运行） ==========
opusSelfTest();

// ========== 音频串口桥接实例 ==========
const audioBridge = new AudioSerialBridge({
  portName: 'COM5',
  onStatus: (msg) => {
    console.log('[音频桥接]', msg);
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('audio-bridge:status', msg);
    });
  },
  onAudioLevel: (level) => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('audio-bridge:level', level);
    });
  },
});

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ========== 小智 AI 桥接实例 ==========
const xiaozhiBridge = new XiaozhiBridge({
  port: 8888,
  onDeviceEvent: (event, clientInfo) => {
    console.log(`[小智桥接] 📡 设备事件: ${event}`, clientInfo.sessionId?.slice(0, 8));
    // 通知渲染进程
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('xiaozhi:device-event', { event, ...clientInfo });
    });
  },
  onAudioData: (sessionId, buf) => {
    // 音频数据回调 — 后续可流式传给 Coze
  },
  onMCPToolCall: async (sessionId, toolName, args) => {
    // MCP 工具调用回调 — 可用于自定义工具
    console.log(`[小智桥接] 🔧 MCP 调用: ${toolName}`, args);
  },
});

// ========== AI 对话引擎实例 ==========
// 使用 SAPI TTS（主进程直接合成，不依赖渲染进程）
const aiConversation = new AIConversation(xiaozhiBridge, sapiToPcm16);

// ========== OTA 服务器 (设备获取 WebSocket 地址) ==========
let otaServer = null;

// 状态事件转发到渲染进程
aiConversation.onStatus = (event) => {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('ai:event', event);
  });
};

// ========== AI 对话 IPC ==========
function setupAIConversationIPC() {
  // 从应用发送指定文字到设备播放
  ipcMain.handle('ai:speak-text', async (_event, sessionId, text) => {
    console.log('[AI-IPC] 📢 speak-text 收到:', sessionId?.slice(0,8), text?.slice(0,40));
    try {
      const sent = await aiConversation.speakText(sessionId, text);
      console.log('[AI-IPC] 📢 speak-text 完成:', sent, '帧');
      return { success: sent > 0, framesSent: sent };
    } catch (err) {
      console.error('[AI-IPC] ❌ speak-text 错误:', err.message);
      return { error: err.message };
    }
  });

  // 从应用发送消息给 AI，AI 回复在设备播放
  ipcMain.handle('ai:chat', async (_event, sessionId, message) => {
    console.log('[AI-IPC] 💬 chat 收到:', sessionId?.slice(0,8), message?.slice(0,40));
    try {
      const sent = await aiConversation.chatWithAI(sessionId, message);
      console.log('[AI-IPC] 💬 chat 完成:', sent, '帧');
      return { success: sent > 0, framesSent: sent };
    } catch (err) {
      console.error('[AI-IPC] ❌ chat 错误:', err.message);
      return { error: err.message };
    }
  });

  // 获取 AI 对话状态
  ipcMain.handle('ai:status', (_event, sessionId) => {
    const result = aiConversation.getStatus(sessionId);
    console.log('[AI-IPC] 📋 status 查询:', sessionId?.slice(0,8)||'all', '→', Array.isArray(result)?result.length+'设备':result);
    if (sessionId) {
      return { active: !!result, session: result };
    }
    const sessions = result || [];
    return { active: sessions.length > 0, sessions };
  });

  // 诊断：正弦波测试（绕过SAPI，直接发编码正弦波到设备）
  ipcMain.handle('ai:sine-test', async (_event, sessionId) => {
    console.log('[AI-IPC] 🔬 sine-test 触发:', sessionId?.slice(0,8));
    try {
      await aiConversation.runSineTest(sessionId, 440, 1000);
      return { success: true };
    } catch (err) {
      console.error('[AI-IPC] ❌ sine-test 错误:', err.message);
      return { error: err.message };
    }
  });

  // 获取网络信息（帮助用户配置 ESP32 设备连接）
  ipcMain.handle('ai:network-info', () => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of (addrs || [])) {
        if (addr.family === 'IPv4' && !addr.internal) {
          ips.push({ name, address: addr.address });
        }
      }
    }
    const bridgeClients = [];
    const bridge = getXiaozhiBridge();
    if (bridge?.clients) {
      for (const [ws, client] of bridge.clients) {
        bridgeClients.push({ sessionId: client.sessionId, ip: client.ip, state: client.state });
      }
    }
    return { ips, bridgePort: 8888, connectedDevices: bridgeClients };
  });
}

// ========== 小智 AI IPC ==========
function setupXiaozhiIPC() {
  // 启动/停止桥接服务器
  ipcMain.handle('xiaozhi:start', async () => {
    try {
      return await xiaozhiBridge.start();
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('xiaozhi:stop', async () => {
    return await xiaozhiBridge.stop();
  });

  ipcMain.handle('xiaozhi:status', () => {
    return xiaozhiBridge.getStatus();
  });

  // 发送消息到设备
  ipcMain.handle('xiaozhi:send-to-device', (_event, sessionId, message) => {
    return xiaozhiBridge.sendToDevice(sessionId, message);
  });

  ipcMain.handle('xiaozhi:broadcast', (_event, message) => {
    return xiaozhiBridge.broadcast(message);
  });

  // 设备控制
  ipcMain.handle('xiaozhi:take-photo', async (_event, sessionId) => {
    try {
      const result = await xiaozhiBridge.takePhoto(sessionId);
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('xiaozhi:set-volume', (_event, sessionId, volume) => {
    return xiaozhiBridge.setVolume(sessionId, volume);
  });

  ipcMain.handle('xiaozhi:set-brightness', (_event, sessionId, brightness) => {
    return xiaozhiBridge.setBrightness(sessionId, brightness);
  });

  ipcMain.handle('xiaozhi:tts-speak', (_event, sessionId, text) => {
    return xiaozhiBridge.ttsSpeak(sessionId, text);
  });

  ipcMain.handle('xiaozhi:send-mcp', (_event, sessionId, toolName, args) => {
    return xiaozhiBridge.sendMCPToolCall(sessionId, toolName, args);
  });
}
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

// ========== 音频桥接 IPC ==========
function setupAudioBridgeIPC() {
  ipcMain.handle('audio-bridge:connect', async () => {
    return await audioBridge.connect();
  });
  ipcMain.handle('audio-bridge:disconnect', async () => {
    return audioBridge.disconnect();
  });
  ipcMain.handle('audio-bridge:status', () => {
    return { connected: audioBridge.isConnected() };
  });
  ipcMain.handle('audio-bridge:list-ports', async () => {
    return await AudioSerialBridge.listPorts();
  });
  ipcMain.handle('audio-bridge:send-text', async (_event, text) => {
    return await audioBridge.sendText(text);
  });
  ipcMain.handle('audio-bridge:start-capture', () => {
    audioBridge.startCapture();
  });
  ipcMain.handle('audio-bridge:stop-capture', () => {
    audioBridge.stopCapture();
  });

  // 设置 AI 回调：音频桥接器收到语音 → 转发到渲染进程请求 Coze
  audioBridge.setCozeCallback(async (text) => {
    return new Promise((resolve) => {
      // 请求渲染进程处理 Coze 对话（复用现有 Coze 逻辑）
      const wins = BrowserWindow.getAllWindows();
      if (wins.length > 0) {
        // 发送事件让渲染进程处理
        wins[0].webContents.send('audio-bridge:coze-request', text);
        // 等待渲染进程返回
        const handler = (_event, response) => {
          ipcMain.removeListener('audio-bridge:coze-response', handler);
          resolve(response);
        };
        ipcMain.on('audio-bridge:coze-response', handler);
        // 30秒超时
        setTimeout(() => {
          ipcMain.removeListener('audio-bridge:coze-response', handler);
          resolve('');
        }, 30000);
      } else {
        resolve('');
      }
    });
  });

  // TTS 回调：AI 回复文字 → Edge TTS → PCM 音频
  audioBridge.setTtsCallback(async (text) => {
    try {
      console.log('[音频桥接] TTS 合成:', text.slice(0, 50));
      const result = await speechToPcm16(text);
      return result.pcm;
    } catch (e) {
      console.error('[音频桥接] TTS 失败:', e.message);
      return Buffer.alloc(0);
    }
  });

  // AI 回复后自动播报
  audioBridge.on('aiResponse', async (text) => {
    try {
      const result = await speechToPcm16(text);
      await audioBridge.sendSpeakerAudio(result.pcm);
    } catch (e) {
      console.error('[音频桥接] 播报失败:', e.message);
    }
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
  setupXiaozhiIPC();
  setupAudioBridgeIPC();
  setupAIConversationIPC();
  createWindow();



  // 自动启动小智桥接服务器
  xiaozhiBridge.start().then((result) => {
    console.log('[Main] 小智桥接自动启动:', result.status);
  }).catch(err => {
    console.warn('[Main] 小智桥接启动失败 (端口可能被占用):', err.message);
  });

  // ========== OTA 服务 (端口 8889) ==========
  otaServer = http.createServer((req, res) => {
    const ts = new Date().toLocaleTimeString();
    console.log(`[OTA] ${ts} ${req.method} ${req.url} from ${req.socket.remoteAddress}`);
    // 记录请求体
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (body) console.log(`[OTA]   Body: ${body.slice(0, 300)}`);
    });
    
    const response = {
      firmware: {
        version: "1.0.0",
        url: ""
      },
      websocket: {
        url: "ws://192.168.137.1:8888/"
      }
    };
    const json = JSON.stringify(response);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
      'Connection': 'close'
    });
    res.end(json);
  });
  otaServer.listen(8889, '0.0.0.0', () => {
    console.log('[Main] OTA 服务已启动: http://0.0.0.0:8889');
  });
});

app.on('window-all-closed', async () => {
  await disconnectServo();
  audioBridge.disconnect();
  await xiaozhiBridge.stop();
  if (otaServer) otaServer.close();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
