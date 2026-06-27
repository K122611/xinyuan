const https = require('https');

const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="zh-CN-XiaoxiaoNeural">你好世界</voice></speak>`;

const opts = {
  hostname: 'speech.platform.bing.com',
  path: '/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4',
  method: 'POST',
  headers: {
    'Content-Type': 'application/ssml+xml',
    'X-Microsoft-OutputFormat': 'riff-16khz-16bit-mono-pcm',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Origin': 'https://www.bing.com',
    'Content-Length': Buffer.byteLength(ssml)
  }
};

console.log('Sending request...');
const req = https.request(opts, (res) => {
  console.log('STATUS:', res.statusCode);
  console.log('Headers:', JSON.stringify(res.headers));
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    const buf = Buffer.concat(chunks);
    console.log('Response size:', buf.length, 'bytes');
    // Save as WAV
    const fs = require('fs');
    fs.writeFileSync('test-tts-output.wav', buf);
    console.log('Saved to test-tts-output.wav');
    // PCM data starts after 44-byte WAV header
    if (buf.length > 44) {
      const pcm = buf.slice(44);
      const duration = pcm.length / (16000 * 2);
      console.log('PCM data:', pcm.length, 'bytes, duration:', duration.toFixed(2), 's');
    }
  });
});
req.on('error', e => console.error('Request error:', e.message));
req.on('timeout', () => { console.error('TIMEOUT'); req.destroy(); });
req.setTimeout(15000);
req.write(ssml);
req.end();
