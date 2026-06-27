/**
 * 小智 AI WebSocket 桥接服务器
 * 
 * 实现小智 AI (XiaoZhi) 设备协议：
 *   - Hello 握手 (v1/v2/v3)
 *   - 二进制 Opus 音频帧处理
 *   - MCP JSON-RPC 2.0 工具调用
 *   - 桥接到 Coze AI 视觉分析
 * 
 * 协议参考: 78/xiaozhi-esp32 docs/websocket.md
 */

import { WebSocket, WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 常量 ───────────────────────────────────────────
const PROTOCOL_VERSION = 3;
const DEFAULT_PORT = 8888;
const OPUS_SAMPLE_RATE = 16000;
const OPUS_CHANNELS = 1;
const OPUS_FRAME_MS = 60;

// ─── 小智 WebSocket 桥接类 ──────────────────────────
class XiaozhiBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || DEFAULT_PORT;
    this.wss = null;
    this.clients = new Map();          // WebSocket → { sessionId, state, features }
    this._running = false;
    
    // 音频缓冲（每个客户端）
    this.audioBuffers = new Map();     // sessionId → Buffer[]
    
    // 外部回调（由 main.js 注入）
    this.onMCPToolCall = options.onMCPToolCall || null;
    this.onAudioData = options.onAudioData || null;
    this.onDeviceEvent = options.onDeviceEvent || null;
  }

  // ─── 启动服务器 ────────────────────────────────
  start() {
    return new Promise((resolve, reject) => {
      if (this._running) {
        return resolve({ port: this.port, status: 'already_running' });
      }

      try {
        this.wss = new WebSocketServer({ port: this.port });
        this._running = true;

        this.wss.on('listening', () => {
          console.log(`[小智桥接] ✅ WebSocket 服务器已启动: ws://0.0.0.0:${this.port}`);
          this.emit('server_started', { port: this.port });
          resolve({ port: this.port, status: 'started' });
        });

        this.wss.on('connection', (ws, req) => this._handleConnection(ws, req));
        this.wss.on('error', (err) => {
          console.error('[小智桥接] ❌ 服务器错误:', err.message);
          this.emit('server_error', err);
          if (!this._running) reject(err);
        });

        this.wss.on('close', () => {
          console.log('[小智桥接] 服务器已关闭');
          this._running = false;
          this.emit('server_stopped');
        });

      } catch (err) {
        this._running = false;
        reject(err);
      }
    });
  }

  // ─── 停止服务器 ────────────────────────────────
  stop() {
    return new Promise((resolve) => {
      if (!this.wss || !this._running) {
        this._running = false;
        return resolve({ status: 'already_stopped' });
      }

      // 通知所有客户端断开
      for (const [ws, client] of this.clients) {
        try {
          this._sendJSON(ws, { type: 'goodbye', session_id: client.sessionId, reason: 'server_shutdown' });
          ws.close(1001, 'Server shutting down');
        } catch (_) {}
      }
      this.clients.clear();
      this.audioBuffers.clear();

      this.wss.close(() => {
        this._running = false;
        resolve({ status: 'stopped' });
      });
    });
  }

  // ─── 获取状态 ──────────────────────────────────
  getStatus() {
    const deviceList = [];
    for (const [_, client] of this.clients) {
      deviceList.push({
        sessionId: client.sessionId,
        features: client.features,
        state: client.state,
        connectedAt: client.connectedAt,
        ip: client.ip,
      });
    }
    return {
      running: this._running,
      port: this.port,
      deviceCount: this.clients.size,
      devices: deviceList,
    };
  }

  // ─── 向指定设备发送消息 ────────────────────────
  sendToDevice(sessionId, message) {
    for (const [ws, client] of this.clients) {
      if (client.sessionId === sessionId) {
        this._sendJSON(ws, message);
        return true;
      }
    }
    return false;
  }

  // ─── 向指定设备发送 Opus 音频帧 ────────────────
  sendOpus(sessionId, opusFrame) {
    for (const [ws, client] of this.clients) {
      if (client.sessionId === sessionId) {
        if (ws.readyState !== 1) return false; // WebSocket.OPEN = 1
        ws.send(opusFrame);
        return true;
      }
    }
    return false;
  }

  // ─── 广播给所有设备 ───────────────────────────
  broadcast(message) {
    let count = 0;
    for (const [ws] of this.clients) {
      this._sendJSON(ws, message);
      count++;
    }
    return count;
  }

  // ─── 发送 MCP 工具调用到设备 ──────────────────
  async sendMCPToolCall(sessionId, toolName, args = {}) {
    const id = randomUUID().slice(0, 8);
    const request = {
      type: 'mcp',
      session_id: sessionId,
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    };
    this.sendToDevice(sessionId, request);
    return id;
  }

  // ─── 拍照并获取图片 ──────────────────────────
  // 小智设备拍照后通过 MCP 返回 base64 JPEG
  async takePhoto(sessionId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('拍照超时 (15s)')), 15000);
      
      const onResult = (ws, msg) => {
        if (msg.id && msg.result) {
          const { content } = msg.result;
          clearTimeout(timeout);
          this.removeListener('mcp_result', onResult);
          
          // 解析图片数据
          if (Array.isArray(content)) {
            for (const item of content) {
              if (item.type === 'image' && item.data) {
                return resolve({ imageBase64: item.data, mimeType: item.mimeType || 'image/jpeg' });
              }
              if (item.type === 'image_url' && item.image_url) {
                return resolve({ imageUrl: item.image_url.url });
              }
            }
          }
          resolve(msg.result);
        }
      };

      this.on('mcp_result', onResult);
      this.sendMCPToolCall(sessionId, 'self.camera.take_photo', {});
    });
  }

  // ─── 设置设备音量 ────────────────────────────
  setVolume(sessionId, volume) {
    return this.sendMCPToolCall(sessionId, 'self.audio_speaker.set_volume', { volume });
  }

  // ─── 设置屏幕亮度 ────────────────────────────
  setBrightness(sessionId, brightness) {
    return this.sendMCPToolCall(sessionId, 'self.screen.set_brightness', { brightness });
  }

  // ─── 设备 TTS 播报 ───────────────────────────
  ttsSpeak(sessionId, text) {
    return this.sendMCPToolCall(sessionId, 'self.audio_speaker.tts', { text });
  }

  // ─── 内部：处理新连接 ──────────────────────────
  _handleConnection(ws, req) {
    const ip = req.socket.remoteAddress;
    console.log(`[小智桥接] 🔗 新连接: ${ip}`);

    // 临时存储，等 hello 后确认
    const clientRef = { info: null, greeted: false };
    let setupTimer = null;

    // 超时未 hello 则断开（延长到30秒，给设备更多时间）
    setupTimer = setTimeout(() => {
      if (!clientRef.info) {
        // 如果收到了任何数据但没 hello，就当匿名连接处理
        if (clientRef.greeted) {
          console.log(`[小智桥接] ⚠️ ${ip} 未发 hello，但已有数据通信，保持连接`);
          return;
        }
        console.log(`[小智桥接] ⏰ ${ip} 30秒无数据，断开`);
        ws.close(4001, 'No data timeout');
      }
    }, 30000);

    ws.on('message', (data) => {
      clientRef.greeted = true;
      
      // ── 二进制消息：Opus 音频 或 JSON（v1 设备有时把 JSON 也当二进制发）──
      if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
        const buf = Buffer.from(data);

        // 🔧 使用 Uint8Array 读取首字节（绕过 Electron Buffer[i] 返回 0 的访问器 bug）
        const raw = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);

        // 🔧 检测是否为 JSON 消息（二进制帧里塞 JSON，xiaozhi v1 设备常见行为）
        //    JSON 以 '{' (0x7B) 开头
        if (raw.length > 0 && raw[0] === 0x7B) {
          try {
            const msg = JSON.parse(buf.toString('utf8'));
            console.log(`[小智桥接] 📨 二进制内JSON: type=${msg.type || '?'}, keys=${Object.keys(msg).join(',')}`);
            this._handleJSON(ws, clientRef, msg, setupTimer);
            return;
          } catch (e) {
            // 不是有效 JSON，当作 Opus 处理（虽然概率极低）
            console.log('[小智桥接] ⚠️ 二进制{开头但非JSON, 当作音频');
          }
        }

        // 🔧 检测 BinaryProtocol v2/v3 头部（version 字段 = 2 或 3）
        //    使用 Uint8Array/DataView 绕过 Buffer 访问器 bug
        if (raw.length >= 2) {
          const version = buf.readUInt16LE ? buf.readUInt16LE(0) : (raw[0] | (raw[1] << 8));
          if ((version === 2 || version === 3) && raw.length >= 6) {
            const hdrDv = new DataView(buf.buffer, buf.byteOffset, buf.length);
            const headerSize = version === 2 ? 16 : 6;
            const msgType = version === 2 ? hdrDv.getUint16(2, true) : raw[2];
            const payloadSize = version === 2 ? hdrDv.getUint32(12, true) : hdrDv.getUint16(4, true);
            const payload = buf.slice(headerSize, headerSize + Math.min(payloadSize, raw.length - headerSize));

            if (msgType === 1) {
              // JSON 消息
              try {
                const msg = JSON.parse(payload.toString('utf8'));
                console.log(`[小智桥接] 📨 BinProto v${version} JSON: type=${msg.type || '?'}`);
                this._handleJSON(ws, clientRef, msg, setupTimer);
                return;
              } catch (e) { /* fall through */ }
            }
            // msgType === 0: Opus，继续正常处理
          }
        }

        // 即使未握手也接受音频，自动创建会话
        if (!clientRef.info) {
          clientRef.info = {
            sessionId: randomUUID(),
            features: {},
            version: 1,
            state: 'streaming',
            connectedAt: new Date().toISOString(),
            ip: ws._socket?.remoteAddress || 'unknown',
            transport: 'websocket',
          };
          this.clients.set(ws, clientRef.info);
          clearTimeout(setupTimer);
          console.log(`[小智桥接] 📡 二进制流自动创建会话: ${clientRef.info.sessionId.slice(0,8)}`);
          
          // 立即回 hello 确认，让设备不超时
          this._sendJSON(ws, {
            type: 'hello',
            session_id: clientRef.info.sessionId,
            transport: 'websocket',
            audio_params: {
              format: 'opus',
              sample_rate: OPUS_SAMPLE_RATE,
              channels: OPUS_CHANNELS,
              frame_duration: OPUS_FRAME_MS,
            },
          });
          
          this.emit('device_connected', {
            sessionId: clientRef.info.sessionId,
            features: {},
            version: 1,
            ip: clientRef.info.ip,
          });
          if (this.onDeviceEvent) {
            this.onDeviceEvent('connected', clientRef.info);
          }
        }
        this._handleAudio(ws, clientRef.info, buf);
        return;
      }

      // ── 文本消息：JSON ──
      try {
        const msg = JSON.parse(data.toString());
        console.log(`[小智桥接] 📨 JSON: type=${msg.type || '?'}, keys=${Object.keys(msg).join(',')}`);
        this._handleJSON(ws, clientRef, msg, setupTimer);
      } catch (err) {
        console.warn('[小智桥接] ⚠️ 无效 JSON:', data.toString().slice(0, 100));
      }
    });

    ws.on('close', (code, reason) => {
      clearTimeout(setupTimer);
      // 清理匿名缓冲区
      if (this._anonBuffers) this._anonBuffers.delete(ws);
      if (clientRef.info) {
        console.log(`[小智桥接] 🔌 设备断开: ${clientRef.info.sessionId} (code=${code})`);
        this.audioBuffers.delete(clientRef.info.sessionId);
        this.clients.delete(ws);
        this.emit('device_disconnected', {
          sessionId: clientRef.info.sessionId,
          features: clientRef.info.features,
          code,
          reason: reason?.toString() || '',
        });
        if (this.onDeviceEvent) {
          this.onDeviceEvent('disconnected', clientRef.info);
        }
      }
    });

    ws.on('error', (err) => {
      console.error(`[小智桥接] ❌ WebSocket 错误 (${ip}):`, err.message);
    });
  }

  // ─── 重置音频帧计数器（用于诊断：每次 TTS 测试前清零，捕获最近帧） ──
  resetAudioCount(sessionId) {
    if (this._audioCount) this._audioCount.set(sessionId, 0);
  }

  // ─── 内部：保存设备 Mic Opus 帧用于诊断 ──────────
  _saveMicFrameDIAG(buf, sessionId, count) {
    try {
      const diagDir = path.join(__dirname, '..', 'debug');
      if (!existsSync(diagDir)) mkdirSync(diagDir, { recursive: true });
      const hex = buf.slice(0, Math.min(8, buf.length)).toString('hex');
      const slot = (count % 3) + 1;
      writeFileSync(path.join(diagDir, `mic_recent_${slot}.raw`), buf);
      writeFileSync(path.join(diagDir, `mic_recent_${slot}.json`), JSON.stringify({ count, len: buf.length, hex, ts: Date.now() }));
      if (count <= 3 || count % 500 === 0) {
        console.log(`[小智桥接] 🔬 Mic Frame #${count}: ${buf.length}B hex=${hex}`);
      }
    } catch(e) { console.error('[小智桥接] _saveMicFrameDIAG 错误:', e.message); }
  }

  // ─── 内部：处理二进制音频（合并后唯一版本） ──────
  _handleAudio(ws, clientInfo, buf) {
    if (!clientInfo) return;

    const { sessionId } = clientInfo;

    // 日志统计（避免刷屏）
    if (!this._audioCount) this._audioCount = new Map();
    const count = (this._audioCount.get(sessionId) || 0) + 1;
    this._audioCount.set(sessionId, count);
    if (count <= 3 || count % 50 === 0) {
      console.log(`[小智桥接] 🎵 音频帧 #${count} (${buf.length}B) from ${sessionId.slice(0,8)}`);
    }

    // 🔬 诊断：捕获设备 Opus 帧（最近 3 帧覆盖保存 + 每 500 帧保存一帧）
    this._saveMicFrameDIAG(buf, sessionId, count);

    // 缓冲音频帧
    if (!this.audioBuffers.has(sessionId)) {
      this.audioBuffers.set(sessionId, []);
    }
    this.audioBuffers.get(sessionId).push(buf);

    // 限制缓冲区大小（最多 5 秒）
    const maxFrames = Math.ceil(5000 / OPUS_FRAME_MS);
    const buffer = this.audioBuffers.get(sessionId);
    if (buffer.length > maxFrames) {
      buffer.splice(0, buffer.length - maxFrames);
    }

    // 通知外部（保持兼容：emit 两个单独参数 + onAudioData 回调）
    if (this.onAudioData) {
      this.onAudioData(sessionId, buf);
    }
    this.emit('audio', sessionId, buf);
  }

  // ─── 内部：处理 JSON 消息 ────────────────────────
  _handleJSON(ws, clientRef, msg, setupTimer) {
    const type = msg.type;

    // ── Hello 握手 ──
    if (type === 'hello') {
      clearTimeout(setupTimer);
      const sessionId = randomUUID();
      const features = msg.features || { mcp: false };
      const version = msg.version || 1;

      clientRef.info = {
        sessionId,
        features,
        version,
        state: 'connected',
        connectedAt: new Date().toISOString(),
        ip: ws._socket?.remoteAddress || 'unknown',
        transport: msg.transport || 'websocket',
      };

      this.clients.set(ws, clientRef.info);

      console.log(`[小智桥接] 👋 Hello 握手完成: session=${sessionId.slice(0,8)}, v${version}, mcp=${features.mcp}`);

      // 回复 hello
      const helloReply = {
        type: 'hello',
        session_id: sessionId,
        transport: 'websocket',
        audio_params: {
          format: 'opus',
          sample_rate: OPUS_SAMPLE_RATE,
          channels: OPUS_CHANNELS,
          frame_duration: OPUS_FRAME_MS,
        },
      };
      this._sendJSON(ws, helloReply);

      this.emit('device_connected', {
        sessionId,
        features,
        version,
        ip: clientRef.info.ip,
      });

      if (this.onDeviceEvent) {
        this.onDeviceEvent('connected', clientRef.info);
      }

      return;
    }

    // ── 设备开始/停止监听 ──
    if (type === 'listen') {
      if (clientRef.info) {
        const listenState = msg.state || 'start';
        console.log(`[小智桥接] 🎙️ 设备 listen ${listenState}`);
        if (this.onDeviceEvent) {
          this.onDeviceEvent('listen_' + listenState, clientRef.info);
        }
      }
      return;
    }

    // 未握手但收到了有意义的消息 → 自动创建临时会话
    if (!clientRef.info) {
      clientRef.info = {
        sessionId: randomUUID(),
        features: {},
        version: 1,
        state: 'anonymous',
        connectedAt: new Date().toISOString(),
        ip: ws._socket?.remoteAddress || 'unknown',
        transport: 'websocket',
      };
      this.clients.set(ws, clientRef.info);
      clearTimeout(setupTimer);
      console.log(`[小智桥接] 📡 匿名连接自动创建会话: ${clientRef.info.sessionId.slice(0,8)}`);
      
      // 也触发 connected 事件让 AI 引擎接管
      this.emit('device_connected', {
        sessionId: clientRef.info.sessionId,
        features: {},
        version: 1,
        ip: clientRef.info.ip,
      });
    }

    // ── MCP 响应 ──
    if (type === 'mcp' || msg.jsonrpc === '2.0') {
      if (msg.id && (msg.result || msg.error)) {
        this.emit('mcp_result', ws, msg);
      }
      return;
    }

    // ── 设备状态变更 ──
    if (type === 'state') {
      clientRef.info.state = msg.state || 'unknown';
      this.emit('device_state_changed', {
        sessionId: clientRef.info.sessionId,
        state: clientRef.info.state,
      });
      if (this.onDeviceEvent) {
        this.onDeviceEvent('state_changed', clientRef.info);
      }
      return;
    }

    // ── 设备事件 ──
    if (type === 'event') {
      this.emit('device_event', {
        sessionId: clientRef.info.sessionId,
        event: msg.event,
        data: msg.data,
      });
      if (this.onDeviceEvent) {
        this.onDeviceEvent(msg.event, { ...clientRef.info, data: msg.data });
      }
      return;
    }

    // ── 语音识别结果（如果设备有 ASR） ──
    if (type === 'asr') {
      this.emit('asr_result', {
        sessionId: clientRef.info.sessionId,
        text: msg.text,
        isFinal: msg.is_final || false,
      });
      return;
    }

    // ── 其他消息类型 ──
    this.emit('message', {
      sessionId: clientRef.info.sessionId,
      type,
      data: msg,
    });

    console.log(`[小智桥接] 📨 设备消息: type=${type}, session=${clientRef.info.sessionId.slice(0,8)}`);
  }

  // ─── 内部：发送 JSON ─────────────────────────────
  _sendJSON(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  // ─── 获取设备的音频缓冲 ──────────────────────────
  getAudioBuffer(sessionId) {
    return this.audioBuffers.get(sessionId) || [];
  }

  // ─── 清除音频缓冲 ────────────────────────────────
  clearAudioBuffer(sessionId) {
    this.audioBuffers.delete(sessionId);
  }

}

export { XiaozhiBridge };
