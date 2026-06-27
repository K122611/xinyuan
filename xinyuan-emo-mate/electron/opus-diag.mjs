/**
 * Opus 编码回环诊断
 */
import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const OpusScript = require('opusscript');

process.on('uncaughtException', e => { console.error('CRASH:', e.message, e.stack); process.exit(1); });

const SR = 16000, FS = 960;
const VOIP = OpusScript.Application.VOIP;
const AUDIO = OpusScript.Application.AUDIO;
const wavPath = process.argv[2] || 'C:\\Users\\LENOVO\\AppData\\Local\\Temp\\sapi_diag_1782555722076.wav';

console.log('Step 1: Reading WAV...');
const buf = readFileSync(wavPath);
console.log('  size:', buf.length);

console.log('Step 2: Parsing WAV...');
let off = 12, dataOff = -1, dataSize = 0;
while (off < buf.length - 8) {
  const id = String.fromCharCode(...buf.subarray(off, off + 4));
  const sz = buf.readUInt32LE(off + 4);
  console.log('  chunk:', JSON.stringify(id), sz);
  if (id === 'data') { dataOff = off + 8; dataSize = sz; break; }
  off += 8 + sz;
}
if (dataOff < 0) { console.error('No data chunk!'); process.exit(1); }

console.log('Step 3: Extracting PCM...');
const pcmLen = Math.floor(dataSize / 2);
const pcm = new Int16Array(pcmLen);
for (let i = 0; i < pcmLen; i++) pcm[i] = buf.readInt16LE(dataOff + i * 2);
console.log('  samples:', pcmLen, 'duration:', (pcmLen/SR).toFixed(1)+'s');

console.log('Step 4: Creating VOIP encoder (32kbps CBR)...');
const encoder = new OpusScript(SR, 1, VOIP);
encoder.setBitrate(32000);
try { encoder.encoderCTL(4010, 10); } catch(e) { console.log('CTL4010 failed:', e.message); }
try { encoder.encoderCTL(4006, 0); } catch(e) { console.log('CTL4006 failed:', e.message); }

console.log('Step 5: Encoding all frames...');
const frames = [];
for (let off = 0; off + FS <= pcm.length; off += FS) {
  const chunk = pcm.subarray(off, off + FS);
  const enc = encoder.encode(chunk, FS);
  if (enc && enc.length > 0) {
    frames.push(Buffer.from(enc.slice()));
  }
}
{
  const lens = frames.map(f => f.length);
  console.log('  frames:', frames.length, 'min:', Math.min(...lens), 'max:', Math.max(...lens), 'unique sizes:', new Set(lens).size);
  console.log('  Frame0[0..7]:', frames[0].slice(0,8).toString('hex'));
}

console.log('Step 6: Creating AUDIO decoder...');
const decoder = new OpusScript(SR, 1, AUDIO);
{
  const s = new Int16Array(FS);
  const e = decoder.encode(s, FS);
  decoder.decode(e, FS);
  console.log('  decoder primed');
}

console.log('Step 7: Decoding all frames...');
const out = [];
for (const f of frames) {
  const dec = decoder.decode(f, FS);
  if (dec && dec.length >= FS * 2) {
    const s = new Int16Array(dec.buffer, dec.byteOffset, Math.floor(dec.byteLength / 2));
    for (let j = 0; j < FS; j++) out.push(s[j]);
  }
}
console.log('  decoded samples:', out.length);

console.log('Step 8: Saving WAV...');
const pcmOut = new Int16Array(out);
const dataLen = pcmOut.length * 2;
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + dataLen, 4);
hdr.write('WAVE', 8); hdr.write('fmt ', 12);
hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 2, 28);
hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
hdr.write('data', 36); hdr.writeUInt32LE(dataLen, 40);
const pcmBuf = Buffer.alloc(dataLen);
for (let i = 0; i < pcmOut.length; i++) pcmBuf.writeInt16LE(pcmOut[i], i * 2);
writeFileSync('opus_roundtrip_test.wav', Buffer.concat([hdr, pcmBuf]));
console.log('  Saved: opus_roundtrip_test.wav');

console.log('Step 9: SNR calculation...');
const n = Math.min(pcm.length, out.length);
let sumO = 0, sumE = 0, peakE = 0;
for (let i = 0; i < n; i++) {
  sumO += pcm[i] * pcm[i];
  const e = Math.abs(pcm[i] - out[i]);
  sumE += e * e;
  if (e > peakE) peakE = e;
}
const rmsO = Math.sqrt(sumO / n);
const rmsE = Math.sqrt(sumE / n);
const snr = 20 * Math.log10(rmsO / (rmsE || 0.001));
console.log('  SNR:', snr.toFixed(1), 'dB, peakErr:', peakE);

encoder.delete();
decoder.delete();
console.log('DONE! Play opus_roundtrip_test.wav to verify quality.');
