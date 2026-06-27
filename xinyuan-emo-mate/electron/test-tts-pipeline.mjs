// Standalone TTS pipeline test — verifies PCM->Opus conversion
import { sapiToPcm16 } from './sapi-tts.mjs';
import OpusScript from 'opusscript';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const TEMP = join(process.cwd(), 'temp');
if (!existsSync(TEMP)) mkdirSync(TEMP, { recursive: true });

const FRAME_SIZE = 960;

async function main() {
  console.log('[TEST] Starting TTS pipeline test...');

  // 1. Generate TTS
  const text = '你好世界，心元测试。';
  console.log('[TEST] Generating TTS:', text);
  const result = await sapiToPcm16(text);
  console.log('[TEST] TTS result:', { 
    sampleRate: result.sampleRate, 
    duration: result.duration,
    pcmLen: result.pcm.length,
    wavPath: result.wavPath 
  });

  // 2. Convert PCM Buffer -> standalone Int16Array (same logic as _speakToDevice)
  const pcmBuffer = result.pcm;
  const numSamples = Math.floor(pcmBuffer.length / 2);
  const srcSamples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, numSamples);
  const pcmSamples = new Int16Array(srcSamples); // Deep copy

  console.log('[TEST] PCM samples:', numSamples);
  console.log('[TEST] PCM head20:', Array.from(pcmSamples.slice(0, 20)));
  
  // Check for non-zero samples
  let nonZeroCount = 0;
  for (let i = 0; i < Math.min(1000, pcmSamples.length); i++) {
    if (pcmSamples[i] !== 0) nonZeroCount++;
  }
  console.log(`[TEST] Non-zero samples in first 1000: ${nonZeroCount}/1000`);

  // 3. PCM -> Opus using same logic as _pcmToOpusFrames
  const encoder = new OpusScript(16000, 1, OpusScript.Application.AUDIO);
  const frames = [];
  
  for (let offset = 0; offset + FRAME_SIZE <= pcmSamples.length; offset += FRAME_SIZE) {
    const int16 = pcmSamples.subarray(offset, offset + FRAME_SIZE);
    const opusFrame = encoder.encode(int16, FRAME_SIZE);
    if (opusFrame && opusFrame.length > 0) {
      // Explicit deep copy
      const copy = Buffer.alloc(opusFrame.length);
      Buffer.from(opusFrame.buffer, opusFrame.byteOffset, opusFrame.byteLength).copy(copy);
      frames.push(copy);
    }
  }

  const remainder = pcmSamples.length % FRAME_SIZE;
  if (remainder > 0) {
    const padded = new Int16Array(FRAME_SIZE);
    padded.set(pcmSamples.subarray(pcmSamples.length - remainder));
    const opusFrame = encoder.encode(padded, FRAME_SIZE);
    if (opusFrame && opusFrame.length > 0) {
      const copy = Buffer.alloc(opusFrame.length);
      Buffer.from(opusFrame.buffer, opusFrame.byteOffset, opusFrame.byteLength).copy(copy);
      frames.push(copy);
    }
  }

  console.log(`[TEST] Encoded ${frames.length} Opus frames`);
  for (let i = 0; i < Math.min(3, frames.length); i++) {
    console.log(`[TEST] Frame ${i}: ${frames[i].length}B hex: ${frames[i].slice(0, 8).toString('hex')}`);
  }

  // 4. Decode first frame back to PCM
  const decoder = new OpusScript(16000, 1, OpusScript.Application.AUDIO);
  const decoded = decoder.decode(frames[0], FRAME_SIZE);
  console.log(`[TEST] Decoded frame 0: ${decoded?.length || 0} samples`);
  if (decoded && decoded.length > 0) {
    const dSamples = new Int16Array(decoded.buffer, decoded.byteOffset, Math.min(20, decoded.length));
    console.log('[TEST] Decoded head20:', Array.from(dSamples));
  }

  // 5. Verify all frames are non-empty
  const allValid = frames.every(f => f.length > 2); // Opus frame > 2 bytes for valid encoding
  console.log(`[TEST] All frames valid: ${allValid}`);

  // 6. Save combined Opus to file
  const combined = Buffer.concat(frames);
  const opusPath = join(TEMP, 'test-output.opus');
  writeFileSync(opusPath, combined);
  console.log(`[TEST] Saved ${combined.length}B Opus to ${opusPath}`);

  // 7. Verify saved WAV exists and is playable
  if (result.wavPath && existsSync(result.wavPath)) {
    const wavCheck = readFileSync(result.wavPath);
    console.log(`[TEST] Saved WAV: ${wavCheck.length}B at ${result.wavPath}`);
  }

  console.log('[TEST] ✅ Pipeline test complete!');
  encoder.delete?.();
  decoder.delete?.();
}

main().catch(err => {
  console.error('[TEST] ❌ FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
