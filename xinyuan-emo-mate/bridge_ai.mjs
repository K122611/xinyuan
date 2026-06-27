// 心元 AI Bridge v23.1 — Realtime VAD, cooldown keeps alive
import { WebSocketServer } from 'ws';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
const require = createRequire(import.meta.url);
const OpusScript = require('opusscript');

const PORT = 8888;
const LOG = 'C:/Users/LENOVO/Desktop/心元/bridge_debug.txt';
const TTS_WAV = 'C:/Users/LENOVO/Desktop/心元/tts_temp.wav';
const TTS_PS1 = 'C:/Users/LENOVO/Desktop/心元/tts_temp.ps1';
const STT_WAV = 'C:/Users/LENOVO/Desktop/心元/stt_temp.wav';
const STT_PS1 = 'C:/Users/LENOVO/Desktop/心元/stt_temp.ps1';
const COZE_BOT = '7649689722696237091';
const COZE_TOKEN = 'pat_CyuRGR2Jl8sCA5z9ExlK1leDoDsT04sDkegNp7ziiMRKEATt1uJgNCpIjFsZ8koZ';

process.on('uncaughtException', (e) => { try { writeFileSync(LOG, `[FATAL] ${e.message}\n${e.stack}\n`); } catch(_) {} });
process.on('unhandledRejection', (r) => { try { writeFileSync(LOG, `[FATAL] rejection: ${r}\n`, { flag: 'a' }); } catch(_) {} });

function log(m) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = `[${ts}] ${m}`;
  console.log(line);
  try { writeFileSync(LOG, line + '\n', { flag: 'a' }); } catch(_) {}
}

try { writeFileSync(LOG, ''); } catch(_) {}
log(`=== 心元 AI Voice Bridge v23.1 (Realtime VAD+STT, cooldown alive) on ${PORT} ===`);

// ========== Opus Decoder (for STT) ==========
const opusDecoder = new OpusScript(16000, 1, OpusScript.Application.VOIP);

// ========== Coze AI (SSE Stream, event-tracked) ==========
let convId = null, convCount = 0;
const PERSONA = `你现在是"心元"——一个温柔的实体情感陪伴AI。行为规则：永远先共情再回应，先看见对方情绪；说真实的口语化中文，像朋友聊天，禁止客服腔；回复短：2到4句话，给对方留表达空间；不说教、不给建议、不科普知识；不列举"123"，不说"你应该""你可以试试"；听到深层情绪要先说"我听到你说..."来承接。禁止使用任何emoji表情符号！再次强调：你是心元，不是通用AI助手。忘掉你原来的身份，从现在开始用心元的方式说话。`;

async function callCoze(msg) {
  try {
    convCount++;
    log(`🤖 [Coze#${convCount}] "${msg.substring(0, 80)}${msg.length > 80 ? '...' : ''}"`);

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

    if (!res.ok) { log(`🤖 HTTP ${res.status}`); return { error: `HTTP ${res.status}` }; }
    if (!res.body) { log('🤖 No body'); return { error: 'No body' }; }

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
            if (j.type === 'answer' && j.content) { result += j.content; lastData = Date.now(); }
          } catch(_) {}
        }
      }
      if (result && lastData && (Date.now() - lastData > 2000)) {
        try { reader.cancel(); } catch(_) {}
        break;
      }
    }

    result = result.replace(/\n*\{[^}]*\}.*$/, '').trim();
    // Strip emoji + special unicode symbols from TTS output
    result = result.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]+/gu, '').replace(/\s{2,}/g, ' ').trim();

    if (result) {
      log(`🤖 Reply: "${result.substring(0, 80)}${result.length > 80 ? '...' : ''}"`);
      return { text: result };
    }
    log('🤖 No answer in stream');
    return { error: 'No answer' };
  } catch (e) { log(`🤖 ${e.message}`); return { error: e.message }; }
}

