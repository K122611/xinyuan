import { app, BrowserWindow, screen, shell, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import os from 'os';
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
import { XiaozhiRelay } from './xiaozhi-relay.js';
import { AudioSerialBridge } from './audio-bridge.js';
import { speechToPcm16 } from './edge-tts.js';
import { sapiToPcm16 } from './sapi-tts.mjs';
import { AIConversation, opusSelfTest } from './ai-conversation.js';
import { start as startOTAInterceptor, stop as stopOTAInterceptor, detectLocalIP } from './ota-server.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ========== 加载 .env (修复：之前未加载导致 Supabase 注册失败) ==========
import dotenv from 'dotenv';
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

// ========== 主进程日志转发到渲染进程 ==========
// 使 F12 DevTools Console 能看到主进程的关键日志
(function setupLogForwarding() {
  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  function forward(level, ...args) {
    const msg = args.map(a => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a, null, 2); } catch (_) { return String(a); }
    }).join(' ');

    // 仍输出到主进程终端
    if (level === 'log') originalLog(msg);
    else if (level === 'error') originalError(msg);
    else if (level === 'warn') originalWarn(msg);

    // 转发到所有渲染进程窗口
    try {
      const wins = BrowserWindow.getAllWindows();
      for (const win of wins) {
        if (win && !win.isDestroyed()) {
          win.webContents.send('main:log', { level, msg, timestamp: Date.now() });
        }
      }
    } catch (_) {}
  }

  console.log = (...args) => forward('log', ...args);
  console.error = (...args) => forward('error', ...args);
  console.warn = (...args) => forward('warn', ...args);

  console.log('[Main] ✅ 主进程日志转发已启用 (F12 Console 可见)');
})();

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

// ========== 小智 中继模式 (独立对话，不依赖心元AI) ==========
const xiaozhiRelay = new XiaozhiRelay({
  log: (...args) => console.log('[中继]', ...args),
});

// 启动时查询官方服务器 URL（静默，不阻塞）
xiaozhiRelay.start().then((result) => {
  if (result.success) {
    console.log('[Main] ✅ 中继模式就绪，官方服务器:', xiaozhiRelay.serverUrl);
  } else {
    console.warn('[Main] ⚠ 中继模式初始化失败 (官方服务器不可达):', result.error);
    console.warn('[Main] 💡 本地 AI 模式正常运作中，可以稍后在 UI 中手动重试中继');
  }
}).catch(err => {
  console.warn('[Main] ⚠ 中继模式初始化异常:', err.message);
});

// 注入中继到桥接
xiaozhiBridge.setRelay(xiaozhiRelay);

// ========== AI 对话引擎实例 ==========
// 🔧 TTS 二阶兜底: Coze TTS → SAPI（Edge TTS 在中国永久 403，已移除）
console.log('[Main] 🎙️ 设备 TTS: Coze TTS → SAPI 二阶兜底');

const COZE_TTS_TOKEN = 'pat_CyuRGR2Jl8sCA5z9ExlK1leDoDsT04sDkegNp7ziiMRKEATt1uJgNCpIjFsZ8koZ';

