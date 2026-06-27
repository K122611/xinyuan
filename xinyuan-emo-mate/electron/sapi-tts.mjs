/**
 * Windows SAPI TTS → PCM 16-bit mono 16000 Hz
 * 使用 PowerShell + System.Speech.Synthesis 生成语音并提取原始 PCM 数据
 */

import { execFile } from 'child_process';
import { readFile, unlink, writeFile, copyFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { promisify } from 'util';

const execFileP = promisify(execFile);

/**
 * 将文本转为 16000 Hz 16-bit mono PCM Buffer
 */
export async function sapiToPcm16(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('sapiToPcm16: empty text');
  }

  const wavPath = join(tmpdir(), `sapi_tts_${randomBytes(6).toString('hex')}.wav`);

  // PowerShell 脚本：使用 System.Speech 合成语音到 WAV 文件
  const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# 设置输出格式: 16000 Hz, 16-bit, Mono
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  16000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)

$synth.SetOutputToWaveFile('${wavPath.replace(/\\/g, '\\\\')}', $format)

# 设置语音（中文）
try {
  $synth.SelectVoice('Microsoft Huihui Desktop')
} catch {
  # 使用默认语音
}

$synth.Speak('${text.replace(/'/g, "''")}')
$synth.Dispose()
`;

  try {
    await execFileP('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', psScript
    ], { timeout: 60000 });

    // 读取 WAV 文件
    const wavBuffer = await readFile(wavPath);

    // 🔍 诊断：WAV 头部信息
    const fmtOff = 12;
    if (wavBuffer.length > fmtOff + 24) {
      const audioFormat = wavBuffer.readUInt16LE(fmtOff + 8);
      const numChannels = wavBuffer.readUInt16LE(fmtOff + 10);
      const sampleRate = wavBuffer.readUInt32LE(fmtOff + 12);
      const bitsPerSample = wavBuffer.readUInt16LE(fmtOff + 22);
      console.log(`[SAPI] 🔬 WAV fmt: format=${audioFormat} ch=${numChannels} rate=${sampleRate} bits=${bitsPerSample} size=${wavBuffer.length}`);
    }

    // 查找 "data" chunk
    const dataOffset = findDataChunkOffset(wavBuffer);
    if (dataOffset < 0) {
      throw new Error('sapiToPcm16: could not find data chunk in WAV');
    }

    const dataSize = wavBuffer.readUInt32LE(dataOffset + 4);
    const pcmStart = dataOffset + 8;
    const pcmByteLen = Math.min(dataSize, wavBuffer.length - pcmStart);
    const totalSamples = Math.floor(pcmByteLen / 2);

    if (totalSamples === 0) {
      throw new Error('sapiToPcm16: generated WAV has no audio data');
    }

    // 🔧 核心修复：用 readInt16LE() 逐个样本读取到独立 Int16Array
    // 完全绕过 Electron Buffer subarray/ArrayBuffer/byteOffset 的所有兼容性问题
    const pcmInt16 = new Int16Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      pcmInt16[i] = wavBuffer.readInt16LE(pcmStart + i * 2);
    }

    // 🔬 诊断：前、中、尾三处采样，并全局扫描最大值
    const samplePeek = (arr, label) => {
      const a = Array.from(arr);
      const has = a.some(s => s !== 0);
      console.log(`[SAPI] 🔬 PCM ${label}: [${a.join(',')}] 有信号=${has}`);
    };
    samplePeek(pcmInt16.slice(0, 8), '前8');
    samplePeek(pcmInt16.slice(Math.floor(totalSamples/2), Math.floor(totalSamples/2)+8), '中8');
    samplePeek(pcmInt16.slice(-8), '尾8');
    
    // 全局最大值
    let maxAbs = 0;
    for (let i = 0; i < totalSamples; i++) {
      const v = Math.abs(pcmInt16[i]);
      if (v > maxAbs) maxAbs = v;
    }
    console.log(`[SAPI] 🔬 PCM 全局 maxAbs=${maxAbs} (共${totalSamples}样本)`);

    // 清理临时文件（保留 diag 副本用于外部验证）
    const diagCopy = join(tmpdir(), 'sapi_diag_' + Date.now() + '.wav');
    try { await copyFile(wavPath, diagCopy); } catch { /* ignore */ }
    console.log(`[SAPI] 📁 诊断WAV: ${diagCopy}`);
    try { await unlink(wavPath); } catch { /* ignore */ }

    return {
      pcm: pcmInt16,           // ✅ 独立 Int16Array，不受 Buffer bug 影响
      sampleRate: 16000,
      duration: pcmByteLen / 32000,
    };
  } catch (err) {
    // 清理临时文件
    try { await unlink(wavPath); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * 在 WAV 缓冲区中查找 "data" chunk 的偏移量
 */
function findDataChunkOffset(buf) {
  // 最小 WAV 头: RIFF(4) + size(4) + WAVE(4) + fmt(4) + fmt_size(4) + fmt_data(variable) + data(4)
  let offset = 12; // 跳过 RIFF header

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);

    if (chunkId === 'data') {
      return offset;
    }

    offset += 8 + chunkSize;
  }

  return -1;
}