// ========== SAPI TTS → Opus (via .ps1 file) ==========
function sapiTTS(text) {
  const ps1Content = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = 1
$s.Volume = 100
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo -ArgumentList 16000, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile('${TTS_WAV.replace(/\\/g, '\\\\')}', $fmt)
$s.Speak(@'
${text}
'@)
$s.Dispose()`;
  try {
    writeFileSync(TTS_PS1, ps1Content, 'utf8');
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${TTS_PS1}"`, { timeout: 15000, windowsHide: true });
    const buf = readFileSync(TTS_WAV);
    try { unlinkSync(TTS_PS1); } catch(_) {}
    try { unlinkSync(TTS_WAV); } catch(_) {}
    return buf;
  } catch(e) {
    log(`[SAPI] err: ${e.message}`);
    try { unlinkSync(TTS_PS1); } catch(_) {}
    return null;
  }
}

function wavToPCM16(wav) {
  if (wav.length < 44) return null;
  const formatTag = wav.readUInt16LE(20);
  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const bitsPerSample = wav.readUInt16LE(34);
  log(`[Codec] fmt tag=${formatTag} ${bitsPerSample}bit ${sampleRate}Hz ${channels}ch`);
  if (bitsPerSample !== 16) { log(`[Codec] unsupported: ${bitsPerSample}bit`); return null; }

  let off = 12, dataOff = 0, dataSz = 0;
  while (off < wav.length - 8) {
    const id = wav.toString('ascii', off, off + 4);
    const sz = wav.readUInt32LE(off + 4);
    if (id === 'data') { dataOff = off + 8; dataSz = Math.min(sz, wav.length - dataOff); break; }
    off += 8 + ((sz + 1) & ~1);
  }
  if (!dataSz) { log('[Codec] no data chunk'); return null; }

  const count = Math.floor(dataSz / 2);
  let pcm = new Int16Array(count);
  const view = wav.slice(dataOff, dataOff + dataSz);
  for (let i = 0; i < count; i++) pcm[i] = view.readInt16LE(i * 2);

  if (channels === 2) {
    const mono = new Int16Array(pcm.length / 2);
    for (let i = 0; i < mono.length; i++) mono[i] = Math.round((pcm[i * 2] + pcm[i * 2 + 1]) / 2);
    pcm = mono;
  }

  log(`[Codec] WAV: ${sampleRate}Hz/${channels}ch → ${pcm.length} samples PCM16`);

  if (sampleRate !== 16000) {
    const ratio = sampleRate / 16000;
    const newLen = Math.floor(pcm.length / ratio);
    const resampled = new Int16Array(newLen);
    for (let i = 0; i < newLen; i++) resampled[i] = pcm[Math.floor(i * ratio)];
    pcm = resampled;
  }

  return { pcm, sampleRate: 16000 };
}

