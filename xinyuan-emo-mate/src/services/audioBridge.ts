/**
 * PC 端串口音频桥接模块
 * 
 * 职责：
 * 1. 连接 ESP32 串口 (COM5)
 * 2. 接收麦克风 PCM 音频 → STT 转文字 → Coze AI → TTS 转语音 → 发回 ESP32
 * 3. 管理对话状态，和心元应用共享 Coze 会话
 */

import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

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

export interface AudioBridgeOptions {
  portName?: string;     // 默认 COM5
  baudRate?: number;     // 默认 921600
  sampleRate?: number;   // 默认 16000
  onStatus?: (status: string) => void;
  onAudioLevel?: (level: number) => void;
  // Coze 回调
  onCozeStream?: (token: string) => void;
  onCozeComplete?: (fullText: string) => void;
  // TTS 回调
  onTtsStart?: () => void;
  onTtsEnd?: () => void;
}

export class AudioSerialBridge extends EventEmitter {
  private port: SerialPort | null = null;
  private options: Required<AudioBridgeOptions>;
  private rxBuffer: Buffer = Buffer.alloc(0);
  private captureEnabled = true;
  private connected = false;
  private audioBuffer: Buffer[] = [];
  private isSpeaking = false;
  private vadSilenceCount = 0;
  private speechBuffer: Buffer[] = [];
  private recordingSpeech = false;

  // 音频参数
  private readonly sampleRate: number;
  private readonly bytesPerSample = 2; // 16bit
  private readonly channels = 1;

  // 回调
  private sttCallback: ((audio: Buffer) => Promise<string>) | null = null;
  private cozeCallback: ((text: string) => Promise<string>) | null = null;
  private ttsCallback: ((text: string) => Promise<Buffer>) | null = null;

  constructor(options: AudioBridgeOptions = {}) {
    super();
    this.options = {
      portName: options.portName || 'COM5',
      baudRate: options.baudRate || 921600,
      sampleRate: options.sampleRate || 16000,
      onStatus: options.onStatus || (() => {}),
      onAudioLevel: options.onAudioLevel || (() => {}),
      onCozeStream: options.onCozeStream || (() => {}),
      onCozeComplete: options.onCozeComplete || (() => {}),
      onTtsStart: options.onTtsStart || (() => {}),
      onTtsEnd: options.onTtsEnd || (() => {}),
    };
    this.sampleRate = this.options.sampleRate;
  }

  // ========== 外部回调设置 ==========
  setSttCallback(cb: (audio: Buffer) => Promise<string>) {
    this.sttCallback = cb;
  }

  setCozeCallback(cb: (text: string) => Promise<string>) {
    this.cozeCallback = cb;
  }

  setTtsCallback(cb: (text: string) => Promise<Buffer>) {
    this.ttsCallback = cb;
  }

  // ========== 连接管理 ==========
  async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.options.onStatus(`正在连接 ${this.options.portName}...`);
        this.port = new SerialPort({
          path: this.options.portName,
          baudRate: this.options.baudRate,
          autoOpen: false,
        });