async function cozeTtsToPcm16(text, voice = 'zh-CN-XiaoxiaoNeural') {
  const voiceMap = {
    'zh-CN-XiaoxiaoNeural': '7468512265151676443',  // 萌丫头
    'zh-CN-YunxiNeural': '7468512265151676443',      // 萌丫头 - 备用
  };
  const voiceId = voiceMap[voice] || '7468512265151676443';
  console.log('[CozeTTS] 🔄 请求合成:', text.slice(0, 30), 'voice_id:', voiceId);
  const res = await fetch('https://api.coze.cn/v1/audio/speech', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${COZE_TTS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'seed-tts-1.0.0', input: text, voice_id: voiceId, speed: 1.0, loudness_rate: 0.0, sample_rate: 16000, response_format: 'wav' }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Coze TTS HTTP ${res.status}: ${errBody.slice(0, 200)}`);
  }

  // 检查 Content-Type，决定如何处理返回数据
  const contentType = res.headers.get('content-type') || '';
  let buf = Buffer.from(await res.arrayBuffer());

  // 情况1: JSON 响应（可能 base64 编码）
  if (contentType.includes('json') || (buf.length > 4 && buf[0] === 0x7B)) {
    try {
      const json = JSON.parse(buf.toString('utf-8'));
      if (json.audio || json.data?.audio || json.pcm) {
        buf = Buffer.from(json.audio || json.data?.audio || json.pcm, 'base64');
        console.log('[CozeTTS] 📦 JSON→base64解码,', buf.length, 'bytes');
      } else {
        throw new Error('Coze TTS JSON 无 audio 字段: ' + JSON.stringify(json).slice(0, 200));
      }
    } catch (e) {
      if (e.message.startsWith('Coze TTS JSON')) throw e;
      // JSON 解析失败，可能是二进制数据被误判
    }
  }

  // 情况2: raw PCM (不是 WAV/RIFF，直接就是 int16 样本)
  const isWav = buf.length > 44 && buf.toString('ascii', 0, 4) === 'RIFF';
  let pcm = null;

  if (isWav) {
    // 标准 WAV 解析
    let off = 12;
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4);
      const sz = buf.readUInt32LE(off + 4);
      if (id === 'data') {
        const start = off + 8, end = Math.min(start + sz, buf.length);
        const n = Math.floor((end - start) / 2);
        pcm = new Int16Array(n);
        for (let i = 0; i < n; i++) pcm[i] = buf.readInt16LE(start + i * 2);
        break;
      }
      off += 8 + sz;
    }
    if (!pcm || pcm.length === 0) throw new Error('Coze TTS WAV data chunk 为空');
  } else {
    // Raw PCM16 LE（直接是 16-bit 有符号整数样本）
    const n = Math.floor(buf.length / 2);
    pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) pcm[i] = buf.readInt16LE(i * 2);
    console.log('[CozeTTS] 📦 raw PCM,', n, 'samples');
  }

  if (!pcm || pcm.length === 0) throw new Error('Coze TTS PCM 解析失败 (0 样本)');

  // 重采样到 16000 Hz（如果 Coze 返回的不是 16k）
  let finalPcm = pcm;
  // 大部分 TTS 返回 16k 或 24k，这里只对非 16k 做简单处理
  // Coze 默认大概率是 16k，保持原样

  const duration = pcm.length / 16000;
  console.log(`[CozeTTS] ✅ "${text.slice(0, 20)}..." → ${pcm.length}样本 ${duration.toFixed(1)}s`);
  return { pcm: finalPcm, sampleRate: 16000, duration };
}

const deviceTtsFn = async (text, voice, rate) => {
  // 1. Coze TTS
  try { return await cozeTtsToPcm16(text, voice); } catch (c) {
    console.warn('[Main] ⚠ Coze TTS 失败，回落 SAPI:', c.message);
  }
  // 2. SAPI（本地保底）
  try { return await sapiToPcm16(text); } catch (s) {
    console.error('[Main] ❌ 所有TTS均失败:', s.message);
    throw new Error('所有 TTS 均不可用');
  }
};

const aiConversation = new AIConversation(xiaozhiBridge, deviceTtsFn);

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

// ========== 中继模式 IPC ==========
function setupRelayIPC() {
  // 启动中继（切换到独立对话模式）
  ipcMain.handle('relay:start', async () => {
    console.log('[Relay-IPC] 🚀 请求启动中继模式...');
    try {
      if (!xiaozhiRelay.enabled) {
        await xiaozhiRelay.start();
      }
      return xiaozhiRelay.getStatus();
    } catch (err) {
      console.error('[Relay-IPC] ❌ 启动失败:', err.message);
      return { error: err.message };
    }
  });

  // 停止中继（切换回本地 AI 模式）
  ipcMain.handle('relay:stop', () => {
    console.log('[Relay-IPC] ⏹ 请求停止中继模式...');
    xiaozhiRelay.stop();
    return xiaozhiRelay.getStatus();
  });

  // 获取中继状态
  ipcMain.handle('relay:status', () => {
    return xiaozhiRelay.getStatus();
  });

  // 切换中继模式
  ipcMain.handle('relay:toggle', async () => {
    console.log('[Relay-IPC] 🔄 切换中继模式...');
    try {
      if (xiaozhiRelay.enabled) {
        xiaozhiRelay.stop();
      } else {
        await xiaozhiRelay.start();
      }
      return xiaozhiRelay.getStatus();
    } catch (err) {
      console.error('[Relay-IPC] ❌ 切换失败:', err.message);
      return { error: err.message };
    }
  });

  // 中继事件转发到渲染进程
  xiaozhiRelay.on('started', (info) => {
    broadcastToRenderer('relay:event', { type: 'started', ...info });
  });
  xiaozhiRelay.on('stopped', () => {
    broadcastToRenderer('relay:event', { type: 'stopped' });
  });
  xiaozhiRelay.on('serverDisconnected', (info) => {
    broadcastToRenderer('relay:event', { type: 'serverDisconnected', ...info });
  });
  xiaozhiRelay.on('serverError', (info) => {
    broadcastToRenderer('relay:event', { type: 'serverError', ...info });
  });
}

function broadcastToRenderer(channel, data) {
  BrowserWindow.getAllWindows().forEach(win => {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
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
  setupRelayIPC();
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
    
    // 🔧 动态获取本机 IP（优先非内部 IPv4）
    const interfaces = os.networkInterfaces();
    let localIP = '127.0.0.1';
    const candidates = [];
    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of (addrs || [])) {
        if (addr.family === 'IPv4' && !addr.internal) {
          candidates.push({ name, address: addr.address });
        }
      }
    }
    // 优先 WiFi / 以太网，跳过虚拟网卡
    const preferred = candidates.find(c =>
      /wi-?fi|wlan|以太|eth|en\d/i.test(c.name)) || candidates[0];
    if (preferred) localIP = preferred.address;

    const response = {
      firmware: {
        version: "1.0.0",
        url: ""
      },
      websocket: {
        url: `ws://${localIP}:8888/`
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

  // ========== OTA 拦截器 (DNS + HTTPS, 端口 8443, 需要 netsh 转发 443→8443) ==========
  try {
    detectLocalIP();
    startOTAInterceptor();
    console.log('[Main] ✅ OTA 拦截器已启动 (DNS:53, HTTPS:8443)');
  } catch (err) {
    console.warn('[Main] ⚠ OTA 拦截器启动失败 (可能需要管理员权限):', err.message);
    console.warn('[Main] 💡 ESP32 可能会显示"检查新版本失败"，不影响核心功能');
  }
});

app.on('window-all-closed', async () => {
  await disconnectServo();
  audioBridge.disconnect();
  xiaozhiRelay.stop();
  await xiaozhiBridge.stop();
  if (otaServer) otaServer.close();
  try { stopOTAInterceptor(); } catch (_) {}
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