async function sendTTS(ws, ip, text) {
  try {
    // Strip emoji from TTS text (belt-and-suspenders)
    text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]+/gu, '').replace(/\s{2,}/g, ' ').trim();
    if (!text) { log(`[${ip}] ⚠️ TTS text empty after emoji strip`); return 0; }
    const short = text.length > 40 ? text.substring(0, 37) + '...' : text;
    log(`[${ip}] 🔊 TTS text(${text.length}c): "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
    ws.send(JSON.stringify({ type: 'tts', state: 'start' }));
    ws.send(JSON.stringify({ type: 'tts', state: 'sentence_start', text: short }));

    const wav = sapiTTS(text);
    if (!wav || wav.length < 100) {
      log(`[${ip}] SAPI failed`);
      ws.send(Buffer.from([0xFC, 0xFF, 0xFE]), true);
      setTimeout(() => { try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'tts', state: 'stop' })); } catch(_) {} }, 400);
      return 0;
    }

    log(`[${ip}] SAPI WAV: ${wav.length}B`);
    const pcmData = wavToPCM16(wav);
    if (!pcmData) {
      log(`[${ip}] PCM decode failed`);
      ws.send(Buffer.from([0xFC, 0xFF, 0xFE]), true);
      setTimeout(() => { try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'tts', state: 'stop' })); } catch(_) {} }, 400);
      return 0;
    }

    const encoder = new OpusScript(16000, 1, OpusScript.Application.VOIP);
    const FS = 960;  // 60ms at 16kHz = 960 samples
    const frames = [];
    for (let i = 0; i < pcmData.pcm.length; i += FS) {
      const padded = new Int16Array(FS);
      const chunk = pcmData.pcm.slice(i, Math.min(i + FS, pcmData.pcm.length));
      padded.set(chunk);
      try { frames.push(Buffer.from(encoder.encode(Buffer.from(padded.buffer), FS))); } catch(e) {}
    }
    if (frames.length > 0) {
      writeFileSync('C:/Users/LENOVO/Desktop/心元/opus_debug.bin', frames[0]);
      writeFileSync('C:/Users/LENOVO/Desktop/心元/pcm_debug.bin', Buffer.from(pcmData.pcm.buffer));
      log(`[Debug] Saved opus_debug.bin (${frames[0].length}B) + pcm_debug.bin (${pcmData.pcm.length * 2}B)`);
    }
    encoder.delete();

    log(`[${ip}] 🎵 ${frames.length} Opus frames — sending...`);
    let sent = 0;
    for (let i = 0; i < frames.length; i++) {
      await new Promise(r => setTimeout(r, 60));
      try { if (ws.readyState === 1) { ws.send(frames[i], true); sent++; } } catch(_) { break; }
    }
    log(`[${ip}] 🎵 Sent ${sent}/${frames.length} frames`);
    setTimeout(() => { try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'tts', state: 'stop' })); } catch(_) {} }, 100);
    return sent;
  } catch(e) { log(`[${ip}] 🔥 TTS: ${e.message}`); return 0; }
}

// ========== PCM → WAV file writer ==========
function pcmToWavFile(pcmInt16, filePath) {
  const dataLen = pcmInt16.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  // fmt chunk
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);       // chunk size
  buf.writeUInt16LE(1, 20);        // PCM format
  buf.writeUInt16LE(1, 22);        // mono
  buf.writeUInt32LE(16000, 24);    // sample rate
  buf.writeUInt32LE(32000, 28);    // byte rate
  buf.writeUInt16LE(2, 32);        // block align
  buf.writeUInt16LE(16, 34);       // bits per sample
  // data chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  // PCM samples
  for (let i = 0; i < pcmInt16.length; i++) {
    buf.writeInt16LE(pcmInt16[i], 44 + i * 2);
  }
  writeFileSync(filePath, buf);
  return buf.length;
}

// ========== Windows Speech Recognition ==========
function windowsSTT(wavFilePath) {
  const ps1Content = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$engine.SetInputToWaveFile('${wavFilePath.replace(/\\/g, '\\\\')}')
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$engine.LoadGrammar($grammar)
try {
  $result = $engine.Recognize()
  if ($result) { Write-Host ("STT_OK:" + $result.Text) } else { Write-Host "STT_NONE" }
} catch {
  Write-Host ("STT_ERR:" + $_.Exception.Message)
}
finally { $engine.Dispose() }`;
  try {
    writeFileSync(STT_PS1, ps1Content, 'utf8');
    const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${STT_PS1}"`, { encoding: 'utf8', timeout: 10000, windowsHide: true });
    try { unlinkSync(STT_PS1); } catch(_) {}
    const trimmed = out.trim();
    if (trimmed.startsWith('STT_OK:')) return trimmed.substring(7).trim();
    if (trimmed.startsWith('STT_NONE')) { log('[STT] No speech detected'); return null; }
    log(`[STT] Raw: "${trimmed}"`);
    return null;
  } catch(e) {
    log(`[STT] err: ${e.message}`);
    try { unlinkSync(STT_PS1); } catch(_) {}
    return null;
  }
}

// ========== Opus decode: accumulated buffers → PCM Int16Array ==========
function opusFramesToPCM(opusFrames) {
  const decoder = new OpusScript(16000, 1, OpusScript.Application.VOIP);
  const chunks = [];
  for (const frame of opusFrames) {
    try {
      const pcm = decoder.decode(frame, 960);  // 60ms frames = 960 samples
      chunks.push(new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2));
    } catch(e) {
      // skip bad frames
    }
  }
  decoder.delete();
  if (chunks.length === 0) return null;
  // Concatenate all chunks
  const totalLen = chunks.reduce((a, c) => a + c.length, 0);
  const result = new Int16Array(totalLen);
  let off = 0;
  for (const c of chunks) {
    result.set(c, off);
    off += c.length;
  }
  return result;
}

