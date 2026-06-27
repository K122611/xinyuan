/**
 * Windows SAPI TTS → PCM 16-bit mono 16000 Hz
 * 使用 PowerShell + System.Speech.Synthesis 生成语音并提取原始 PCM 数据
 */

import { execFile } from 'child_process';
import { readFile, unlink } from 'fs/promises';
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

    // 清理临时文件（数据已在内存中）
    try { await unlink(wavPath); } catch { /* ignore */ }

    // 🔬 诊断：解析 WAV fmt chunk 验证格式
    const fmtOff = 12;
    if (wavBuffer.length > fmtOff + 24) {
      const dv = new DataView(wavBuffer.buffer, wavBuffer.byteOffset, wavBuffer.length);
      const chunkId = wavBuffer.toString('ascii', fmtOff, fmtOff + 4);
      if (chunkId === 'fmt ') {
        const audioFormat = dv.getUint16(fmtOff + 8, true);
        const numChannels = dv.getUint16(fmtOff + 10, true);
        const sampleRate = dv.getUint32(fmtOff + 12, true);
        const bitsPerSample = dv.getUint16(fmtOff + 22, true);
        console.log(`[SAPI] 🔬 WAV fmt: format=${audioFormat} ch=${numChannels} rate=${sampleRate} bits=${bitsPerSample} wavSize=${wavBuffer.length}`);
      }
    }

    // WAV 头通常是 44 字节，但有些可能是 46 字节（有额外填充）
    // 查找 "data" chunk
    const dataOffset = findDataChunkOffset(wavBuffer);
    if (dataOffset < 0) {
      throw new Error('sapiToPcm16: could not find data chunk in WAV');
    }

    // data chunk 前 4 字节是 "data"，后 4 字节是数据大小
    const pcmData = wavBuffer.subarray(dataOffset + 8);

    if (pcmData.length === 0) {
      throw new Error('sapiToPcm16: generated WAV has no audio data');
    }

    // 🔬 诊断：用 readInt16LE 直接读前几个样本验证
    const diagCount = Math.min(8, Math.floor(pcmData.length / 2));
    const diagSamples = [];
    for (let i = 0; i < diagCount; i++) {
      diagSamples.push(pcmData.readInt16LE(i * 2));
    }
    console.log(`[SAPI] 🔬 PCM 前${diagCount}样本 (readInt16LE): [${diagSamples.join(',')}]`);

    return {
      pcm: pcmData,
      sampleRate: 16000,
      duration: pcmData.length / 32000, // 16-bit mono: 2 bytes/sample * 16000 samples/sec = 32000 bytes/sec
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
