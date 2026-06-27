/**
 * STT (语音转文字) + TTS (文字转语音) 服务
 * 
 * Electron 环境下使用 Web Speech API
 * 也支持 Edge TTS 作为高质量中文备选
 */

import { EventEmitter } from 'events';

// ==================== STT (Speech-to-Text) ====================

export class SttService extends EventEmitter {
  private recognition: any = null;
  private isListening = false;
  private finalText = '';

  constructor() {
    super();
    this.initRecognition();
  }

  private initRecognition() {
    try {
      const SpeechRecognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;

      if (!SpeechRecognition) {
        console.warn('Web Speech API 不可用');
        return;
      }

      this.recognition = new SpeechRecognition();
      this.recognition.lang = 'zh-CN';
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;

      this.recognition.onresult = (event: any) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            final += result[0].transcript;
          } else {
            interim += result[0].transcript;
          }
        }
        this.finalText += final;
        this.emit('result', { final: this.finalText, interim });
      };

      this.recognition.onerror = (event: any) => {
        console.error('STT 错误:', event.error);
        this.emit('error', event.error);
      };

      this.recognition.onend = () => {
        if (this.isListening) {
          // 自动重启
          try {
            this.recognition.start();
          } catch {
            this.isListening = false;
          }
        } else {
          this.emit('end', this.finalText);
        }
      };
    } catch (e) {
      console.error('初始化 STT 失败:', e);
    }
  }

  start() {
    if (!this.recognition) {
      this.emit('error', 'STT 不可用');
      return;
    }
    this.finalText = '';
    this.isListening = true;
    try {
      this.recognition.start();
      this.emit('start');
    } catch (e: any) {
      console.error('STT 启动失败:', e);
      this.emit('error', e.message);
    }
  }

  stop(): string {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
    }
    const text = this.finalText;
    this.finalText = '';
    return text;
  }

  isAvailable(): boolean {
    return !!this.recognition;
  }
}

// ==================== TTS (Text-to-Speech) ====================

export class TtsService extends EventEmitter {
  private synth: SpeechSynthesis;
  private speaking = false;

  constructor() {
    super();
    this.synth = window.speechSynthesis;
  }

  /**
   * 使用 Web Speech API 朗读文字
   */
  speak(text: string, options?: { rate?: number; pitch?: number; voice?: string }): Promise<void> {
    return new Promise((resolve) => {
      // 取消当前朗读
      this.synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = options?.rate || 1.0;
      utterance.pitch = options?.pitch || 1.0;

      // 尝试选择中文语音
      const voices = this.synth.getVoices();
      const zhVoice = voices.find(
        (v) => v.lang.startsWith('zh') && v.name.includes('Microsoft')
      );
      if (zhVoice) {
        utterance.voice = zhVoice;
      }

      utterance.onstart = () => {
        this.speaking = true;
        this.emit('start');
      };

      utterance.onend = () => {
        this.speaking = false;
        this.emit('end');
        resolve();
      };

      utterance.onerror = (e) => {
        this.speaking = false;
        console.error('TTS 错误:', e);
        this.emit('error', e);
        resolve();
      };

      this.synth.speak(utterance);
    });
  }

  stop() {
    this.synth.cancel();
    this.speaking = false;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }
}

// ==================== Edge TTS (高质量中文备选) ====================

/**
 * 使用 Microsoft Edge TTS API (免费)
 * 中文语音质量更好
 */
export async function edgeTts(
  text: string,
  voice: string = 'zh-CN-XiaoxiaoNeural'
): Promise<ArrayBuffer> {
  const endpoint = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4`;

  const ssml = `
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
      <voice name="${voice}">
        <prosody rate="0%" pitch="0%">
          ${text}
        </prosody>
      </voice>
    </speak>`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-16khz-32kbitrate-mono-mp3',
      'User-Agent': 'Mozilla/5.0',
      Origin: 'https://www.bing.com',
    },
    body: ssml,
  });

  if (!response.ok) {
    throw new Error(`Edge TTS 错误: ${response.status}`);
  }

  return response.arrayBuffer();
}

/**
 * PCM 音频生成简单提示音 (蜂鸣声)
 */
export function generateBeepTone(
  durationMs: number = 200,
  frequency: number = 880,
  sampleRate: number = 16000
): Buffer {
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const buffer = Buffer.alloc(numSamples * 2); // 16bit

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.3 * 32767;
    buffer.writeInt16LE(Math.floor(sample), i * 2);
  }

  return buffer;
}
