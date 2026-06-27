/**
 * 心元 WebSocket Bridge v2
 *
 * 提供 WSS (TLS WebSocket) + MQTT 代理以支持 DNS 欺骗替代方案
 * ESP32 原本连接 api.tenclass.net:443/wss 或 mqtt.xiaozhi.me 走 DNS 欺骗即可路由到本机
 *
 * 端口:
 *   WSS (port 443)  → 加密通道(语音/MCP/表情)
 *   WS  (port 8888) → 本地调试
 *   MQTT (port 1883/8883) → MQTT代理
 *
 * OTA端点: /xiaozhi/ota/ → 返回 WebSocket 配置给 ESP32
 */

import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import net from 'net';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ======================== 配置 ========================
const HELLO_VERSION = 3;
const AUDIO_DIR = path.join(__dirname, '..', 'audio_cache');
const CERT_DIR = path.join(__dirname, '..', 'certs');

// 笔记本电脑热点 IP（ESP32 连接此热点后访问）
// 自动检测热点 IP，优先使用传入参数
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const { detectHotspotIP } = _require('../scripts/auto_detect_ip.cjs');
let LAPTOP_HOTSPOT_IP = '192.168.137.1';  // 默认值，会被 constructor 覆盖
const WS_PORT = 8888;

// ======================== 自签名证书 ========================

async function generateSelfSignedCert() {
  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });
  const keyPath = path.join(CERT_DIR, 'xiaozhi-key.pem');
  const certPath = path.join(CERT_DIR, 'xiaozhi-cert.pem');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    console.log('[Bridge] 加载已有证书...');
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  // 自签证书用内置 crypto 而非 python 脚本
  console.log('[Bridge] 生成自签名证书...(crypto)');
  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    // X509 cert simplified - use python gen_cert as fallback
    throw new Error('use python');
  } catch (_) {
    console.log('[Bridge] 尝试调用 Python 生成证书...');
    const { execSync } = await import('child_process');
    try {
      const genScript = path.join(__dirname, '..', 'gen_cert.py');
      execSync(`python "${genScript}"`, { stdio: 'inherit' });
      if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
      }
    } catch (e) {
      console.log('[Bridge] Python 生成证书失败:', e.message);
    }
  }
  throw new Error('无法生成/加载 SSL 证书: 请运行 python gen_cert.py');
}

// ======================== 音频缓存 ========================
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

// ======================== 设备注册表 ========================
class DeviceRegistry {
  constructor() {
    this.devices = new Map();
  }

  register(deviceId, ws, info = {}) {
    const existing = this.devices.get(deviceId);
    if (existing) try { existing.ws.close(); } catch (_) {}
    this.devices.set(deviceId, {
      ws, info: { ...info, registeredAt: new Date().toISOString() },
      audioBuffer: [], connectedAt: Date.now(),
    });
    return this.devices.get(deviceId);
  }

  unregister(deviceId) {
    const device = this.devices.get(deviceId);
    if (device) { this.flushAudio(deviceId); this.devices.delete(deviceId); }
    return device;
  }

  get(deviceId) { return this.devices.get(deviceId); }

  pushAudio(deviceId, chunk) {
    const device = this.devices.get(deviceId);
    if (device) device.audioBuffer.push(chunk);
  }

  flushAudio(deviceId) {
    const device = this.devices.get(deviceId);
    if (device && device.audioBuffer.length > 0) {
      const filename = `${deviceId}_${Date.now()}.opus`;
      const filepath = path.join(AUDIO_DIR, filename);
      fs.writeFileSync(filepath, Buffer.concat(device.audioBuffer));
      device.audioBuffer = [];
      return filepath;
    }
    return null;
  }

  getAll() {
    return [...this.devices].map(([id, d]) => ({
      id, ...d.info, connectedAt: new Date(d.connectedAt).toISOString()
    }));
  }

  get firstDevice() {
    const first = this.devices.values().next();
    return first.done ? null : first.value;
  }
}

// ======================== MQTT 代理 ========================
class MqttProxy {
  constructor(log) {
    this.log = log || (() => {});
    this.server = null;
    this.clients = new Map();
  }

