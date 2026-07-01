/**
 * 心元 AI 对话引擎 (Electron 主进程)
 *
 * 集成：Coze AI、VAD 语音检测、Windows STT、Edge TTS、Opus 编码
 * 通过 XiaozhiBridge 将 AI 回复推送到设备喇叭播放
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const OpusScript = require('opusscript');

// ========== 配置 ==========
const COZE_BOT = process.env.COZE_BOT_ID || '7649689722696237091';
const COZE_TOKEN = process.env.COZE_TOKEN || '';
// dotenv 加载（Electron主进程环境变量优先）
try { require('dotenv').config({ path: path.join(ROOT, '.env'), override: false }); } catch (_) {}
const ROOT = path.resolve(__dirname, '..');
// 使用系统 Temp 目录，避免中文路径导致 System.Speech（老API）乱码
const STT_WAV = path.join(os.tmpdir(), 'xinyuan_stt_temp.wav');
const STT_PS1 = path.join(ROOT, 'stt_temp.ps1');

const PERSONA = `你是"心元"——智能仓鼠伙伴。语气温柔真诚俏皮，口语化中文像朋友聊天。回复1-3句话。禁止emoji。`;

// ========== 需要联网的问题关键词 ==========
const SEARCH_KEYWORDS = ['几号', '日期', '星期几', '天气', '多少度',
  '新闻', '最新', '热搜', '发生了什么', '多少钱', '价格', '汇率', '股价', '股票',
  '什么是', '为什么', '怎么', '如何', '是谁', '在哪里', '什么时候', '搜索', '查一下', '帮我查',
  '多少号', '农历', '温度', '湿度', '预报'];

function needsSearch(text) {
  return SEARCH_KEYWORDS.some(kw => text.includes(kw));
}

async function webSearch(query) {
  try {
    // 🔧 DuckDuckGo 在境内被墙，缩减超时到2秒避免阻塞流水线
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    let info = '';
    if (data.AbstractText) info += data.AbstractText + '\n';
    if (data.Answer) info += data.Answer + '\n';
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      info += data.RelatedTopics.slice(0, 3).map(t => t.Text || '').filter(Boolean).join('\n');
    }
    return info.trim();
  } catch (e) {
    console.warn('[WebSearch] 搜索失败:', e.message);
    return '';
  }
}

// VAD
const VAD_THRESHOLD = 200;
const SILENCE_SEC = 1.0;
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

// ========== Markdown / JSON artifacts 清理 ==========
// Coze 有时生成 ![alt](data:...) markdown 和 {"emotion":"listening"} JSON
// 这些会使 Coze TTS 返回 HTTP 400，导致退化为 SAPI 系统语音
function stripMarkdown(text) {
  return text
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/!\[.*?\]\[.*?\]/g, '')
    .replace(/\{[^}]*"emotion"[^}]*\}/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*[\r\n]/gm, '')
    .trim();
}

// ========== Coze AI (SSE 流式) ==========
let convId = null;

async function callCoze(msg, onStream, onFirstSentence) {
  try {
    // 1. 注入当前日期时间
    const now = new Date();
    const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}，周${['日','一','二','三','四','五','六'][now.getDay()]}`;

    // 2. 如果是知识型问题，联网搜索（后台不阻塞，DuckDuckGo在国内不可用）
    let searchInfo = '';
    if (needsSearch(msg)) {
      console.log('[WebSearch] 🔍 后台搜索（不阻塞流程）:', msg.slice(0, 50));
      // 启动搜索但不等待 — 直接进入 Coze 对话，节省 1.5s+
      webSearch(msg).then(r => {
        if (r) console.log('[WebSearch] ✅ 结果:', r.slice(0, 120));
      }).catch(() => {});
    }

    // 3. 构建消息：日期 + 搜索结果 + 用户问题
    let enhancedMsg = msg;
    enhancedMsg += `\n[当前时间：${dateStr}]`;
    if (searchInfo) {
      enhancedMsg += `\n[联网搜索结果：${searchInfo}]\n请根据以上搜索结果回答用户问题。`;
    }

    const body = {
      bot_id: COZE_BOT, user_id: 'user_xinyuan', stream: true, auto_save_history: true,
      additional_messages: [{ 
        role: 'user', 
        content: convId ? enhancedMsg : `${PERSONA}\n\n用户：「${enhancedMsg}」`, 
        content_type: 'text' 
      }],
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
    const dl = Date.now() + 20000;
    let firstSentenceFired = false;

    while (Date.now() < dl) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('event:')) {
          sseEvent = line.substring(6).trim();
          if (sseEvent !== 'conversation.message.delta') {
            console.log('[Coze SSE] event:', sseEvent);
          }
        }
        if (line.startsWith('data:') && sseEvent !== 'conversation.message.delta') {
          // 捕获非 delta 事件（包括 tool_call, error, completed 等）
          try {
            const j = JSON.parse(line.substring(5));
            if (j.type) console.log('[Coze SSE] data type:', j.type, j.content ? j.content.slice(0, 80) : '');
            else console.log('[Coze SSE] data keys:', Object.keys(j).join(','));
          } catch (_) {}
        }
        if (line.startsWith('data:') && sseEvent === 'conversation.message.delta') {
          try {
            const j = JSON.parse(line.substring(5));
            if (j.conversation_id && !convId) convId = j.conversation_id;
            if (j.type === 'answer' && j.content) {
              result += j.content;
              lastData = Date.now();
              if (onFirstSentence && !firstSentenceFired && /[。！？]/.test(result) && result.length > 5) {
                firstSentenceFired = true;
                onFirstSentence(result);
              }
              if (onStream) onStream(j.content);
            } else if (j.type && j.type !== 'answer') {
              console.log('[Coze SSE] delta type:', j.type);
            }
          } catch (_) {}
        }
      }
      if (result && lastData && (Date.now() - lastData > 500)) {
        try { reader.cancel(); } catch (_) {}
        break;
      }
    }

    result = result.replace(/\n*\{[^}]*\}.*$/, '').trim();
    result = stripSuggestions(result);
    result = stripEmoji(result);
    result = stripMarkdown(result);
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

// ========== Coze ASR (语音识别 - Coze 云端 STT) ==========
// 比 System.Speech 更准、更快，无 PowerShell 启动开销
async function cozeStt(wavFilePath) {
  try {
    console.log('[CozeASR] 🔄 发送音频到 Coze 识别...');
    const wavBuffer = readFileSync(wavFilePath);
    if (wavBuffer.length < 44) throw new Error('WAV 文件太小 (< 44 bytes)');

    // 手动构造 multipart/form-data（避免依赖 FormData/Blob 全局对象）
    const boundary = '----CozeSTT' + Date.now();
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n`,
      'utf-8'
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const body = Buffer.concat([header, wavBuffer, footer]);

    const res = await fetch('https://api.coze.cn/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      signal: AbortSignal.timeout(8000), // 5s 超时，失败回落 System.Speech
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn('[CozeASR] ⚠ HTTP', res.status, errBody.slice(0, 200));
      return null; // 返回 null 表示失败，由调用方回落
    }

    const json = await res.json();
    // Coze 返回格式: { data: { text: "..." }, code: 0 } — text 嵌套在 data 内
    const text = (json.data?.text || json.text || json.result || '').trim();
    if (text) {
      console.log('[CozeASR] ✅ 识别:', text);
      return text;
    }
    console.warn('[CozeASR] ⚠ 返回空文本, JSON:', JSON.stringify(json).slice(0, 200));
    return null;
  } catch (e) {
    console.warn('[CozeASR] ❌ 异常:', e.message);
    return null; // 返回 null → 回落 System.Speech
  }
}

// ========== Windows STT ==========
// 启动时自检 System.Speech 是否可用（中文语音识别语言包）
async function sttSelfTest() {
  try {
    console.log('[STT自检] 检测 System.Speech 是否可用...');
    // 创建 1 秒静音 WAV 测试 System.Speech 引擎
    const testPCM = new Int16Array(16000); // 1s @ 16kHz
    pcmToWavFile(testPCM, STT_WAV);
    const result = windowsSTT(STT_WAV);
    try { unlinkSync(STT_WAV); } catch (_) {}
    if (result === null) {
      console.warn('[STT自检] ❌ System.Speech 不可用！请在Windows设置中安装中文语音识别语言包');
      console.warn('[STT自检]    设置 → 时间和语言 → 语言 → 添加语言 → 中文(简体) → 语音识别');
      return { ok: false, error: 'System.Speech 中文语音识别语言包未安装' };
    }
    console.log('[STT自检] ✅ System.Speech 可用');
    return { ok: true };
  } catch (e) {
    console.warn('[STT自检] ❌ 异常:', e.message);
    return { ok: false, error: e.message };
  }
}

function windowsSTT(wavFilePath) {
  const ps1 = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
# BUGFIX: 显式指定 zh-CN 文化，否则可能找不到中文识别器
$culture = [System.Globalization.CultureInfo]::new("zh-CN")
try { $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture) }
catch {
  # zh-CN 失败时回退默认文化（英文等）
  try { $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine }
  catch { Write-Host ("STT_ERR:" + $_.Exception.Message); return }
}
$engine.SetInputToWaveFile('${wavFilePath.replace(/\\/g, '\\\\')}')
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$engine.LoadGrammar($grammar)
# 🔧 设置较短的初始静音超时，提高短语音识别率
$engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(2)
$engine.BabbleTimeout = [TimeSpan]::FromSeconds(5)
$engine.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(600)
try {
  $result = $engine.Recognize()
  # BUGFIX: 静音时 Recognizer 返回 $null → 输出 "STT_OK:" (无文字但引擎正常)
  if ($result) { Write-Host ("STT_OK:" + $result.Text) } else { Write-Host "STT_OK:" }
} catch { Write-Host ("STT_ERR:" + $_.Exception.Message) }
finally { $engine.Dispose() }`;
  try {
    writeFileSync(STT_PS1, ps1, 'utf8');
    const wavStat = statSync(wavFilePath);
    console.log('[STT] 🔬 WAV 文件:', wavFilePath, wavStat.size, 'bytes');
    const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${STT_PS1}"`, { encoding: 'utf8', timeout: 15000, windowsHide: true });
    try { unlinkSync(STT_PS1); } catch (_) {}
    const trimmed = out.trim();
    console.log('[STT] 🔬 PowerShell 输出:', trimmed.slice(0, 200));
    if (trimmed.startsWith('STT_OK:')) {
      const text = trimmed.substring(7).trim();
      return text; // 空字符串 = 引擎正常但无语音，非空 = 识别结果
    }
    console.warn('[STT] ⚠ PowerShell 非标准输出:', trimmed.slice(0, 100));
    return null;
  } catch (e) {
    console.error('[STT] ❌ PowerShell 异常:', e.message);
    try { unlinkSync(STT_PS1); } catch (_) {}
    return null;
  }
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

    // 🔧 启动时自检 STT（异步，不阻塞构造）
    sttSelfTest().then(result => {
      if (!result.ok) {
        // 广播 STT 不可用到所有会话（无设备时可能没有 session）
        this._sttAvailable = false;
      } else {
        this._sttAvailable = true;
      }
    });
  }

  _createSessionState() {
    return {
      mode: 'realtime',
      greeted: false,
      vadState: 'idle',        // idle | speaking | silence
      speechPCM: [],          // Int16Array[]
        preRollBuffer: [],
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
        s.preRollBuffer = [];
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
        s.preRollBuffer = [];
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

    // 冷却期内不处理VAD，避免误触发
    if (s.inCooldown) return;

    if (s.vadState === 'idle') {
      if (isSpeech) {
        s.vadState = 'speaking';
        s.speechPCM = s.preRollBuffer.length > 0 ? [...s.preRollBuffer, chunk] : [chunk];
        s.preRollBuffer = [];
        s.silentFrames = 0;
        console.log('[AI对话] 🗣️ VAD start', sessionId.slice(0, 8));
        this._emit(sessionId, 'speech_start');
      } else {
        s.preRollBuffer.push(chunk);
        if (s.preRollBuffer.length > 5) s.preRollBuffer.shift();
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

    const text = stripMarkdown(result || '让我想想...').slice(0, 300);
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
    let fullPCM = new Int16Array(totalSamples);
    let off = 0;
    for (const c of pcmChunks) { fullPCM.set(c, off); off += c.length; }

    // ✂️ 尾部静音裁剪：VAD捕捉的结尾最长2.5s静音稀释语音占比，干扰ASR
    let lastSpeechIdx = fullPCM.length - 1;
    const SILENCE_FLOOR = 400;
    for (let i = fullPCM.length - 1; i >= fullPCM.length * 0.4; i--) {
      if (Math.abs(fullPCM[i]) > SILENCE_FLOOR) { lastSpeechIdx = i; break; }
    }
    const tailPad = 2400; // 300ms 尾音padding
    const trimEnd = Math.min(fullPCM.length, lastSpeechIdx + tailPad);
    if (trimEnd < fullPCM.length && trimEnd > fullPCM.length * 0.3) {
      const trimmed = new Int16Array(trimEnd);
      trimmed.set(fullPCM.subarray(0, trimEnd));
      const origLen = fullPCM.length;
      fullPCM = trimmed;
      console.log('[AI对话] ✂️ 尾部裁剪:', ((origLen / 16000) * 1000).toFixed(0), 'ms →', ((trimEnd / 16000) * 1000).toFixed(0), 'ms');
    }

    console.log('[AI对话] 🎤 Utterance:', (fullPCM.length / 16000).toFixed(1), 's', sessionId.slice(0, 8));
    // 跳过过短语音 (< 0.5s)，大概率是噪音/口水声触发 VAD
    if (fullPCM.length < 8000) { // 0.5s @ 16kHz
      console.log('[AI对话] ⏭️ 跳过过短语音:', (fullPCM.length / 16000).toFixed(2), 's');
      this._emit(sessionId, 'stt_empty');
      return;
    }
    // 最短时长保障：Coze ASR 需要至少 ~1.2s 音频才能稳定识别，短于2s补静音
    const MIN_STT_DURATION_SAMPLES = 32000; // 2s @ 16kHz
    if (fullPCM.length < MIN_STT_DURATION_SAMPLES) {
      const padded = new Int16Array(MIN_STT_DURATION_SAMPLES);
      padded.set(fullPCM);
      console.log('[AI对话] 补充静音:', (fullPCM.length / 16000).toFixed(2), 's  2s');
      fullPCM = padded;
    }

    // 🔧 噪声门限检查 + RMS 计算（去除多余 {} 块，rms 需在外部可访问）
    const NOISE_RMS_THRESHOLD = 40;  // RMS 低于此值 = 纯噪声/静音（从80降到40，解决轻声说话被过滤）
    let sumSq = 0;
    for (let i = 0; i < fullPCM.length; i++) {
      sumSq += fullPCM[i] * fullPCM[i];
    }
    const rms = Math.sqrt(sumSq / fullPCM.length);
    console.log('[AI对话] 📊 RMS:', rms.toFixed(1), '(阈值:', NOISE_RMS_THRESHOLD, ')');
    if (rms < NOISE_RMS_THRESHOLD) {
      console.log('[AI对话] 🔇 噪声/静音 (RMS 低于阈值)，跳过 STT');
      this._emit(sessionId, 'stt_empty');
      this._emit(sessionId, 'stt_error', {
        code: 'STT_NOISE',
        message: `音频能量过低 (RMS=${rms.toFixed(1)}), 可能是环境噪声触发VAD`,
        hint: '请靠近麦克风说话，或降低环境噪音'
      });
      return;
    }

    // STT — 动态增益：根据原始 RMS 自动调整，避免削波
    // System.Speech 最佳输入范围 RMS≈800-3000，太小声无法识别，太大声削波失真也无效
    let sttGain = 1.0;
    if (rms > 0 && rms < 1200) sttGain = Math.min(2.0, 1200 / rms); // 低音量放大（上限2.0x，避免削波失真导致Coze ASR失败）
    else if (rms > 5000) sttGain = Math.max(0.1, 1500 / rms);       // 太大声大幅衰减

    const gainedPCM = new Int16Array(fullPCM.length);
    let gainClipCount = 0;
    for (let i = 0; i < fullPCM.length; i++) {
      const v = Math.round(fullPCM[i] * sttGain);
      if (v > 32767) { gainedPCM[i] = 32767; gainClipCount++; }
      else if (v < -32767) { gainedPCM[i] = -32767; gainClipCount++; }
      else { gainedPCM[i] = v; }
    }
    console.log('[AI对话] 🎚️ STT 增益: x' + sttGain.toFixed(1) + (gainClipCount > 0 ? ` (削波${gainClipCount}/${fullPCM.length})` : ''));
    if (gainClipCount > fullPCM.length * 0.05) { // 削波超过5%，信号不可用（近距离喊话等）
      console.log('[AI对话] ⚠️ 信号削波严重(' + (gainClipCount/fullPCM.length*100).toFixed(0) + '%)，请稍远离麦克风');
      this._emit(sessionId, 'stt_empty');
      return;
    }
    pcmToWavFile(gainedPCM, STT_WAV);
    const t1 = Date.now();
    // 🚀 并行 Coze ASR + System.Speech
    const sysSttPromise = (async () => { try { return await windowsSTT(STT_WAV); } catch (_) { return null; } })();
    let sttText = null;
    const cozePromise = cozeStt(STT_WAV).then(r => (r && r.length > 0) ? r : null);
      
      // Coze ASR 优先（8s超时），System.Speech 仅做 Coze 无结果时的降级兜底
      sttText = await cozePromise;
      if (sttText) {
        console.log('[AI对话] STT Coze:', sttText.slice(0, 30));
      } else {
        const sysResult = await sysSttPromise.catch(() => null);
        if (sysResult && sysResult.length > 0) {
          const cjk = (sysResult.match(/[\u4e00-\u9fa5]/g) || []).length;
          if (cjk >= 2 && sysResult.length >= 3) {
            sttText = sysResult;
            console.log('[AI对话] STT降级 System.Speech:', sysResult.slice(0,30));
          } else {
            console.log('[AI对话] STT降级 Sys frag rejected:', sysResult.slice(0,20), '(CJK=' + cjk + ', len=' + sysResult.length + ')');
          }
        }
      }
    console.log('[AI对话] STT耗时:', Date.now() - t1, 'ms');

    if (!sttText || sttText.length === 0) {
      // 🔄 Coze 返回空文本，尝试 System.Speech 本地兜底
      try {
        const sysFallback = await windowsSTT(STT_WAV);
        if (sysFallback && sysFallback.length >= 2) {
          sttText = sysFallback;
          console.log('[AI对话] STT Sys兜底:', sttText);
        }
      } catch (_) {}
      }

      if (!sttText || sttText.length === 0) {
      console.log('[AI对话] 🤫 No speech (STT 不可用)');
      Promise.resolve().then(() => { try { unlinkSync(STT_WAV); } catch (_) {} });
      // 🔧 STT 失败时通知渲染进程，让用户看到提示
      this._emit(sessionId, 'stt_empty');
      this._emit(sessionId, 'stt_error', {
        code: 'STT_NO_RESULT',
        message: '语音识别未返回结果（云端+本地均失败）',
        hint: '请靠近麦克风清晰说话，降低环境噪音。若持续出现，请检查 Windows 设置→语言→添加中文语音识别包。'
      });
      // 🔧 BUGFIX: STT 失败时给设备发送兜底 TTS 回复
      // 防止设备收不到任何音频响应 → 超时跳待命 → 重连死循环
      // 至少让设备"有声音回来"，保持连接稳定
      try {
        const fallbackText = '我刚才没有听清，你可以再说一遍吗？';
        console.log('[AI对话] 🔊 STT 兜底 TTS:', fallbackText);
        this._emit(sessionId, 'ai_reply', { text: '[STT不可用] ' + fallbackText });
        const sent = await this._speakToDevice(sessionId, fallbackText);
        this._startCooldown(sessionId, sent);
      } catch (ttsErr) {
        console.warn('[AI对话] ⚠ STT 兜底 TTS 也失败了:', ttsErr.message);
      }
      return;
    }

    const t2 = Date.now();
    console.log('[AI对话] 📝 STT:', sttText);
    this._emit(sessionId, 'stt_result', { text: sttText });

    // Coze → TTS流水线：提前开始TTS不等全部生成完
    this._emit(sessionId, 'ai_start', { text: sttText });
    let earlyTtsPromise = null;
    let earlyText = '';

    const result = await callCoze(sttText, (chunk) => {
      this._emit(sessionId, 'ai_stream', { chunk });
    }, (firstSentence) => {
      if (!earlyTtsPromise) {
        earlyText = firstSentence;
        const cleanFirst = stripMarkdown(stripEmoji(firstSentence)).replace(/\s*\{[^}]*\}/g, '').trim();
        console.log('[AI对话] 🚀 提前TTS:', cleanFirst.slice(0, 40));
        earlyTtsPromise = this.edgeTtsFn(cleanFirst);
      }
    });

    const text = stripMarkdown(result || '让我想想...').slice(0, 300);
    this._emit(sessionId, 'ai_reply', { text });
    console.log('[AI对话] ⏱️ Coze SSE耗时:', Date.now() - t2, 'ms');

    let sent = 0;
    if (earlyTtsPromise) {
      try {
      const earlyResult = await earlyTtsPromise;
      // 合并提前TTS+剩余TTS为单一PCM流，避免双TTS start/stop重音
      let combinedPcm = null;
      let combinedDuration = 0;
      if (earlyResult?.pcm) {
        combinedPcm = new Int16Array(earlyResult.pcm);
        combinedDuration = earlyResult.duration || (earlyResult.pcm.length / 16000);
      }
        const remaining = text.slice(stripMarkdown(stripEmoji(earlyText)).replace(/\s*\{[^}]*\}/g, '').trim().length).trim();
      if (remaining.length > 0) {
        console.log('[AI对话] 🔄 剩余TTS:', remaining.slice(0, 40));
        const remainResult = await this.edgeTtsFn(remaining);
        if (remainResult?.pcm) {
          const merged = new Int16Array((combinedPcm?.length || 0) + remainResult.pcm.length);
          if (combinedPcm) merged.set(combinedPcm, 0);
          merged.set(remainResult.pcm, combinedPcm?.length || 0);
          combinedPcm = merged;
          combinedDuration += (remainResult.duration || remainResult.pcm.length / 16000);
        }
      }
      if (combinedPcm && combinedPcm.length > 0) {
        console.log('[AI对话] 🎵 合并TTS:', combinedDuration.toFixed(1), 's');
        sent = await this._speakToDevice(sessionId, { pcm: combinedPcm, duration: combinedDuration });
      }
      } catch (e) {
      console.warn('[AI对话] ⚠ 提前TTS失败，回退:', e.message);
      sent = await this._speakToDevice(sessionId, text);
      }
    } else {
      sent = await this._speakToDevice(sessionId, text);
    }
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

  // ========== 文字/PCM → Opus → 设备播报 ==========
  // 支持两种输入：字符串（做TTS）或 {pcm, duration}（跳过TTS直接用PCM）
  async _speakToDevice(sessionId, input) {
    if (!input) return 0;

    let pcmSamples, ttsDuration;

    if (typeof input === 'string') {
      // 原有路径：文字 → TTS → PCM
      let text = stripSuggestions(input);
      text = stripEmoji(text);
      text = stripMarkdown(text);
      if (!text || text.trim().length === 0) return 0;

      console.log('[AI对话] TTS播报:', text.slice(0, 60), sessionId.slice(0, 8));
      this._emit(sessionId, 'tts_start', { text: text.slice(0, 80) });

      try {
        const ttsResult = await this.edgeTtsFn(text);
        if (!ttsResult?.pcm || ttsResult.pcm.length < 100) {
          console.warn('[AI对话] TTS PCM 无效:', ttsResult?.pcm?.length || 0);
          return 0;
        }
        pcmSamples = ttsResult.pcm;
        ttsDuration = pcmSamples.length / 16000;
      } catch (e) {
        console.error('[AI对话] TTS失败:', e.message);
        return 0;
      }
    } else if (input?.pcm) {
      // 🚀 流水线路径：已有PCM，跳过TTS
      pcmSamples = input.pcm;
      ttsDuration = input.duration || (pcmSamples.length / 16000);
      console.log('[AI对话] PCM直播:', ttsDuration.toFixed(1), 's', sessionId.slice(0, 8));
      this._emit(sessionId, 'tts_start', { text: '(pipelined PCM)' });
    } else {
      return 0;
    }

    if (!pcmSamples || pcmSamples.length < 100) return 0;

      // 创建 AUDIO 模式编码器（CELT 编码，ESP32 固件兼容）
      // 每次 TTS 调用新建编码器，避免长时间累积导致模式漂移
      const OpusScript = require('opusscript');
      const encoder = new OpusScript(16000, 1, OpusScript.Application.AUDIO);

      const FRAME_SIZE = 960, FRAME_BYTES = FRAME_SIZE * 2;
      const totalFrames = Math.ceil(pcmSamples.length / FRAME_SIZE);
      if (totalFrames === 0) { encoder.delete(); return 0; }

      // ===== TTS 开始 =====
      this.bridge.sendToDevice(sessionId, { session_id: sessionId, type: 'tts', state: 'start' });

      // 禁用麦克风拾音：防止 TTS 播放时设备回声导致误识别
      const session = this.sessions.get(sessionId); if (session) session.inCooldown = true;

      // 🔇 前置静音帧：预热 ESP32 解码器，避免首帧断音
      const silenceBuf = Buffer.alloc(FRAME_BYTES);
      const silenceOpus = encoder.encode(silenceBuf, FRAME_SIZE);
      if (silenceOpus && silenceOpus.length > 0) {
        this.bridge.sendOpus(sessionId, Buffer.from(silenceOpus));
      }

      // 🚀 流式编码+发送：每帧编码完立即发送，不等全部编码完
      //    帧间隔 50ms（原 55ms），每帧含 60ms 音频，ESP32 有足够缓冲余量
      let sentFrames = 0;
      const PRE_BUFFER = 2;  // 前N帧无间隔发送，快速填满 ESP32 解码器缓冲
      const FRAME_GAP = 42;  // 帧间间隔 ms (1.4x加速，避免ESP32缓冲区溢出)

      for (let i = 0; i < totalFrames; i++) {
        const offset = i * FRAME_SIZE;
        const buf = Buffer.alloc(FRAME_BYTES);
        for (let j = 0; j < FRAME_SIZE && (offset + j) < pcmSamples.length; j++) {
          buf.writeInt16LE(pcmSamples[offset + j], j * 2);
        }
        const opusFrame = encoder.encode(buf, FRAME_SIZE);
        if (opusFrame && opusFrame.length > 0) {
          this.bridge.sendOpus(sessionId, Buffer.from(opusFrame));
          sentFrames++;
          // 预缓冲帧不发间隔，后续帧按间隔发送防止 ESP32 缓冲区溢出
          if (sentFrames > PRE_BUFFER) {
            await new Promise(r => setTimeout(r, FRAME_GAP));
          }
        }
      }

      console.log('[AI对话] 流式发送', sentFrames, '/', totalFrames, '帧, TOC=0x' + (sentFrames > 0 ? 'ok' : 'empty'));

      // ===== TTS 结束 =====
      this.bridge.sendToDevice(sessionId, { session_id: sessionId, type: 'tts', state: 'stop' });

      encoder.delete();
      console.log('[AI对话] ✅ 完成,', sentFrames, '帧,', (ttsDuration * 1000).toFixed(0), 'ms');
    return sentFrames;
  }
  // ========== 冷却期 ==========
  _startCooldown(sessionId, framesSent) {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    // 播完后1秒即可继续对话（VAD冷却期内已屏蔽，无回声风险）
    // 🔇 冷却期基于实际播报时长，防止 TTS 未播完 VAD 就重新开启导致回声/倍速
    const ttsDurationSec = (framesSent || 0) * 960 / 16000;
    const cooldownMs = Math.max(2000, Math.min(8000, ttsDurationSec * 1000 + 500));
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

    const text = stripMarkdown(result || '让我想想...').slice(0, 300);
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

export { AIConversation, callCoze, stripEmoji, opusSelfTest, sttSelfTest };
