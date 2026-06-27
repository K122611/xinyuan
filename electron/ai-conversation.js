/**
 * AI Conversation Engine
 * 
 * 管道:
 *   ChatPage 文字 → TTS(SAPI) → PCM → Opus编码 → WebSocket → 设备喇叭
 * 
 * 未来扩展:
 *   设备音频 → VAD → STT → Coze AI → TTS → Opus → 设备喇叭
 */

import { EventEmitter } from 'events';
import { createRequire } from 'module';

// opusscript 是 CJS 模块，需要用 createRequire 加载
const require = createRequire(import.meta.url);
const OpusScript = require('opusscript');

const SAMPLE_RATE = 16000;
const FRAME_SIZE = 960; // 60ms @ 16kHz

export class AIConversation extends EventEmitter {
  /**
   * @param {import('./xiaozhi-bridge.js').XiaozhiBridge} bridge
   * @param {(text: string) => Promise<{pcm: Buffer, sampleRate: number}>} ttsFn
   */
  constructor(bridge, ttsFn) {
    super();
    this.bridge = bridge;
    this.ttsFn = ttsFn;
    this.encoder = new OpusScript(SAMPLE_RATE, 1, OpusScript.Application.AUDIO);
    this._activeSessions = new Set();
    this._speaking = new Map(); // sessionId -> abort controller
  }

  /**
   * 获取已连接的设备会话列表
   */
  getSessions() {
    const clients = this.bridge.getClients ? this.bridge.getClients() : [];
    return clients;
  }

