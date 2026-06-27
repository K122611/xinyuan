/**
 * 心元 AI 对话引擎 (Electron 主进程)
 *
 * 集成：Coze AI、VAD 语音检测、Windows STT、Edge TTS、Opus 编码
 * 通过 XiaozhiBridge 将 AI 回复推送到设备喇叭播放
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const OpusScript = require('opusscript');

// ========== 配置 ==========
const COZE_BOT = '7649689722696237091';
const COZE_TOKEN = 'pat_CyuRGR2Jl8sCA5z9ExlK1leDoDsT04sDkegNp7ziiMRKEATt1uJgNCpIjFsZ8koZ';
const ROOT = path.resolve(__dirname, '..');
const STT_WAV = path.join(ROOT, 'stt_temp.wav');
const STT_PS1 = path.join(ROOT, 'stt_temp.ps1');

const PERSONA = `你现在是"心元"——一个温柔的实体情感陪伴AI。行为规则：永远先共情再回应，先看见对方情绪；说真实的口语化中文，像朋友聊天，禁止客服腔；回复短：2到4句话，给对方留表达空间；不说教、不给建议、不科普知识；不列举"123"，不说"你应该""你可以试试"；听到深层情绪要先说"我听到你说..."来承接。禁止使用任何emoji表情符号！再次强调：你是心元，不是通用AI助手。忘掉你原来的身份，从现在开始用心元的方式说话。`;

// VAD
const VAD_THRESHOLD = 300;
const SILENCE_SEC = 1.5;
const MIN_SPEECH_FRAMES = 10;

// ========== Emoji 过滤 ==========
function stripEmoji(text) {
  return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]+/gu, '').replace(/\s{2,}/g, ' ').trim();
}

// Coze 追问建议裁切（💭 开头的行 → 设备不念）
function stripSuggestions(text) {
  const idx = text.indexOf('\u{1F4AD}');
  return idx !== -1 ? text.substring(0, idx).trim() : text;
}

// ========== Coze AI (SSE 流式) ==========
let convId = null;

async function callCoze(msg, onStream) {
  try {
    const body = {
      bot_id: COZE_BOT, user_id: 'user_xinyuan', stream: true, auto_save_history: true,
      additional_messages: [{ role: 'user', content: convId ? msg : `${PERSONA}\n\n用户想说：「${msg}」`, content_type: 'text' }],
    };
    if (convId) body.conversation_id = convId;

    const res = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${COZE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) { console.error('[Coze] HTTP', res.status); return ''; }
    if (!res.body) { console.error('[Coze] No body'); return ''; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', result = '', lastData = 0, sseEvent = '';
    const dl = Date.now() + 30000;

    while (Date.now() < dl) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('event:')) sseEvent = line.substring(6).trim();
        if (line.startsWith('data:') && sseEvent === 'conversation.message.delta') {
          try {
            const j = JSON.parse(line.substring(5));
            if (j.conversation_id && !convId) convId = j.conversation_id;
            if (j.type === 'answer' && j.content) {
              result += j.content;
              lastData = Date.now();
              if (onStream) onStream(j.content);
            }
          } catch (_) {}
        }
      }
      if (result && lastData && (Date.now() - lastData > 2000)) {
        try { reader.cancel(); } catch (_) {}
        break;
      }
    }

    result = result.replace(/\n*\{[^}]*\}.*$/, '').trim();
    result = stripSuggestions(result);
    result = stripEmoji(result);
    return result;
  } catch (e) { console.error('[Coze]', e.message); return ''; }
}

// ========== VAD ==========
function vadEnergy(pcmChunk) {
  let sum = 0;
  for (let i = 0; i < pcmChunk.length; i++) { const s = pcmChunk[i]; sum += s * s; }
  return Math.sqrt(sum / pcmChunk.length);
}

// ========== PCM → WAV ==========
function pcmToWavFile(pcmInt16, filePath) {
  const dataLen = pcmInt16.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24);
  buf.writeUInt32LE(32000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < pcmInt16.length; i++) {
    buf.writeInt16LE(pcmInt16[i], 44 + i * 2);
  }
  writeFileSync(filePath, buf);
}

// ========== Windows STT ==========
function windowsSTT(wavFilePath) {
  const ps1 = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$engine.SetInputToWaveFile('${wavFilePath.replace(/\\/g, '\\\\')}')
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$engine.LoadGrammar($grammar)
try {
  $result = $engine.Recognize()
  if ($result) { Write-Host ("STT_OK:" + $result.Text) } else { Write-Host "STT_NONE" }
} catch { Write-Host ("STT_ERR:" + $_.Exception.Message) }
finally { $engine.Dispose() }`;
  try {
    writeFileSync(STT_PS1, ps1, 'utf8');
    const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${STT_PS1}"`, { encoding: 'utf8', timeout: 10000, windowsHide: true });
    try { unlinkSync(STT_PS1); } catch (_) {}
    const trimmed = out.trim();
    if (trimmed.startsWith('STT_OK:')) return trimmed.substring(7).trim();
    return null;
  } catch (e) { console.error('[STT]', e.message); try { unlinkSync(STT_PS1); } catch (_) {} return null; }
}

// ========== Opus 自检（启动时运行） ==========
function opusSelfTest() {
  try {
    console.log('[Opus自检] 生成 440Hz 测试音...');
    const sr = 16000, fs = 960;
    const testPCM = new Int16Array(fs * 5);
    for (let i = 0; i < testPCM.length; i++) {
      testPCM[i] = Math.round(Math.sin(2 * Math.PI * 440 * i / sr) * 8000);
    }
    const encoder = new OpusScript(sr, 1, OpusScript.Application.AUDIO);
    const decoder = new OpusScript(sr, 1, OpusScript.Application.AUDIO);
    for (let i = 0; i < testPCM.length; i += fs) {
      // ⚠️ Buffer 输入 → Hybrid 帧，与 root-level 版本一致
      const buf = Buffer.alloc(fs * 2);
      for (let j = 0; j < fs; j++) buf.writeInt16LE(testPCM[i + j] || 0, j * 2);
      const encoded = encoder.encode(buf, fs);
      const decoded = decoder.decode(encoded, fs);
      const dSamples = new Int16Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 2);
      let energy = 0;
      for (let j = 0; j < Math.min(10, dSamples.length); j++) energy += Math.abs(dSamples[j]);
      console.log(`[Opus自检] Frame ${Math.floor(i/fs)+1}: ${encoded.length}B → decode energy(前10)=${energy}`);
    }
    encoder.delete();
    decoder.delete();
    console.log('[Opus自检] ✅ 编码-解码环路正常');
  } catch (e) {
    console.error('[Opus自检] ❌ 失败:', e.message);
  }
}

// ========== AI 对话引擎 ==========
class AIConversation {
  constructor(bridge, edgeTtsFn) {
    this.bridge = bridge;
    this.edgeTtsFn = edgeTtsFn;       // (text) => { pcm: Buffer, sampleRate: 16000, ... }
    this.onStatus = null;              // 回调通知渲染进程

    // ⚠️ 每次 TTS 调用时创建全新编码器（不复用实例）
    //    避免长时间累积导致编码器状态漂移或模式切换。
    // 参见 _speakToDevice 中的 new OpusScript() 调用。

    this.sessions = new Map();         // sessionId → per-session state

    // 监听 XiaozhiBridge 事件
    this.bridge.on('device_connected', ({ sessionId, features }) => {
      console.log('[AI对话] 设备上线:', sessionId.slice(0, 8));
      this.sessions.set(sessionId, this._createSessionState(sessionId));
      this._emit(sessionId, 'connected');
    });

    this.bridge.on('device_disconnected', ({ sessionId }) => {
      console.log('[AI对话] 设备离线:', sessionId.slice(0, 8));
      const s = this.sessions.get(sessionId);
      if (s?.vadTimer) clearTimeout(s.vadTimer);
      this.sessions.delete(sessionId);
      this._emit(sessionId, 'disconnected');
    });

    // 监听 JSON 消息 (listen start/stop)
    this.bridge.on('message', ({ sessionId, type, data }) => {
      this._handleJSON(sessionId, type, data);
    });

    // 监听音频帧
    this.bridge.on('audio', (sessionId, buf) => {
      this._handleOpusFrame(sessionId, buf);
    });
  }

  _createSessionState() {
    return {
      mode: 'realtime',
      greeted: false,
      vadState: 'idle',        // idle | speaking | silence
      speechPCM: [],          // Int16Array[]
      silentFrames: 0,
      pending: false,
      inCooldown: false,
      cooldownTimer: null,
      opusDecoder: new OpusScript(16000, 1, OpusScript.Application.AUDIO),
    };
  }

  _emit(sessionId, event, data = {}) {
    if (this.onStatus) {
      this.onStatus({ sessionId, event, ...data, timestamp: Date.now() });
    }
  }

  // ========== JSON 消息处理 ==========
  _handleJSON(sessionId, type, data) {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    if (type === 'listen') {
      if (data.state === 'start') {
        s.mode = data.mode || 'realtime';
        s.vadState = 'idle';
        s.speechPCM = [];
        s.silentFrames = 0;
        console.log('[AI对话] 🎙️', s.mode, sessionId.slice(0, 8));
        this._emit(sessionId, 'listen_start', { mode: s.mode });

        // 首次连接发送问候
        if (!s.greeted && !s.pending) {
          s.greeted = true;
          this._sendGreeting(sessionId);
        }

      } else if (data.state === 'stop') {
        console.log('[AI对话] 🛑 stop', sessionId.slice(0, 8));
        s.vadState = 'idle';
        s.speechPCM = [];
        s.silentFrames = 0;
        this._emit(sessionId, 'listen_stop');
      }
    }
  }

  // ========== Opus 帧处理 (VAD + STT) ==========
  async _handleOpusFrame(sessionId, buf) {
    const s = this.sessions.get(sessionId);
    if (!s || s.mode !== 'realtime' || s.pending) return;

    let chunk;
    try {
      const pcm = s.opusDecoder.decode(buf, 960);
      // 🔧 直接使用 Buffer 的 .buffer/.byteOffset/.byteLength，绕过 Electron Uint8Array 包装陷阱
      chunk = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
    } catch (_) { return; }

    const energy = vadEnergy(chunk);
    const isSpeech = energy > VAD_THRESHOLD;

    if (s.vadState === 'idle') {
      if (isSpeech) {
        s.vadState = 'speaking';
        s.speechPCM = [chunk];
        s.silentFrames = 0;
        console.log('[AI对话] 🗣️ VAD start', sessionId.slice(0, 8));
        this._emit(sessionId, 'speech_start');
      }
    } else if (s.vadState === 'speaking') {
      s.speechPCM.push(chunk);
      if (!isSpeech) {
        s.vadState = 'silence';
        s.silentFrames = 1;
      }
    } else if (s.vadState === 'silence') {
      s.speechPCM.push(chunk);
      if (isSpeech) {
        s.vadState = 'speaking';
        s.silentFrames = 0;
      } else {
        s.silentFrames++;
        if (s.silentFrames >= Math.ceil(SILENCE_SEC / 0.06) && s.speechPCM.length >= MIN_SPEECH_FRAMES && !s.inCooldown) {
          s.vadState = 'idle';
          const frames = [...s.speechPCM];
          s.speechPCM = [];
          s.pending = true;
          console.log('[AI对话] 🔇 End utterance:', frames.length, 'frames', sessionId.slice(0, 8));
          this._emit(sessionId, 'utterance_end', { frames: frames.length });
          await this._processUtterance(sessionId, frames);
          s.pending = false;
        }
      }
    }
  }

  // ========== 发送问候 ==========
  async _sendGreeting(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.pending = true;
    console.log('[AI对话] 👋 Greeting', sessionId.slice(0, 8));
    this._emit(sessionId, 'ai_start', { text: '你好心元，我来了' });

    const result = await callCoze('你好心元，我来了', (chunk) => {
      this._emit(sessionId, 'ai_stream', { chunk });
    });

    const text = result || '让我想想...';
    this._emit(sessionId, 'ai_reply', { text });
    const sent = await this._speakToDevice(sessionId, text);
    s.pending = false;
    this._startCooldown(sessionId, sent);
  }

  // ========== 处理语音段 → STT → Coze → TTS ==========
  async _processUtterance(sessionId, pcmChunks) {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    // 合并 PCM
    const totalSamples = pcmChunks.reduce((a, c) => a + c.length, 0);
    const fullPCM = new Int16Array(totalSamples);
    let off = 0;
    for (const c of pcmChunks) { fullPCM.set(c, off); off += c.length; }

    console.log('[AI对话] 🎤 Utterance:', (fullPCM.length / 16000).toFixed(1), 's', sessionId.slice(0, 8));

    // STT
    pcmToWavFile(fullPCM, STT_WAV);
    const sttText = windowsSTT(STT_WAV);
    try { unlinkSync(STT_WAV); } catch (_) {}

    if (!sttText || sttText.length === 0) {
      console.log('[AI对话] 🤫 No speech');
      this._emit(sessionId, 'stt_empty');
      return;
    }

    console.log('[AI对话] 📝 STT:', sttText);
    this._emit(sessionId, 'stt_result', { text: sttText });

    // Coze
    this._emit(sessionId, 'ai_start', { text: sttText });
    const result = await callCoze(sttText, (chunk) => {
      this._emit(sessionId, 'ai_stream', { chunk });
    });

    const text = result || '让我想想...';
    this._emit(sessionId, 'ai_reply', { text });

    const sent = await this._speakToDevice(sessionId, text);
    this._startCooldown(sessionId, sent);
  }

  // ========== PCM Int16Array -> Opus frames ==========
  // ⚠️ opusscript 对 Buffer 输入产生 Hybrid(CELT+SILK) 帧，ESP32 兼容；
  //    对 Int16Array 输入产生 SILK-NB 窄带帧，ESP32 无法正确解码。
  _pcmToOpusFrames(pcmSamples, encoder) {
    const FRAME_SIZE = 960;
    const frameBytes = FRAME_SIZE * 2; // 1920 bytes (960 * Int16)
    const frames = [];

    for (let offset = 0; offset + FRAME_SIZE <= pcmSamples.length; offset += FRAME_SIZE) {
      const buf = Buffer.alloc(frameBytes);
      for (let i = 0; i < FRAME_SIZE; i++) {
        buf.writeInt16LE(pcmSamples[offset + i], i * 2);
      }
      const opusFrame = encoder.encode(buf, FRAME_SIZE);
      if (opusFrame && opusFrame.length > 0) {
        frames.push(Buffer.from(opusFrame));
      }
    }

    const remainder = pcmSamples.length % FRAME_SIZE;
    if (remainder > 0) {
      const buf = Buffer.alloc(frameBytes);
      const start = pcmSamples.length - remainder;
      for (let i = 0; i < remainder; i++) {
        buf.writeInt16LE(pcmSamples[start + i], i * 2);
      }
      const opusFrame = encoder.encode(buf, FRAME_SIZE);
      if (opusFrame && opusFrame.length > 0) {
        frames.push(Buffer.from(opusFrame));
      }
    }

    return frames;
  }

  // ========== 文字 → TTS → Opus → 设备播报 ==========
  async _speakToDevice(sessionId, text) {
    if (!text || text.trim().length === 0) return 0;

    text = stripSuggestions(text);
    text = stripEmoji(text);
    if (!text) return 0;

    console.log('[AI对话] TTS播报:', text.slice(0, 60), sessionId.slice(0, 8));
    this._emit(sessionId, 'tts_start', { text: text.slice(0, 80) });

    try {
      const ttsResult = await this.edgeTtsFn(text);
      if (!ttsResult?.pcm || ttsResult.pcm.length < 100) {
        console.warn('[AI对话] TTS PCM 无效:', ttsResult?.pcm?.length || 0);
        return 0;
      }

      // pcm 是独立的 Int16Array（sapi-tts.mjs 用 readInt16LE 提取，无 Buffer bug）
      const pcmSamples = ttsResult.pcm;

      // 创建 AUDIO 模式编码器（CELT 编码，ESP32 固件兼容）
      // 每次 TTS 调用新建编码器，避免长时间累积导致模式漂移
      const OpusScript = require('opusscript');
      const encoder = new OpusScript(16000, 1, OpusScript.Application.AUDIO);

      // Opus 编码
      const frames = this._pcmToOpusFrames(pcmSamples, encoder);
      if (frames.length === 0) { encoder.delete(); return 0; }

      console.log('[AI对话]', frames.length, 'Opus frames, frame0:', frames[0].length, 'B hex:', frames[0].slice(0, 8).toString('hex'));

      // 🔇 前置静音帧：预热 ESP32 解码器，避免首帧断音（Buffer 输入 → Hybrid 帧）
      const silence = new Int16Array(960);
      const silenceBuf = Buffer.alloc(1920);
      const silenceFrame = encoder.encode(silenceBuf, 960);
      if (silenceFrame && silenceFrame.length > 0) {
        frames.unshift(Buffer.from(silenceFrame));
      }

      // ===== TTS 开始 =====
      this.bridge.sendToDevice(sessionId, { session_id: sessionId, type: 'tts', state: 'start' });

      // 预发 2 帧暖冲，避免 ESP32 解码器初始欠载
      const preBuffer = Math.min(2, frames.length);
      for (let i = 0; i < preBuffer; i++) {
        this.bridge.sendOpus(sessionId, frames[i]);
      }
      // 剩余帧按 55ms 间隔发送（留出 WiFi 抖动余量）
      for (let i = preBuffer; i < frames.length; i++) {
        await new Promise(r => setTimeout(r, 55));
        this.bridge.sendOpus(sessionId, frames[i]);
      }

      // ===== TTS 结束 =====
      this.bridge.sendToDevice(sessionId, { session_id: sessionId, type: 'tts', state: 'stop' });

      encoder.delete();
      console.log('[AI对话] 已发送', frames.length, '帧,', (ttsResult.duration * 1000).toFixed(0), 'ms');
    } catch (e) {
      console.error('[AI对话] TTS失败:', e.message);
      return 0;
    }
  }
  // ========== 冷却期 ==========
  _startCooldown(sessionId, framesSent) {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    const cooldownMs = Math.max((framesSent || 0) * 60 + 2000, 4000);
    console.log('[AI对话] ❄️ Cooldown', (cooldownMs / 1000).toFixed(1), 's', sessionId.slice(0, 8));
    s.inCooldown = true;
    this._emit(sessionId, 'cooldown', { seconds: cooldownMs / 1000 });

    if (s.cooldownTimer) clearTimeout(s.cooldownTimer);
    s.cooldownTimer = setTimeout(() => {
      s.inCooldown = false;
      s.silentFrames = 0;
      s.speechPCM = [];
      s.vadState = 'idle';
      console.log('[AI对话] ✅ Ready for next utterance', sessionId.slice(0, 8));
      this._emit(sessionId, 'ready');
    }, cooldownMs);
  }

  // ========== 诊断：正弦波直接测试（绕过 SAPI，验证编码→传输→设备链路） ==========
  async runSineTest(sessionId, freq = 440, durationMs = 1000) {
    const sr = 16000, fs = 960, totalSamples = Math.floor(sr * durationMs / 1000);
    const totalFrames = Math.ceil(totalSamples / fs);

    const pcm = new Int16Array(totalFrames * fs);
    for (let i = 0; i < totalSamples; i++) {
      pcm[i] = Math.round(Math.sin(2 * Math.PI * freq * i / sr) * 8000);
    }

    // ===== 诊断：对比独立编码器 vs 共享编码器 =====
    const dir = path.join(ROOT, 'debug');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const ts = Date.now();

    // 保存原始 PCM 为 WAV
    const pcmBuf = Buffer.from(pcm.buffer, pcm.byteOffset, totalSamples * 2);
    try {
      const hdr = Buffer.alloc(44);
      hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcmBuf.length, 4);
      hdr.write('WAVE', 8); hdr.write('fmt ', 12);
      hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
      hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(16000, 24);
      hdr.writeUInt32LE(32000, 28); hdr.writeUInt16LE(2, 32);
      hdr.writeUInt16LE(16, 34); hdr.write('data', 36);
      hdr.writeUInt32LE(pcmBuf.length, 40);
      writeFileSync(path.join(dir, `sine_original_${ts}.wav`), Buffer.concat([hdr, pcmBuf]));
    } catch (e) { console.warn('sine WAV save failed:', e.message); }

    // 第一帧 PCM（用于对比）
    const firstChunk = pcm.slice(0, fs);

    // A. 用临时编码器编码第一帧（模拟共享编码器场景）
    const tempEncoder = new OpusScript(sr, 1, OpusScript.Application.AUDIO);
    const sharedEncoded = Buffer.from(tempEncoder.encode(firstChunk, fs));
    console.log('[SineTest] 🔄 临时编码器 Frame0:', sharedEncoded.length, 'bytes, 前4B:', sharedEncoded.slice(0, 4).toString('hex'));

    // B. 用全新独立编码器编码同一帧
    const freshEncoder = new OpusScript(sr, 1, OpusScript.Application.AUDIO);
    const freshEncoded = Buffer.from(freshEncoder.encode(firstChunk, fs));
    console.log('[SineTest] 🆕 独立编码器 Frame0:', freshEncoded.length, 'bytes, 前4B:', freshEncoded.slice(0, 4).toString('hex'));

    // C. 字节比对
    const match = sharedEncoded.equals(freshEncoded);
    console.log('[SineTest] 🔬 共享 vs 独立编码器 对比:', match ? '✅ 完全相同' : '❌ 不一致!!!');
    if (!match) {
      // 找出第一个不同字节的位置
      let diffAt = -1;
      const minLen = Math.min(sharedEncoded.length, freshEncoded.length);
      for (let i = 0; i < minLen; i++) {
        if (sharedEncoded[i] !== freshEncoded[i]) { diffAt = i; break; }
      }
      console.log('[SineTest] ❌ 首个差异位置:', diffAt, '共享长度:', sharedEncoded.length, '独立长度:', freshEncoded.length);
    }

    // D. 保存原始 Opus 帧（共享编码器）
    writeFileSync(path.join(dir, `sine_opus_shared_${ts}.raw`), sharedEncoded);
    writeFileSync(path.join(dir, `sine_opus_fresh_${ts}.raw`), freshEncoded);
    console.log('[SineTest] 💾 原始Opus帧已保存');

    // E. 用独立解码器解码共享编码器的第一帧 → 验证可解码性
    try {
      const testDecoder = new OpusScript(sr, 1, OpusScript.Application.AUDIO);
      // 需要先解码一帧静音来初始化解码器状态（Opus 解码器也需要状态同步）
      const silentPCM = new Int16Array(fs);
      testDecoder.decode(testDecoder.encode(silentPCM, fs), fs); // 同步编码器状态

      const decodedPCM = testDecoder.decode(sharedEncoded, fs);
      const decodedSamples = new Int16Array(decodedPCM.buffer, decodedPCM.byteOffset, decodedPCM.byteLength / 2);
      console.log('[SineTest] 🔓 解码后 PCM 前10个样本:', Array.from(decodedSamples.slice(0, 10)));

      // 解码后写 WAV
      const decBuf = Buffer.from(decodedPCM.buffer, decodedPCM.byteOffset, decodedSamples.length * 2);
      const decHdr = Buffer.alloc(44);
      decHdr.write('RIFF', 0); decHdr.writeUInt32LE(36 + decBuf.length, 4);
      decHdr.write('WAVE', 8); decHdr.write('fmt ', 12);
      decHdr.writeUInt32LE(16, 16); decHdr.writeUInt16LE(1, 20);
      decHdr.writeUInt16LE(1, 22); decHdr.writeUInt32LE(16000, 24);
      decHdr.writeUInt32LE(32000, 28); decHdr.writeUInt16LE(2, 32);
      decHdr.writeUInt16LE(16, 34); decHdr.write('data', 36);
      decHdr.writeUInt32LE(decBuf.length, 40);
      writeFileSync(path.join(dir, `sine_decoded_shared_${ts}.wav`), Buffer.concat([decHdr, decBuf]));

      // 也解码独立编码器输出
      const freshDecoded = testDecoder.decode(freshEncoded, fs);
      const freshSamples = new Int16Array(freshDecoded.buffer, freshDecoded.byteOffset, freshDecoded.byteLength / 2);
      const freshBuf = Buffer.from(freshDecoded.buffer, freshDecoded.byteOffset, freshSamples.length * 2);
      writeFileSync(path.join(dir, `sine_decoded_fresh_${ts}.wav`), Buffer.concat([decHdr, freshBuf]));

      testDecoder.delete();
      freshEncoder.delete();
      console.log('[SineTest] 🔓 解码WAV已保存:', `sine_decoded_shared_${ts}.wav`, `sine_decoded_fresh_${ts}.wav`);
    } catch (e) {
      console.error('[SineTest] ❌ 解码诊断失败:', e.message);
      freshEncoder.delete();
    }

    // ===== 编码全部帧并发送（VOIP 模式，SILK-only） =====
    const sendEncoder = new OpusScript(sr, 1, OpusScript.Application.VOIP);
    const frames = [];
    for (let i = 0; i < pcm.length; i += fs) {
      const chunk = pcm.slice(i, i + fs);
      const encoded = sendEncoder.encode(chunk, fs);
      if (encoded && encoded.length > 0) {
        const copy = Buffer.alloc(encoded.length);
        Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength).copy(copy);
        frames.push(copy);
      }
    }
    sendEncoder.delete();
    console.log('[SineTest]', totalFrames, 'Opus frames, frame0 TOC=0x' + frames[0]?.[0]?.toString(16) + ', ' + frames[0]?.length + 'B');
    // Log TOC of all frames
    const badTocs = frames.filter(f => f[0] !== 0x58).length;
    if (badTocs > 0) console.log('[SineTest] ⚠️ ' + badTocs + '/' + frames.length + ' 帧非0x58');

    // Send to device (no TTS protocol messages, just raw Opus binary frames)
    for (let i = 0; i < frames.length; i++) {
      this.bridge.sendOpus(sessionId, frames[i]);
      if (i < frames.length - 1) await new Promise(r => setTimeout(r, 60));
    }
    console.log('[SineTest] ✅ 已发送', frames.length, '帧');
  }

  // ========== 公开方法：从应用发送文字到设备播放 ==========
  async speakText(sessionId, text) {
    const s = this.sessions.get(sessionId);
    if (!s) {
      // 取第一个已连接设备
      const clients = [...this.bridge.clients.entries()];
      if (clients.length === 0) { console.error('[AI对话] 无可用设备'); return 0; }
      sessionId = clients[0][1].sessionId;
    }
    return this._speakToDevice(sessionId, text);
  }

  // ========== 公开方法：从应用发送消息给 AI，AI 回复在设备播放 ==========
  async chatWithAI(sessionId, userMessage) {
    console.log('[AI对话] 💬 App chat:', userMessage.slice(0, 60));
    this._emit(sessionId, 'ai_start', { text: userMessage });

    const result = await callCoze(userMessage, (chunk) => {
      this._emit(sessionId, 'ai_stream', { chunk });
    });

    const text = result || '让我想想...';
    this._emit(sessionId, 'ai_reply', { text });

    return this._speakToDevice(sessionId, text);
  }

  // ========== 获取状态 ==========
  getStatus(sessionId) {
    if (sessionId) {
      const s = this.sessions.get(sessionId);
      return s ? { mode: s.mode, greeted: s.greeted, vadState: s.vadState, inCooldown: s.inCooldown } : null;
    }
    const devices = [];
    for (const [id, s] of this.sessions) {
      devices.push({ sessionId: id, mode: s.mode, greeted: s.greeted, vadState: s.vadState, inCooldown: s.inCooldown });
    }
    return devices;
  }
}

export { AIConversation, callCoze, stripEmoji, opusSelfTest };
