/**
 * PC麦克风语音输入服务
 *
 * 使用 Web Speech API (SpeechRecognition) 做语音转文字
 * 使用 Web Audio API (getUserMedia) 捕获麦克风
 * 完整链路: 麦克风 → STT → Coze AI → TTS(speechSynthesis)
 */

let recognition: any = null;
let isListening = false;
let onResultCallback: ((text: string) => void) | null = null;
let onStateCallback: ((state: VoiceChatState) => void) | null = null;

export type VoiceChatState =
  | 'idle'        // 空闲
  | 'listening'   // 聆听中
  | 'thinking'    // 思考中 (Coze 处理)
  | 'speaking'    // 语音回复中
  | 'error';      // 错误

let currentState: VoiceChatState = 'idle';

function setState(state: VoiceChatState) {
  currentState = state;
  onStateCallback?.(state);
}

/**
 * 检查浏览器是否支持语音识别
 */
export function isSpeechRecognitionSupported(): boolean {
  return !!(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition
  );
}

/**
 * 初始化语音识别
 */
export function initSpeechRecognition(
  onResult: (text: string) => void,
  onState: (state: VoiceChatState) => void
) {
  onResultCallback = onResult;
  onStateCallback = onState;

  const SpeechRecognition =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('[STT] SpeechRecognition 不可用');
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onresult = (event: any) => {
    const transcript = event.results[0][0].transcript;
    console.log('[STT] 识别结果:', transcript);
    setState('thinking');
    onResultCallback?.(transcript);
  };

  recognition.onerror = (event: any) => {
    console.error('[STT] 识别错误:', event.error);
    if (event.error === 'no-speech') {
      // 没有检测到语音，重新开始监听
      if (isListening) {
        try { recognition.start(); } catch (e) {}
        return;
      }
    }
    setState('error');
    onStateCallback?.('error');
  };

  recognition.onend = () => {
    console.log('[STT] 识别会话结束, isListening:', isListening);
    if (isListening) {
      // 自动重新开始监听
      setTimeout(() => {
        if (isListening) {
          try { recognition.start(); } catch (e) {}
        }
      }, 300);
    } else {
      setState('idle');
    }
  };

  return true;
}

/**
 * 开始聆听
 */
export function startListening() {
  if (!recognition) {
    console.warn('[STT] 未初始化');
    return false;
  }

  isListening = true;
  setState('listening');

  try {
    recognition.start();
    console.log('[STT] 开始聆听...');
    return true;
  } catch (e: any) {
    console.error('[STT] 启动失败:', e.message);
    setState('error');
    return false;
  }
}

/**
 * 停止聆听
 */
export function stopListening() {
  isListening = false;
  setState('idle');
  try {
    recognition?.stop();
  } catch (e) {}
}

/**
 * 标记语音播报状态
 */
export function setSpeaking(isSpeaking: boolean) {
  if (isSpeaking) {
    setState('speaking');
  } else if (isListening) {
    setState('listening');
  } else {
    setState('idle');
  }
}

/**
 * 获取当前状态
 */
export function getVoiceState(): VoiceChatState {
  return currentState;
}
