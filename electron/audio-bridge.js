/**
 * 音频串口桥接器 (Electron 主进程)
 * 
 * 连接 ESP32-S3 通过 USB 串口 (COM5)
 * 实现: 麦克风PCM → STT → Coze AI → TTS → 扬声器PCM
 */
import { EventEmitter } from 'events';
import { SerialPort } from 'serialport';

// 帧协议常量
const FRAME_HEADER = 0xAA;
const FRAME_FOOTER = 0x55;
const FRAME_TYPE_MIC_AUDIO = 0x01;
const FRAME_TYPE_SPK_AUDIO = 0x02;
const FRAME_TYPE_COMMAND = 0x03;
const CMD_START_CAPTURE = 0x10;
const CMD_STOP_CAPTURE = 0x11;
const CMD_PING = 0x20;
const CMD_PONG = 0x21;

export class AudioSerialBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.portName = options.portName || 'COM5';
    this.baudRate = options.baudRate || 921600;
    this.onStatus = options.onStatus || (() => {});
    this.onAudioLevel = options.onAudioLevel || (() => {});

    this.port = null;
    this.connected = false;
    this.rxBuffer = Buffer.alloc(0);
    this.captureEnabled = true;

    // VAD 语音检测
    this.speechBuffer = [];
    this.recordingSpeech = false;
    this.vadSilenceCount = 0;
    this.isSpeaking = false;

    // 外部回调
    this.sttCallback = null;
    this.cozeCallback = null;
    this.ttsCallback = null;
  }

  setSttCallback(cb) { this.sttCallback = cb; }
  setCozeCallback(cb) { this.cozeCallback = cb; }
  setTtsCallback(cb) { this.ttsCallback = cb; }

  // ========== 连接 ==========
  async connect() {
    return new Promise((resolve) => {
      this.onStatus(`正在连接 ${this.portName}...`);
      try {
        this.port = new SerialPort({
          path: this.portName,
          baudRate: this.baudRate,
        });

        this.port.on('open', () => {
          this.connected = true;
          this.onStatus(`✅ ESP32 已连接 @ ${this.portName}`);
          this.emit('connected');
          setTimeout(() => this.sendCommand(CMD_PING), 500);
          resolve(true);
        });

        this.port.on('data', (data) => this.handleRxData(data));
        this.port.on('close', () => {
          this.connected = false;
          this.onStatus('串口已断开');
          this.emit('disconnected');
        });
        this.port.on('error', (err) => {
          this.onStatus(`串口错误: ${err.message}`);
          this.emit('error', err);
        });
      } catch (e) {
        this.onStatus(`连接失败: ${e.message}`);
        resolve(false);
      }
    });
  }

  disconnect() {
    if (this.port && this.port.isOpen) {
      this.port.close();
    }
    this.connected = false;
  }

  // ========== 数据接收 ==========
  handleRxData(data) {
    this.rxBuffer = Buffer.concat([this.rxBuffer, data]);

    while (this.rxBuffer.length >= 6) {
      const headerIdx = this.rxBuffer.indexOf(FRAME_HEADER);
      if (headerIdx === -1) {
        const text = this.rxBuffer.toString('utf-8');
        if (text.includes('READY')) this.onStatus('ESP32 就绪');
        this.rxBuffer = Buffer.alloc(0);
        return;
      }

      if (headerIdx > 0) this.rxBuffer = this.rxBuffer.subarray(headerIdx);
      if (this.rxBuffer.length < 6) return;

      const type = this.rxBuffer[1];
      const dataLen = (this.rxBuffer[2] << 8) | this.rxBuffer[3];
      const totalLen = 4 + dataLen + 1;
      if (this.rxBuffer.length < totalLen) return;

      const footer = this.rxBuffer[totalLen - 1];
      if (footer !== FRAME_FOOTER) {
        this.rxBuffer = this.rxBuffer.subarray(1);
        continue;
      }

      const payload = this.rxBuffer.subarray(4, 4 + dataLen);

      if (type === FRAME_TYPE_MIC_AUDIO) {
        this.handleMicAudio(payload);
      } else if (type === FRAME_TYPE_COMMAND && dataLen >= 1 && payload[0] === CMD_PONG) {
        this.onStatus('ESP32 PONG');
      }

      this.rxBuffer = this.rxBuffer.subarray(totalLen);
    }
  }

  // ========== 麦克风音频 + VAD ==========
  handleMicAudio(pcmData) {
    if (!this.captureEnabled || this.isSpeaking) return;

    const level = this.calcAudioLevel(pcmData);
    this.onAudioLevel(level);

    if (this.recordingSpeech) {
      this.speechBuffer.push(pcmData);
    } else if (level > 15) {
      this.recordingSpeech = true;
      this.vadSilenceCount = 0;
      this.speechBuffer = [pcmData];
      this.onStatus('🎤 检测到语音...');
    }

    if (this.recordingSpeech) {
      if (level < 10) {
        this.vadSilenceCount++;
        if (this.vadSilenceCount > 45) {
          this.finishSpeechCapture();
        }
      } else {
        this.vadSilenceCount = 0;
      }
    }
  }

  async finishSpeechCapture() {
    if (!this.recordingSpeech || this.speechBuffer.length === 0) return;
    this.recordingSpeech = false;
    this.vadSilenceCount = 0;

    const fullAudio = Buffer.concat(this.speechBuffer);
    this.speechBuffer = [];
    this.onStatus(`语音采集完成 (${(fullAudio.length / 1024).toFixed(1)}KB)`);

    try {
      // 1. STT
      let text = '';
      if (this.sttCallback) {
        text = await this.sttCallback(fullAudio);
      }
      if (!text || text.trim().length === 0) {
        this.onStatus('未识别到语音');
        return;
      }
      this.onStatus(`识别: ${text}`);
      this.emit('userSpeech', text);

      // 2. Coze AI
      let response = '';
      if (this.cozeCallback) {
        response = await this.cozeCallback(text);
      }
      if (!response) return;
      this.emit('aiResponse', response);

      // 3. TTS → 扬声器
      if (this.ttsCallback) {
        this.isSpeaking = true;
        const audioData = await this.ttsCallback(response);
        await this.sendSpeakerAudio(audioData);
        this.isSpeaking = false;
      }
    } catch (e) {
      this.onStatus(`处理错误: ${e.message}`);
      this.emit('error', e);
    }
  }

  // ========== 发送扬声器音频 ==========
  async sendSpeakerAudio(pcmData) {
    return new Promise((resolve) => {
      if (!this.port || !this.port.isOpen) { resolve(); return; }

      const CHUNK = 1024;
      let offset = 0;

      const sendNext = () => {
        if (offset >= pcmData.length) { resolve(); return; }

        const chunk = pcmData.subarray(offset, offset + CHUNK);
        offset += CHUNK;

        const frame = Buffer.alloc(4 + chunk.length + 1);
        frame[0] = FRAME_HEADER;
        frame[1] = FRAME_TYPE_SPK_AUDIO;
        frame[2] = (chunk.length >> 8) & 0xFF;
        frame[3] = chunk.length & 0xFF;
        chunk.copy(frame, 4);
        frame[frame.length - 1] = FRAME_FOOTER;

        this.port.write(frame);
        // 模拟实时播放速率
        const playTimeMs = (chunk.length / 32000) * 1000;
        setTimeout(sendNext, playTimeMs * 0.9);
      };

      this.port.drain(() => sendNext());
    });
  }

  // ========== 命令 ==========
  sendCommand(cmd) {
    if (!this.port || !this.port.isOpen) return;
    const frame = Buffer.from([FRAME_HEADER, FRAME_TYPE_COMMAND, 0, 1, cmd, FRAME_FOOTER]);
    this.port.write(frame);
  }

  startCapture() { this.captureEnabled = true; this.sendCommand(CMD_START_CAPTURE); }
  stopCapture() { this.captureEnabled = false; this.sendCommand(CMD_STOP_CAPTURE); }

  // ========== 文字直接对话 (测试用) ==========
  async sendText(text) {
    if (this.cozeCallback) {
      this.emit('userSpeech', text);
      const response = await this.cozeCallback(text);
      this.emit('aiResponse', response);
      return response;
    }
    return '';
  }

  // ========== 工具 ==========
  calcAudioLevel(pcm16Buffer) {
    let sum = 0;
    const samples = Math.min(pcm16Buffer.length / 2, 200);
    for (let i = 0; i < pcm16Buffer.length - 1 && i / 2 < samples; i += 2) {
      sum += Math.abs(pcm16Buffer.readInt16LE(i));
    }
    return Math.min(100, (sum / samples / 32768) * 200);
  }

  isConnected() { return this.connected; }

  static async listPorts() {
    try {
      const ports = await SerialPort.list();
      return ports.map(p => ({ path: p.path, manufacturer: p.manufacturer }));
    } catch { return []; }
  }
}
