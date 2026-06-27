/**
 * 语音对话 Hook (PC 麦克风 + 扬声器模式)
 *
 * 完整链路: 麦克风 → STT → Coze AI → TTS
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  initSpeechRecognition,
  startListening,
  stopListening,
  setSpeaking,
  isSpeechRecognitionSupported,
  type VoiceChatState,
} from './pcVoiceInput';
import { sendCozeMessage } from './cozeApi';
import { useAppStore } from '../store';

export interface VoiceChatHook {
  /** 当前状态 */
  state: VoiceChatState;
  /** 是否支持语音识别 */
  supported: boolean;
  /** 最后识别到的文字 */
  lastUserSpeech: string;
  /** 最后的 AI 回复 */
  lastAiResponse: string;
  /** 开始语音对话 */
  startVoice: () => void;
  /** 停止语音对话 */
  stopVoice: () => void;
  /** 切换语音对话 */
  toggleVoice: () => void;
}

export function useVoiceChat(): VoiceChatHook {
  const [state, setState] = useState<VoiceChatState>('idle');
  const [lastUserSpeech, setLastUserSpeech] = useState('');
  const [lastAiResponse, setLastAiResponse] = useState('');
  const [supported, setSupported] = useState(false);

  const settings = useAppStore((s) => s.settings);
  const initializedRef = useRef(false);

  // 初始化语音识别
  useEffect(() => {
    setSupported(isSpeechRecognitionSupported());

    if (!initializedRef.current && isSpeechRecognitionSupported()) {
      initializedRef.current = true;

      const handleResult = async (text: string) => {
        setLastUserSpeech(text);
        setState('thinking');

        try {
          const { cozeToken, cozeBotId, userName } =
            useAppStore.getState().settings;

          if (!cozeToken || !cozeBotId) {
            setLastAiResponse('请先在设置中配置 Coze API');
            setState('idle');
            return;
          }

          const result = await sendCozeMessage(
            cozeToken,
            cozeBotId,
            userName || '用户',
            text
          );

          setLastAiResponse(result.content);

          // TTS 播报
          if (result.content && 'speechSynthesis' in window) {
            setState('speaking');
            setSpeaking(true);

            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(result.content);
            const voices = window.speechSynthesis.getVoices();
            const zhVoice = voices.find((v) => v.lang.startsWith('zh-CN'))
              || voices.find((v) => v.lang.startsWith('zh'));
            if (zhVoice) utterance.voice = zhVoice;
            utterance.rate = 0.95;
            utterance.pitch = 1.0;

            utterance.onend = () => {
              setSpeaking(false);
              // 自动回到聆听状态
              setState('listening');
              // 重新开始语音识别
              try {
                startListening();
              } catch (e) {}
            };

            utterance.onerror = () => {
              setSpeaking(false);
              setState('listening');
              try {
                startListening();
              } catch (e) {}
            };

            window.speechSynthesis.speak(utterance);
          } else {
            // 无 TTS，回到聆听
            setState('listening');
            try {
              startListening();
            } catch (e) {}
          }
        } catch (e: any) {
          console.error('[VoiceChat] Coze 失败:', e.message);
          setLastAiResponse('AI 响应失败: ' + e.message);
          setState('listening');
          try {
            startListening();
          } catch (e) {}
        }
      };

      const handleState = (newState: VoiceChatState) => {
        setState(newState);
      };

      initSpeechRecognition(handleResult, handleState);
    }

    return () => {
      stopListening();
    };
  }, []);

  const startVoice = useCallback(() => {
    if (!initializedRef.current) return;
    startListening();
  }, []);

  const stopVoice = useCallback(() => {
    stopListening();
  }, []);

  const toggleVoice = useCallback(() => {
    if (state === 'idle' || state === 'error') {
      startVoice();
    } else {
      stopVoice();
    }
  }, [state, startVoice, stopVoice]);

  return {
    state,
    supported,
    lastUserSpeech,
    lastAiResponse,
    startVoice,
    stopVoice,
    toggleVoice,
  };
}