  start(port) {
    return new Promise((resolve, reject) => {
      try {
        this.server = net.createServer((socket) => {
          const addr = socket.remoteAddress;
          this.log(`MQTT 连接: ${addr}`);

          let buf = Buffer.alloc(0);

          socket.on('data', (data) => {
            buf = Buffer.concat([buf, data]);

            // MQTT CONNECT 包: 标识符 0x10 + 长度 + 协议名 "MQTT" + 版本
            if (buf.length >= 2) {
              const cmd = buf[0] >> 4;
              const remainingLen = buf[1];

              if (cmd === 1) { // CONNECT
                // 返回 CONNACK (0x20, 0x02, 0x00, 0x00) 表示连接成功
                const connack = Buffer.from([0x20, 0x02, 0x00, 0x00]);
                socket.write(connack);
                this.log(`✓ MQTT CONNACK → ${addr}`);
                this.clients.set(addr, { socket, connectedAt: Date.now() });
              } else if (cmd === 12) { // PINGREQ
                socket.write(Buffer.from([0xD0, 0x00]));
              } else if (cmd === 14) { // DISCONNECT
                socket.end();
              }
            }
          });

          socket.on('close', () => {
            this.clients.delete(addr);
            this.log(`MQTT 断开: ${addr}`);
          });

          socket.on('error', (err) => {
            this.log(`MQTT 错误 [${addr}]: ${err.message}`);
          });
        });

        this.server.listen(port, '0.0.0.0', () => {
          this.log(`✓ MQTT 代理已启动: mqtt://0.0.0.0:${port}`);
          resolve();
        });

        this.server.on('error', reject);
      } catch (err) { reject(err); }
    });
  }

  stop() {
    return new Promise((resolve) => {
      for (const [addr, client] of this.clients) {
        try { client.socket.destroy(); } catch (_) {}
      }
      this.clients.clear();
      if (this.server) {
        this.server.close(() => resolve());
      } else { resolve(); }
    });
  }
}

// ======================== 小智桥接器 ========================
export class XiaozhiBridge extends EventEmitter {
  constructor(opts = {}) {
    super();

    // 自动检测热点 IP（可手动指定）
    if (opts.hotspotIp) {
      LAPTOP_HOTSPOT_IP = opts.hotspotIp;
    } else {
      const detected = detectHotspotIP();
      if (detected) LAPTOP_HOTSPOT_IP = detected.ip;
    }

    this.port = opts.port || 8888;
    this.extraPorts = opts.extraPorts || [8883];
    this.enableWss = opts.enableWss !== false;
    this.wssPort = opts.wssPort || 443;
    this.enableMqtt = opts.enableMqtt !== false;
    this.mqttPorts = opts.mqttPorts || [1883, 8883];

    this.wss = null;
    this.wsHttpServer = null;  // HTTP server that also handles WS upgrades on port 8888
    this.wssSecure = null;
    this.httpsServer = null;
    this.extraServers = [];
    this.mqttProxies = [];
    this.registry = new DeviceRegistry();
    this.running = false;

    this.log = opts.log || ((...args) => console.log('[XiaoZhi Bridge]', ...args));
    this._onMessage = opts.onMessage || null;
    this._onAudio = opts.onAudio || null;
    this._onTtsRequest = opts.onTtsRequest || null;
    this._onPhoto = opts.onPhoto || null;
  }

