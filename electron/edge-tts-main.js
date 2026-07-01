/**
 * Edge TTS (主进程版) — 通过 WebSocket 调用微软 Edge 神经语音
 *
 * 完全模拟 Python edge-tts 库的协议：
 *   1. 发送 speech.config（指定 riff-16khz-16bit-mono-pcm 输出）
 *   2. 收到 turn.start → 发送 SSML
 *   3. 接收 Path:audio 头 + 二进制 PCM 帧
 *   4. turn.end → 组装返回
 *
 * 默认语音: zh-CN-XiaoxiaoNeural (晓晓，中文女声)
 */
import WebSocket from 'ws';
import https from 'https';
import { randomUUID } from 'crypto';

const EDGE_HOST = 'speech.platform.bing.com';
const EDGE_URL = `wss://${EDGE_HOST}/consumer/speech/synthesize/readaloud/edge/v1`;
const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

// 自定义 Agent — 绕过 CDN 证书检查
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
});

function buildSsml(text, voice, rate) {
  const safe = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-CN"><voice name="${voice}"><prosody rate="${rate}" pitch="+0Hz">${safe}</prosody></voice></speak>`;
}

export async function edgeTtsToPcm16(text, voice = 'zh-CN-XiaoxiaoNeural', rate = '+0%') {
  if (!text || text.trim().length === 0) throw new Error('edgeTtsToPcm16: empty text');

  const connectionId = randomUUID();
  const requestId = randomUUID();
  const url = `${EDGE_URL}?TrustedClientToken=${TRUSTED_TOKEN}&ConnectionId=${connectionId}`;
  const ssml = buildSsml(text, voice, rate);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      },
      agent: httpsAgent,
      handshakeTimeout: 10000,
      maxPayload: 5 * 1024 * 1024,
    });

    const audioChunks = [];
    let ssmlSent = false;
    let finished = false;

    ws.on('open', () => {
      // 步骤1：发送 speech.config
      const config = `X-RequestId:${requestId}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":true},"outputFormat":"riff-16khz-16bit-mono-pcm"}}}}`;
      ws.send(config);
    });

    ws.on('message', (data, isBinary) => {
      if (finished) return;

      if (!isBinary) {
        const msg = data.toString();

        if (!ssmlSent && msg.includes('turn.start')) {
          // 步骤2：收到 turn.start → 发送 SSML
          ssmlSent = true;
          ws.send(`Path:ssml\r\nX-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\n\r\n${ssml}`);
          return;
        }

        if (msg.includes('turn.end')) {
          // 步骤4：TTS 完成，组装音频
          finished = true;
          const full = Buffer.concat(audioChunks);
          if (full.length === 0) {
            reject(new Error('Edge TTS: 未收到音频数据'));
          } else {
            const pcm = extractPcm(full);
            const dur = pcm.length / 16000;
            console.log(`[EdgeTTS] ✅ "${text.slice(0, 25)}..." → ${pcm.length}样本 ${dur.toFixed(1)}s`);
            resolve({ pcm, sampleRate: 16000, duration: dur });
          }
          ws.close(1000);
          return;
        }
        // 其他文本（如 Path:audio 头）忽略
        return;
      }

      // 步骤3：二进制帧 = PCM 数据
      audioChunks.push(Buffer.from(data));
    });

    ws.on('error', (err) => reject(new Error(`Edge TTS WS错误: ${err.message}`)));
    ws.on('close', (code) => {
      if (!finished && !ssmlSent) {
        reject(new Error(`Edge TTS 握手被拒, code=${code}`));
      }
    });

    setTimeout(() => {
      if (!finished) { ws.close(1000); reject(new Error('Edge TTS 超时(30s)')); }
    }, 30000);
  });
}

function extractPcm(buf) {
  // 找 WAV "data" chunk
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      const start = off + 8;
      const end = Math.min(start + sz, buf.length);
      const n = Math.floor((end - start) / 2);
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(start + i * 2);
      return out;
    }
    off += 8 + sz;
  }
  // fallback: raw PCM
  const n = Math.floor(buf.length / 2);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

export const EDGE_VOICES = {
  'zh-CN-XiaoxiaoNeural': '晓晓 (女声)',
  'zh-CN-YunxiNeural': '云希 (男声)',
  'zh-CN-XiaoyiNeural': '晓伊 (少女)',
  'zh-CN-YunyangNeural': '云扬 (男声)',
  'zh-CN-XiaochenNeural': '晓辰 (女声)',
  'zh-CN-XiaohanNeural': '晓涵 (女声)',
  'zh-CN-XiaomengNeural': '晓梦 (女声)',
  'zh-CN-XiaomoNeural': '晓墨 (女声)',
  'zh-CN-XiaoqiuNeural': '晓秋 (女声)',
  'zh-CN-XiaoruiNeural': '晓睿 (女声)',
  'zh-CN-XiaoshuangNeural': '晓双 (女声)',
};