        this.port.open((err) => {
          if (err) {
            this.options.onStatus(`串口打开失败: ${err.message}`);
            this.emit('error', err);
            resolve(false);
            return;
          }

          this.connected = true;
          this.options.onStatus(`已连接 ESP32 @ ${this.options.portName}`);

          // 数据接收
          this.port!.on('data', (data: Buffer) => {
            this.handleRxData(data);
          });

          this.port!.on('close', () => {
            this.connected = false;
            this.options.onStatus('串口已断开');
            this.emit('disconnected');
          });

          this.port!.on('error', (err) => {
            this.options.onStatus(`串口错误: ${err.message}`);
            this.emit('error', err);
          });

          // 设置 DTR/RTS 防止 ESP32 重启
          this.port!.set({ dtr: false, rts: false });

          // 等待 ESP32 就绪
          setTimeout(() => {
            this.sendCommand(CMD_PING);
            this.options.onStatus('ESP32 音频桥接已就绪');
            this.emit('connected');
            resolve(true);
          }, 1000);
        });
      } catch (e: any) {
        this.options.onStatus(`连接失败: ${e.message}`);
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

  // ========== 数据接收处理 ==========
  private handleRxData(data: Buffer) {
    this.rxBuffer = Buffer.concat([this.rxBuffer, data]);

    while (this.rxBuffer.length >= 6) {
      // 找帧头
      const headerIdx = this.rxBuffer.indexOf(FRAME_HEADER);
      if (headerIdx === -1) {
        // 检查是否有文本输出（如 READY, ERR, STAT）
        const text = this.rxBuffer.toString('utf-8');
        if (text.includes('READY')) {
          this.options.onStatus('ESP32 报告就绪');
        } else if (text.includes('ERR')) {
          const errLine = text.split('\n').find((l) => l.startsWith('ERR'));
          if (errLine) {
            this.options.onStatus(`ESP32 错误: ${errLine}`);
          }
        }
        this.rxBuffer = Buffer.alloc(0);
        return;
      }

      if (headerIdx > 0) {
        this.rxBuffer = this.rxBuffer.subarray(headerIdx);
      }

      if (this.rxBuffer.length < 6) return; // 需要至少 header(4) + 至少1字节数据 + footer(1)

      const type = this.rxBuffer[1];
      const dataLen = (this.rxBuffer[2] << 8) | this.rxBuffer[3];
      const totalLen = 4 + dataLen + 1;

      if (this.rxBuffer.length < totalLen) return; // 数据不完整

      const footer = this.rxBuffer[totalLen - 1];
      if (footer !== FRAME_FOOTER) {
        this.rxBuffer = this.rxBuffer.subarray(1); // 帧尾不匹配，跳过
        continue;
      }

      const payload = this.rxBuffer.subarray(4, 4 + dataLen);

      if (type === FRAME_TYPE_MIC_AUDIO) {
        this.handleMicAudio(payload);
      } else if (type === FRAME_TYPE_COMMAND && dataLen >= 1) {
        const cmd = payload[0];
        if (cmd === CMD_PONG) {
          this.options.onStatus('ESP32 PONG 响应');
        }
      }

      this.rxBuffer = this.rxBuffer.subarray(totalLen);
    }
  }

  // ========== 麦克风音频处理 ==========
  private handleMicAudio(pcmData: Buffer) {
    if (!this.captureEnabled) return;

    // 计算音量级别
    const level = this.calculateAudioLevel(pcmData);
    this.options.onAudioLevel(level);

    if (this.recordingSpeech) {
      // 正在录音中，累积音频
      this.speechBuffer.push(pcmData);
    } else if (level > 15) {
      // 检测到语音，开始录音
      this.recordingSpeech = true;
      this.vadSilenceCount = 0;
      this.speechBuffer = [pcmData];
      this.options.onStatus('检测到语音，开始录音...');
    }

    if (this.recordingSpeech) {
      if (level < 10) {
        this.vadSilenceCount++;
        // 静音持续 ~1.5秒后结束语音
        if (this.vadSilenceCount > 45) {
          this.finishSpeechCapture();
        }
      } else {
        this.vadSilenceCount = 0;
      }
    }
  }

  private async finishSpeechCapture() {
    if (!this.recordingSpeech || this.speechBuffer.length === 0) return;
    this.recordingSpeech = false;
    this.vadSilenceCount = 0;

    const fullAudio = Buffer.concat(this.speechBuffer);
    this.speechBuffer = [];
    this.options.onStatus(`语音采集完成 (${(fullAudio.length / 1024).toFixed(1)}KB)`);

    // 1. STT: 语音 → 文字
    try {
      let text = '';
      if (this.sttCallback) {
        text = await this.sttCallback(fullAudio);
      } else {
        // 无 STT 回调，使用模拟（测试用）
        this.options.onStatus('⚠️ 未配置 STT 服务');
        return;
      }

      if (!text || text.trim().length === 0) {
        this.options.onStatus('未识别到语音内容');
        return;
      }

      this.options.onStatus(`识别结果: ${text}`);
      this.emit('userSpeech', text);

      // 2. Coze AI: 文字 → 回复文字
      let response = '';
      if (this.cozeCallback) {
        response = await this.cozeCallback(text);
      } else {
        this.options.onStatus('⚠️ 未配置 AI 服务');
        return;
      }

      if (!response) return;
      this.emit('aiResponse', response);

      // 3. TTS: 回复文字 → 语音
      if (this.ttsCallback) {
        this.options.onTtsStart();
        this.isSpeaking = true;
        const audioData = await this.ttsCallback(response);
        await this.sendSpeakerAudio(audioData);
        this.isSpeaking = false;
        this.options.onTtsEnd();
      }
    } catch (e: any) {
      this.options.onStatus(`处理错误: ${e.message}`);
      this.emit('error', e);
    }
  }

  // ========== 发送音频到扬声器 ==========
  async sendSpeakerAudio(pcmData: Buffer): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port || !this.port.isOpen) {
        resolve();
        return;
      }

      // 分块发送 (每块最多 1024 字节)
      const CHUNK = 1024;
      let offset = 0;
      let drained = true;

      const sendNext = () => {
        if (offset >= pcmData.length) {
          resolve();
          return;
        }

        const chunk = pcmData.subarray(offset, offset + CHUNK);
        offset += CHUNK;

        const frame = Buffer.alloc(4 + chunk.length + 1);
        frame[0] = FRAME_HEADER;
        frame[1] = FRAME_TYPE_SPK_AUDIO;
        frame[2] = (chunk.length >> 8) & 0xFF;
        frame[3] = chunk.length & 0xFF;
        chunk.copy(frame, 4);
        frame[frame.length - 1] = FRAME_FOOTER;

        drained = this.port!.write(frame);
        if (drained) {
          // 模拟实时播放速率 (16kHz 16bit mono = 32000 bytes/s)
          const playTimeMs = (chunk.length / 32000) * 1000;
          setTimeout(sendNext, playTimeMs * 0.9); // 略微加速避免断流
        }
      };

      this.port!.drain(() => {
        sendNext();
      });
    });
  }

  // ========== 命令 ==========
  sendCommand(cmd: number) {
    if (!this.port || !this.port.isOpen) return;
    const frame = Buffer.from([
      FRAME_HEADER,
      FRAME_TYPE_COMMAND,
      0x00,
      0x01,
      cmd,
      FRAME_FOOTER,
    ]);
    this.port.write(frame);
  }

  startCapture() {
    this.captureEnabled = true;
    this.sendCommand(CMD_START_CAPTURE);
  }

  stopCapture() {
    this.captureEnabled = false;
    this.sendCommand(CMD_STOP_CAPTURE);
  }

  // ========== 工具方法 ==========
  private calculateAudioLevel(pcm16Buffer: Buffer): number {
    let sum = 0;
    const samples = Math.min(pcm16Buffer.length / 2, 200);
    for (let i = 0; i < pcm16Buffer.length - 1 && i / 2 < samples; i += 2) {
      const sample = Math.abs(pcm16Buffer.readInt16LE(i));
      sum += sample;
    }
    const avg = sum / samples;
    // 映射到 0-100
    return Math.min(100, (avg / 32768) * 200);
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ========== 直接文字对话（跳过音频，用于测试/文本模式） ==========
  async sendText(text: string): Promise<string> {
    if (this.cozeCallback) {
      this.emit('userSpeech', text);
      const response = await this.cozeCallback(text);
      this.emit('aiResponse', response);
      return response;
    }
    return '';
  }

  // ========== 扫描串口 ==========
  static async listPorts(): Promise<{ path: string; manufacturer?: string }[]> {
    try {
      const ports = await SerialPort.list();
      return ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer,
      }));
    } catch {
      return [];
    }
  }
}