  // ======================== 启动 ========================
  async start() {
    // 1. 启动 WS 服务器 (端口 8888，同时提供 OTA HTTP 端点)
    await this._startWsServer(this.port);

    // 2. 启动 WSS (TLS WebSocket 端口 443)
    if (this.enableWss) {
      try {
        const { key, cert } = await generateSelfSignedCert();
        this.httpsServer = https.createServer({ key, cert }, (req, res) => {
          // OTA 端点也支持在 443 上
          if (req.url.startsWith('/xiaozhi/ota/')) {
            this._handleOtaRequest(req, res);
            return;
          }
          // 其他 HTTP 请求返回状态页
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h2>心元 XiaoZhi Bridge ✓</h2><p>WSS 服务运行中 | 端口 ${this.wssPort}</p>`);
        });

        this.wssSecure = new WebSocketServer({ server: this.httpsServer });
        this.wssSecure.on('connection', (ws, req) => this._handleConnection(ws, req));
        this.wssSecure.on('error', (err) => this.log('⚠ WSS 错误:', err.message));

        await new Promise((resolve, reject) => {
          this.httpsServer.listen(this.wssPort, '0.0.0.0', () => {
            this.log(`✓ WSS 服务器已启动: wss://0.0.0.0:${this.wssPort}`);
            resolve();
          });
          this.httpsServer.on('error', reject);
        });
      } catch (err) {
        this.log(`⚠ WSS 端口 ${this.wssPort} 启动失败: ${err.message}`);
      }
    }

    // 3. 额外 WS 端口
    for (const port of this.extraPorts) {
      try {
        const extraWss = new WebSocketServer({ port }, () => {
          this.log(`✓ 额外端口: ws://0.0.0.0:${port}`);
          extraWss.on('connection', (ws, req) => {
            this.log(`🔗 额外连接 [${port}]: ${req.socket.remoteAddress}`);
            this._handleConnection(ws, req);
          });
          extraWss.on('error', (err) => this.log(`⚠ 端口 ${port} 错误:`, err.message));
        });
        this.extraServers.push(extraWss);
      } catch (err) {
        this.log(`⚠ 额外端口 ${port}: ${err.message}`);
      }
    }

    // 4. 启动 MQTT
    if (this.enableMqtt) {
      for (const mqttPort of this.mqttPorts) {
        if (mqttPort === 8883 && this.extraPorts.includes(8883)) continue; // 跳过已用的 WS 端口
        try {
          const mqtt = new MqttProxy(this.log);
          await mqtt.start(mqttPort);
          this.mqttProxies.push({ port: mqttPort, proxy: mqtt });
        } catch (err) {
          this.log(`⚠ MQTT 端口 ${mqttPort} 错误: ${err.message}`);
        }
      }
    }

    this.running = true;
    this.log('✓ 所有服务已启动');
    this.emit('started', { port: this.port, wssPort: this.wssPort });
    return { success: true, port: this.port, wssPort: this.wssPort };
  }

  _startWsServer(port) {
    return new Promise((resolve, reject) => {
      try {
        // 创建 HTTP 服务器，处理 OTA 请求和 WebSocket 升级
        this.wsHttpServer = http.createServer((req, res) => {
          // OTA 端点: ESP32 通过此端点获取 WebSocket 配置
          if (req.url.startsWith('/xiaozhi/ota/')) {
            this._handleOtaRequest(req, res);
            return;
          }
          // 其他 HTTP 请求
          res.writeHead(426, { 'Content-Type': 'text/plain' });
          res.end('WebSocket server - use WebSocket protocol');
        });

        this.wss = new WebSocketServer({ server: this.wsHttpServer });
        this.wss.on('connection', (ws, req) => this._handleConnection(ws, req));
        this.wss.on('error', (err) => this.log('⚠ WS 错误:', err.message));

        this.wsHttpServer.listen(port, '0.0.0.0', () => {
          this.log(`✓ WS 服务器已启动: ws://0.0.0.0:${port}`);
          this.log(`  OTA 端点: http://${LAPTOP_HOTSPOT_IP}:${port}/xiaozhi/ota/`);
          resolve();
        });

        this.wsHttpServer.on('error', reject);
        this.wss.on('close', () => {
          this.running = false;
          this.emit('close');
        });
      } catch (err) { reject(err); }
    });
  }

  // ======================== OTA HTTP 端点 ========================
  // 模拟 OTA 服务器的 version check 响应
  _handleOtaRequest(req, res) {
    this.log(`📡 OTA请求: ${req.url}`);

    // 响应格式匹配 xiaozhi-esp32 OTA v2/version 接口
    const response = {
      activation: {
        code: ""  // 空 code = 无需激活
      },
      server_time: {
        timestamp: Date.now(),
        timezone_offset: 480  // UTC+8
      },
      websocket: {
        url: `ws://${LAPTOP_HOTSPOT_IP}:${WS_PORT}`,
        token: "",
        version: 1,
        audio_params: {
          format: "opus",
          sample_rate: 16000,
          channels: 1,
          frame_duration: 60
        }
      }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  // ======================== 停止 ========================
  async stop() {
    const tasks = [];

    // 清理连接
    for (const [id, device] of this.registry.devices) {
      try { device.ws.close(1000, 'Server shutting down'); } catch (_) {}
    }
    this.registry.devices.clear();

    // 清理额外端口
    for (const extra of this.extraServers) {
      tasks.push(new Promise(r => { try { extra.close(() => r()); } catch (_) { r(); } }));
    }
    this.extraServers = [];

    // 清理 MQTT
    for (const { proxy } of this.mqttProxies) {
      tasks.push(proxy.stop());
    }
    this.mqttProxies = [];

    // 清理 WSS
    if (this.wssSecure) {
      tasks.push(new Promise(r => { try { this.wssSecure.close(() => r()); } catch (_) { r(); } }));
    }
    if (this.httpsServer) {
      tasks.push(new Promise(r => { try { this.httpsServer.close(() => r()); } catch (_) { r(); } }));
    }

    // 清理 WS (包括 HTTP server)
    if (this.wss) {
      tasks.push(new Promise(r => { try { this.wss.close(() => r()); } catch (_) { r(); } }));
    }
    if (this.wsHttpServer) {
      tasks.push(new Promise(r => { try { this.wsHttpServer.close(() => r()); } catch (_) { r(); } }));
    }

    await Promise.all(tasks);
    this.running = false;
    this.log('✓ 所有服务已停止');
    this.emit('stopped');
    return { success: true };
  }

  // ======================== 连接处理 ========================
  _handleConnection(ws, req) {
    const clientIp = req.socket.remoteAddress;
    this.log(`🔗 新连接: ${clientIp}`);

    let deviceId = null;
    let authenticated = false;

    ws.on('message', (data, isBinary) => {
      try {
        if (isBinary) this._handleBinary(ws, deviceId, data);
        else {
          this._handleText(ws, deviceId, data.toString(), () => { authenticated = true; });
        }
      } catch (err) { this.log('⚠ 消息错误:', err.message); }
    });

    ws.on('close', (code) => {
      this.log(`🔌 断开: ${deviceId || clientIp} (code=${code})`);
      if (deviceId) {
        this.emit('deviceDisconnected', { deviceId });
        this.registry.unregister(deviceId);
      }
    });

    ws.on('error', (err) => this.log(`⚠ WS错误 [${clientIp}]:`, err.message));

    const authTimer = setTimeout(() => {
      if (!authenticated) {
        this.log(`⏰ 认证超时: ${clientIp}`);
        ws.close(4001, 'Authentication timeout');
      }
    }, 10000);
    ws.once('close', () => clearTimeout(authTimer));
  }

  // ======================== 二进制 (音频) ========================
  _handleBinary(ws, deviceId, data) {
    if (!deviceId || data.length < 10) return;
    this.registry.pushAudio(deviceId, Buffer.from(data));

    const device = this.registry.get(deviceId);
    if (device && device.audioBuffer.length >= 50) {
      const audioPath = this.registry.flushAudio(deviceId);
      if (audioPath) {
        if (this._onAudio) this._onAudio({ deviceId, audioPath, timestamp: Date.now() });
        this.emit('audio', { deviceId, audioPath, timestamp: Date.now() });
      }
    }
  }

  // ======================== 文本消息 ========================
  _handleText(ws, deviceId, text, onAuth) {
    this.log('📨 消息:', text.substring(0, 200));

    let msg;
    try { msg = JSON.parse(text); } catch {
      return; // 非 JSON消息忽略
    }

    // === Hello 握手 ===
    if (msg.type === 'hello') {
      const devId = msg.device_id || msg.deviceId || msg.mac || `device_${Date.now()}`;
      deviceId = devId;
      this.registry.register(devId, ws, { deviceId: devId, ...msg });
      onAuth();
      this.log(`👋 Hello: ${devId}`);

      ws.send(JSON.stringify({
        type: 'hello',
        transport: msg.transport || 'websocket',
        session_id: devId,
        audio_params: {
          format: 'opus',
          sample_rate: 16000,
          channels: 1,
          frame_duration: 60,
        },
      }));

      this.emit('deviceConnected', { deviceId: devId, info: msg });
      return;
    }

    if (!deviceId) return;

    // === MCP JSON-RPC ===
    if (msg.jsonrpc === '2.0' && msg.method) {
      this._handleMcpCall(ws, deviceId, msg);
      return;
    }

    // === 聊天 ===
    if (msg.type === 'chat' || msg.text || msg.content) {
      const chatText = msg.text || msg.content || '';
      if (this._onMessage) this._onMessage({ deviceId, text: chatText, timestamp: Date.now(), raw: msg });
      this.emit('chat', { deviceId, text: chatText, timestamp: Date.now(), raw: msg });
      return;
    }

    // === 表情 ===
    if (msg.type === 'emotion' || msg.emotion) {
      this.emit('emotion', { deviceId, emotion: msg.emotion, confidence: msg.confidence, raw: msg });
      return;
    }

    // === Ping ===
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      return;
    }
  }

  // ======================== MCP JSON-RPC ========================
  _handleMcpCall(ws, deviceId, msg) {
    const { id, method, params } = msg;
    this.log(`🔧 MCP: ${method}`);

    switch (method) {
      case 'tools/list':
        this._sendMcp(ws, id, { tools: [
          { name: 'self.camera.take_photo', description: '拍照', parameters: {} },
          { name: 'self.audio_speaker.tts', description: 'TTS', parameters: { type:'object', properties:{ text:{type:'string'}, voice:{type:'string'} }, required:['text'] } },
          { name: 'self.servo.set_angle', description: '舵机', parameters: { type:'object', properties:{ angle:{type:'number'}, speed:{type:'number'} }, required:['angle'] } },
          { name: 'self.display.show_expression', description: '表情', parameters: { type:'object', properties:{ expression:{type:'string'}, duration:{type:'number'} }, required:['expression'] } },
        ]});
        break;
      case 'tools/call':
        if (!params?.name) { this._sendMcpErr(ws, id, -32602, 'Missing tool name'); return; }
        this._handleToolCall(ws, deviceId, id, params);
        break;
      default:
        this._sendMcpErr(ws, id, -32601, `Unknown method: ${method}`);
    }
  }

  _handleToolCall(ws, deviceId, id, params) {
    const { name, arguments: args = {} } = params;
    switch (name) {
      case 'self.camera.take_photo':
        if (this._onPhoto) this._onPhoto({ deviceId });
        this.emit('photo', { deviceId });
        this._sendMcp(ws, id, { status:'ok', message:'Photo taken' });
        break;
      case 'self.audio_speaker.tts':
        if (this._onTtsRequest) this._onTtsRequest({ deviceId, text: args.text, voice: args.voice });
        this.emit('tts', { deviceId, text: args.text, voice: args.voice });
        this._sendMcp(ws, id, { status:'ok', text: args.text });
        break;
      case 'self.servo.set_angle':
        this.emit('servo', { deviceId, angle: args.angle, speed: args.speed });
        this._sendMcp(ws, id, { status:'ok', angle: args.angle });
        break;
      case 'self.display.show_expression':
        this.emit('expression', { deviceId, expression: args.expression, duration: args.duration });
        this._sendMcp(ws, id, { status:'ok', expression: args.expression });
        break;
      default:
        this._sendMcpErr(ws, id, -32601, `Tool not found: ${name}`);
    }
  }

  _sendMcp(ws, id, result) {
    ws.send(JSON.stringify({ jsonrpc:'2.0', id, result }));
  }
  _sendMcpErr(ws, id, code, message) {
    ws.send(JSON.stringify({ jsonrpc:'2.0', id, error:{ code, message } }));
  }

  // ======================== 消息发送 ========================
  _getDeviceWs(deviceId) {
    const device = this.registry.get(deviceId);
    if (!device) return null;
    return device.ws;
  }

  sendTts(deviceId, text, voice = 'default') {
    const ws = this._getDeviceWs(deviceId);
    if (!ws) return { success: false, message: `设备 ${deviceId} 不在线` };
    ws.send(JSON.stringify({ type: 'tts', text, voice, timestamp: Date.now() }));
    return { success: true };
  }

  sendExpression(deviceId, expression, duration = 2000) {
    const ws = this._getDeviceWs(deviceId);
    if (!ws) return { success: false, message: `设备 ${deviceId} 不在线` };
    ws.send(JSON.stringify({ type: 'expression', expression, duration, timestamp: Date.now() }));
    return { success: true };
  }

  sendServo(deviceId, angle, speed = 500) {
    const ws = this._getDeviceWs(deviceId);
    if (!ws) return { success: false, message: `设备 ${deviceId} 不在线` };
    ws.send(JSON.stringify({ type: 'servo', angle, speed, timestamp: Date.now() }));
    return { success: true };
  }

  sendChat(deviceId, text, emotion = null) {
    const ws = this._getDeviceWs(deviceId);
    if (!ws) return { success: false, message: `设备 ${deviceId} 不在线` };
    ws.send(JSON.stringify({ type: 'chat', text, emotion, timestamp: Date.now() }));
    return { success: true };
  }

  requestPhoto(deviceId) {
    const ws = this._getDeviceWs(deviceId);
    if (!ws) return { success: false, message: `设备 ${deviceId} 不在线` };
    ws.send(JSON.stringify({ type: 'request_photo', timestamp: Date.now() }));
    return { success: true };
  }

  getDevices() { return this.registry.getAll(); }
  getClient(deviceId) {
    const device = this.registry.get(deviceId);
    return device ? { id: deviceId, ws: device.ws, ...device.info } : null;
  }
  getClients() { return this.registry.getAll(); }
  flushDeviceAudio(deviceId) { return this.registry.flushAudio(deviceId); }

  /**
   * 发送二进制 Opus 音频帧到设备（用于设备喇叭播放）
   * @param {string} deviceId
   * @param {Buffer} opusFrame - 单帧 Opus 数据（60ms @ 16kHz）
   */
  sendOpus(deviceId, opusFrame) {
    const ws = this._getDeviceWs(deviceId);
    if (!ws) return false;
    try {
      ws.send(opusFrame);
      return true;
    } catch (err) {
      this.log(`⚠ sendOpus 错误 [${deviceId}]:`, err.message);
      return false;
    }
  }

  /**
   * 发送 JSON 消息到设备（文本帧）
   * @param {string} deviceId
   * @param {Object} jsonMsg - 要发送的 JSON 对象
   */
  sendJson(deviceId, jsonMsg) {
    const ws = this._getDeviceWs(deviceId);
    if (!ws) return false;
    try {
      ws.send(JSON.stringify(jsonMsg));
      return true;
    } catch (err) {
      this.log(`⚠ sendJson 错误 [${deviceId}]:`, err.message);
      return false;
    }
  }
}