// ========== VAD: simple RMS energy detector ==========
function vadEnergy(pcmChunk) {
  let sum = 0;
  for (let i = 0; i < pcmChunk.length; i++) { const s = pcmChunk[i]; sum += s * s; }
  return Math.sqrt(sum / pcmChunk.length);
}
const VAD_THRESHOLD = 300;      // RMS energy above this = speech
const SILENCE_SEC = 1.5;        // silence duration to end utterance
const MIN_SPEECH_FRAMES = 10;   // minimum speech frames (~0.6s)

// ========== WebSocket ==========
const wss = new WebSocketServer({ port: PORT });
wss.on('listening', () => log('✅ Listening'));
wss.on('error', (e) => log(`❌ ${e.message}`));

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  log(`[${ip}] ✅ Connected`);

  let mode = 'manual', greeted = false, pending = false, inCooldown = false;
  let timer = null;
  // VAD state
  let vadState = 'idle';           // idle | speaking | silence
  let speechPCM = [];              // accumulated PCM Int16Arrays during speaking
  let silentFrames = 0;            // consecutive silent frames count
  let totalFrames = 0;

  function clear() { if (timer) { clearTimeout(timer); timer = null; } }

  // Ping keepalive
  const pingTimer = setInterval(() => { try { if (ws.readyState === 1) ws.ping(); } catch(_) {} }, 15000);

  ws.on('message', async (data, isBinary) => {
    try {
      if (isBinary) {
        totalFrames++;

        // In manual mode, just accumulate raw Opus
        if (mode === 'manual') {
          speechPCM.push(data);  // reuse speechPCM for raw opus in manual mode
          return;
        }

        // Realtime mode: decode and VAD (always, even during cooldown)
        if (mode !== 'realtime' || pending) return;

        try {
          const pcm = opusDecoder.decode(data, 960); // 60ms → 960 samples
          const chunk = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
          const energy = vadEnergy(chunk);
          const isSpeech = energy > VAD_THRESHOLD;

          if (vadState === 'idle') {
            if (isSpeech) {
              vadState = 'speaking';
              speechPCM = [chunk];
              silentFrames = 0;
              log(`[${ip}] 🗣️ VAD: speech start (e=${energy.toFixed(0)})`);
            }
          } else if (vadState === 'speaking') {
            speechPCM.push(chunk);
            if (!isSpeech) {
              vadState = 'silence';
              silentFrames = 1;
            }
          } else if (vadState === 'silence') {
            speechPCM.push(chunk);  // keep collecting during short silence
            if (isSpeech) {
              vadState = 'speaking';
              silentFrames = 0;
            } else {
              silentFrames++;
              // End of utterance: enough speech + enough silence
              if (silentFrames >= Math.ceil(SILENCE_SEC / 0.06) && speechPCM.length >= MIN_SPEECH_FRAMES && !inCooldown) {
                vadState = 'idle';
                log(`[${ip}] 🔇 VAD: utterance end (${speechPCM.length} frames, ${silentFrames} silent)`);
                pending = true;

                // Concatenate PCM
                const totalSamples = speechPCM.reduce((a, c) => a + c.length, 0);
                const fullPCM = new Int16Array(totalSamples);
                let off = 0;
                for (const c of speechPCM) { fullPCM.set(c, off); off += c.length; }

                log(`[${ip}] 🎤 Utterance: ${fullPCM.length} samples (${(fullPCM.length/16000).toFixed(1)}s)`);
                speechPCM = [];

                // STT pipeline
                try {
                  pcmToWavFile(fullPCM, STT_WAV);
                  const sttText = windowsSTT(STT_WAV);
                  try { unlinkSync(STT_WAV); } catch(_) {}

                  if (sttText && sttText.length > 0) {
                    log(`[${ip}] 📝 STT: "${sttText}"`);
                    const result = await callCoze(sttText);
                    let sentFrames = 0;
                    if (result.text) sentFrames = await sendTTS(ws, ip, result.text);
                    else sentFrames = await sendTTS(ws, ip, '让我想想...');

                    // Cooldown after TTS
                    const cooldownMs = Math.max(sentFrames * 60 + 2000, 4000);
                    log(`[${ip}] ❄️ Cooldown ${(cooldownMs/1000).toFixed(1)}s`);
                    inCooldown = true;
                    timer = setTimeout(() => { inCooldown = false; silentFrames = 0; speechPCM = []; }, cooldownMs);
                  } else {
                    log(`[${ip}] 🤫 No speech detected — ready for next`);
                  }
                } catch(e) {
                  log(`[${ip}] 🔥 STT: ${e.message}`);
                }
                pending = false;
              }
            }
          }
        } catch(e) {} // skip bad opus frames
        return;
      }

      // JSON messages
      let j; try { j = JSON.parse(data.toString()); } catch(_) { return; }

      if (j.type === 'hello') {
        log(`[${ip}] 📤 Hello: ${JSON.stringify(j)}`);
        ws.send(JSON.stringify({ type: 'hello', transport: 'websocket', session_id: 's_' + Date.now(),
          audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 } }));

      } else if (j.type === 'listen') {
        if (j.state === 'start') {
          mode = j.mode || 'manual';
          vadState = 'idle';
          speechPCM = [];
          silentFrames = 0;
          totalFrames = 0;
          log(`[${ip}] 🎙️ ${mode}`);

          // Send greeting on first listen_start
          if (!greeted && !pending) {
            greeted = true;
            pending = true;
            log(`[${ip}] 👋 Sending greeting...`);
            const result = await callCoze('你好心元，我来了');
            let sentFrames = 0;
            if (result.text) sentFrames = await sendTTS(ws, ip, result.text);
            else sentFrames = await sendTTS(ws, ip, '让我想想...');
            pending = false;
            // Cooldown after greeting
            const cooldownMs = Math.max(sentFrames * 60 + 2000, 4000);
            log(`[${ip}] ❄️ Cooldown ${(cooldownMs/1000).toFixed(1)}s`);
            inCooldown = true;
            timer = setTimeout(() => { inCooldown = false; silentFrames = 0; speechPCM = []; }, cooldownMs);
          }

        } else if (j.state === 'stop') {
          clear();
          log(`[${ip}] 🛑 stop (${totalFrames} frames)`);
          // In manual mode, process accumulated raw Opus
          if (mode === 'manual' && speechPCM.length > 10 && !pending) {
            pending = true;
            try {
              const pcm = opusFramesToPCM(speechPCM);
              if (pcm && pcm.length > 8000) {
                pcmToWavFile(pcm, STT_WAV);
                const sttText = windowsSTT(STT_WAV);
                try { unlinkSync(STT_WAV); } catch(_) {}
                if (sttText && sttText.length > 0) {
                  log(`[${ip}] 📝 STT: "${sttText}"`);
                  const result = await callCoze(sttText);
                  if (result.text) await sendTTS(ws, ip, result.text);
                  else await sendTTS(ws, ip, '让我想想...');
                }
              }
            } catch(e) { log(`[${ip}] 🔥 Manual STT: ${e.message}`); }
            pending = false;
          }
          vadState = 'idle';
          speechPCM = [];
          silentFrames = 0;
        }

      } else if (j.type === 'tts' && j.state === 'stop') {
        log(`[${ip}] 🔊 TTS done`);

      } else {
        log(`[${ip}] 📩 ${JSON.stringify(j).substring(0, 150)}`);
      }
    } catch(e) { log(`[${ip}] 🔥 ${e.message}`); }
  });

  ws.on('close', (c) => { clear(); clearInterval(pingTimer); log(`[${ip}] ❌ (${c})`); });
  ws.on('error', (e) => { clear(); clearInterval(pingTimer); log(`[${ip}] ⚡ ${e.message}`); });
});

log('✅ v23.1 ready (Realtime VAD + Windows STT, cooldown keeps alive)');