  /**
   * 让指定设备的喇叭读出文字
   * @param {string} sessionId - 设备会话 ID
   * @param {string} text - 要朗读的文字
   * @returns {Promise<{success: boolean, framesSent: number, error?: string}>}
   */
  async speakText(sessionId, text) {
    if (!text || text.trim().length === 0) {
      return { success: false, framesSent: 0, error: 'empty text' };
    }

    const session = this.bridge.getClient
      ? this.bridge.getClient(sessionId)
      : null;
    
    if (!session) {
      return { success: false, framesSent: 0, error: `session ${sessionId} not found` };
    }

    // 如果正在朗读，先取消
    if (this._speaking.has(sessionId)) {
      this._speaking.get(sessionId)?.abort();
    }

    // 清理文本中的 Markdown 标记和特殊字符
    const cleanText = text
      .replace(/[*_~`#>\-\[\]()!|]/g, '')  // 移除 Markdown 语法
      .replace(/\*\*.*?\*\*/g, '')            // 移除加粗
      .replace(/```[\s\S]*?```/g, '')          // 移除代码块
      .replace(/`[^`]*`/g, '')                 // 移除行内代码
      .replace(/https?:\/\/\S+/g, '')          // 移除 URL
      .replace(/\n+/g, '，')                    // 换行变停顿
      .replace(/\s{2,}/g, ' ')                 // 合并空格
      .trim();

    if (!cleanText) {
      return { success: false, framesSent: 0, error: 'text empty after cleaning' };
    }

    const abortController = new AbortController();
    this._speaking.set(sessionId, abortController);

    try {
      this.emit('status', { sessionId, phase: 'tts', text: cleanText.slice(0, 50) + '...' });

      // Step 1: TTS → PCM
      const startTime = Date.now();
      const { pcm, sampleRate } = await this.ttsFn(cleanText);
      const ttsTime = Date.now() - startTime;

      if (abortController.signal.aborted) {
        return { success: false, framesSent: 0, error: 'aborted' };
      }

      if (!pcm || pcm.length === 0) {
        return { success: false, framesSent: 0, error: 'TTS produced empty PCM' };
      }

      // 如果采样率不是 16kHz，需要重采样（SAPI 已强制 16kHz，此处做防御）
      let pcm16k = pcm;
      if (sampleRate !== SAMPLE_RATE) {
        pcm16k = this._resample(pcm, sampleRate, SAMPLE_RATE);
      }

      // 确保是 16-bit 格式
      // pcm 是 Buffer 类型，每个样本 2 字节

      this.emit('status', { 
        sessionId, 
        phase: 'encoding', 
        details: `PCM ${pcm16k.length} bytes, TTS took ${ttsTime}ms` 
      });

      // Step 2: PCM → Opus (60ms 帧)
      const frames = this._pcmToOpusFrames(pcm16k);
      
      if (frames.length === 0) {
        return { success: false, framesSent: 0, error: 'no Opus frames generated' };
      }

      this.emit('status', { 
        sessionId, 
        phase: 'sending', 
        details: `${frames.length} Opus frames` 
      });

      // Step 3: 逐帧发送到设备
      // 先发送 TTS start 让设备从"聆听"切换到"说话"状态
      this._sendDeviceJson(sessionId, { type: 'tts', state: 'start' });
      console.log(`[AI对话] 🔬 TTS start 已发送 → deviceId=${sessionId}`);

      let sent = 0;
      const frameInterval = 60; // 60ms 间隔（匹配帧时长）

      for (let i = 0; i < frames.length; i++) {
        if (abortController.signal.aborted) break;

        this.bridge.sendOpus(sessionId, frames[i]);
        sent++;

        // 等待帧时长再发下一帧（流控，避免设备缓冲区溢出）
        if (i < frames.length - 1) {
          await this._sleep(frameInterval);
        }
      }

      // 发送 TTS stop
      this._sendDeviceJson(sessionId, { type: 'tts', state: 'stop' });
      console.log(`[AI对话] 🔬 TTS stop 已发送`);

      this.emit('status', { 
        sessionId, 
        phase: 'done', 
        details: `Sent ${sent}/${frames.length} frames, total ${Date.now() - startTime}ms` 
      });

      return { success: true, framesSent: sent };
    } catch (err) {
      this.emit('status', { sessionId, phase: 'error', error: err.message });
      return { success: false, framesSent: 0, error: err.message };
    } finally {
      this._speaking.delete(sessionId);
    }
  }

  /**
   * PCM → Opus 帧（60ms 每帧）
   *
   * 注意：Electron 的 Buffer.subarray().buffer 有兼容性问题，
   * new Int16Array(buf.buffer, buf.byteOffset) 可能读到全零。
   * 因此先用 readInt16LE 逐样本读到独立 Int16Array，再分帧编码。
   */
  _pcmToOpusFrames(pcmBuffer) {
    const totalSamples = Math.floor(pcmBuffer.length / 2);
    if (totalSamples === 0) return [];

    // 🔧 用高阶 readInt16LE 逐样本读取，避免 Electron Buffer ArrayBuffer bug
    const pcmInt16 = new Int16Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      pcmInt16[i] = pcmBuffer.readInt16LE(i * 2);
    }

    // 🔬 诊断：打印前 16 个样本
    const diagSamples = Array.from(pcmInt16.slice(0, Math.min(16, totalSamples)));
    const hasSignal = diagSamples.some(s => s !== 0);
    console.log(`[AI对话] 🔬 PCM Int16 前 ${diagSamples.length} 样本: [${diagSamples.join(',')}] 有信号=${hasSignal}`);

    const frames = [];
    const frameBytes = FRAME_SIZE * 2; // 960 samples * 2 bytes = 1920 bytes
    const remainder = totalSamples % FRAME_SIZE;
    const fullFrames = Math.floor(totalSamples / FRAME_SIZE);

    for (let f = 0; f < fullFrames; f++) {
      const sampleOffset = f * FRAME_SIZE;
      const int16 = pcmInt16.subarray(sampleOffset, sampleOffset + FRAME_SIZE);
      try {
        const opusFrame = this.encoder.encode(int16, FRAME_SIZE);
        frames.push(Buffer.from(opusFrame));
      } catch (err) {
        console.warn('[AI] Opus encode error:', err.message);
      }
    }

    // 最后不足一帧的用静音填充
    if (remainder > 0) {
      const lastInt16 = new Int16Array(FRAME_SIZE);
      pcmInt16.set(pcmInt16.subarray(fullFrames * FRAME_SIZE), 0);
      try {
        const opusFrame = this.encoder.encode(lastInt16, FRAME_SIZE);
        frames.push(Buffer.from(opusFrame));
      } catch { /* ignore */ }
    }

    // 🔬 诊断：第一帧 Opus 数据
    if (frames.length > 0) {
      console.log(`[AI对话] 🔬 第一帧 Opus (${frames[0].length}B): ${frames[0].toString('hex').slice(0, 40)}...`);
    }

    return frames;
  }

  /**
   * 简单线性重采样（质量一般，但可接受用于语音）
   * 仅在 SAPI 输出非 16kHz 时使用
   */
  _resample(pcmBuffer, fromRate, toRate) {
    if (fromRate === toRate) return pcmBuffer;

    const ratio = fromRate / toRate;
    const inputSamples = pcmBuffer.length / 2; // 16-bit
    const outputSamples = Math.floor(inputSamples / ratio);
    const output = Buffer.alloc(outputSamples * 2);

    for (let i = 0; i < outputSamples; i++) {
      const srcIndex = i * ratio;
      const srcFloor = Math.floor(srcIndex);

      if (srcFloor + 1 < inputSamples) {
        const frac = srcIndex - srcFloor;
        const s1 = pcmBuffer.readInt16LE(srcFloor * 2);
        const s2 = pcmBuffer.readInt16LE((srcFloor + 1) * 2);
        const interp = Math.round(s1 + (s2 - s1) * frac);
        output.writeInt16LE(Math.max(-32768, Math.min(32767, interp)), i * 2);
      } else {
        output.writeInt16LE(pcmBuffer.readInt16LE(srcFloor * 2), i * 2);
      }
    }

    return output;
  }

  /**
   * 发送 JSON 消息到设备（通过 xiaozhi-bridge）
   */
  _sendDeviceJson(deviceId, jsonMsg) {
    this.bridge.sendJson(deviceId, jsonMsg);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