// ======================== 独立运行 ========================
if (process.argv[1] && process.argv[1].includes('xiaozhi-bridge')) {
  const bridge = new XiaozhiBridge({
    enableWss: true, wssPort: 443,
    enableMqtt: true, mqttPorts: [1883],
    extraPorts: [8883],
    log: (msg, ...args) => console.log(`[${new Date().toISOString()}] ${msg}`, ...args),
    onMessage: ({ deviceId, text }) => console.log(`[Bridge] 消息 ${deviceId}: "${text}"`),
    onAudio: ({ deviceId, audioPath }) => console.log(`[Bridge] 音频 ${deviceId} → ${audioPath}`),
    onTtsRequest: ({ deviceId, text }) => console.log(`[Bridge] TTS: ${deviceId} → "${text}"`),
    onPhoto: ({ deviceId }) => console.log(`[Bridge] 拍照 ${deviceId}`),
  });

  bridge.start().then(() => {
    console.log('\n========================================');
    console.log('  心元 Bridge v2 已启动');
    console.log('  ws://0.0.0.0:8888  (调试+OTA)');
    console.log('  wss://0.0.0.0:443  (TLS)');
    console.log('  mqtt://0.0.0.0:1883 (MQTT代理)');
    console.log('  OTA端点: http://0.0.0.0:8888/xiaozhi/ota/');
    console.log('  配合 DNS欺骗: python dns_spoof.py');
    console.log('========================================\n');
  }).catch(err => {
    console.error('启动失败:', err);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    console.log('\n正在停止...');
    await bridge.stop();
    process.exit(0);
  });
}
