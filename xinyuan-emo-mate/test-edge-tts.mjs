import { EdgeTTS } from 'edge-tts';

async function main() {
  console.log('Testing edge-tts...');
  const tts = new EdgeTTS({
    voice: 'zh-CN-XiaoxiaoNeural',
    lang: 'zh-CN',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
  });

  try {
    const buf = await tts.toBuffer('你好，我是心元');
    console.log('OK! Buffer size:', buf.length, 'bytes');
    console.log('First 4 bytes:', buf[0], buf[1], buf[2], buf[3]);
  } catch(e) {
    console.error('FAIL:', e.message);
  }
}

main();
