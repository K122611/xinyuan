/**
 * 音频桥接集成 Hook
 * 
 * 在渲染进程中监听主进程的 Coze 请求，
 * 调用现有 Coze API 处理语音转文字后的对话
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { sendCozeMessage } from './cozeApi';
import { useAppStore } from '../store';

interface AudioBridgeState {
  connected: boolean;
  status: string;
  audioLevel: number;
  lastUserSpeech: string;
  lastAiResponse: string;
}

export function useAudioBridge() {
  const [state, setState] = useState<AudioBridgeState>({
    connected: false,
    status: '未连接',
    audioLevel: 0,
    lastUserSpeech: '',
    lastAiResponse: '',
  });

  const cleanupRef = useRef<(() => void)[]>([]);
  const settings = useAppStore((s) => s.settings);

  const connect = useCallback(async () => {
    if (typeof window === 'undefined' || !(window as any).audioBridgeAPI) {
      setState((s) => ({ ...s, status: 'API 不可用 (非 Electron 环境)' }));
      return false;
    }
    const result = await (window as any).audioBridgeAPI.connect();
    return result;
  }, []);

  const disconnect = useCallback(async () => {
    if (!(window as any).audioBridgeAPI) return;
    await (window as any).audioBridgeAPI.disconnect();
  }, []);

  const sendText = useCallback(async (text: string) => {
    if (!(window as any).audioBridgeAPI) return '';
    return await (window as any).audioBridgeAPI.sendText(text);
  }, []);

  useEffect(() => {
    const api = (window as any).audioBridgeAPI;
    if (!api) return;

    // 状态监听
    const unsubStatus = api.onStatus((msg: string) => {
      setState((s) => ({ ...s, status: msg }));
    });

    // 音量监听
    const unsubLevel = api.onAudioLevel((level: number) => {
      setState((s) => ({ ...s, audioLevel: level }));
    });

    // Coze 请求处理 (ESP32语音 → Coze AI)
    const unsubCoze = api.onCozeRequest(async (text: string) => {
      setState((s) => ({ ...s, lastUserSpeech: text }));

      try {
        const { cozeToken, cozeBotId, userName } =
          useAppStore.getState().settings;

        if (!cozeToken || !cozeBotId) {
          setState((s) => ({
            ...s,
            lastAiResponse: '请先配置 Coze API',
          }));
          return '请先配置 Coze API';
        }

        // 调用非流式 Coze API
        const result = await sendCozeMessage(
          cozeToken,
          cozeBotId,
          userName || '用户',
          text
        );

        setState((s) => ({ ...s, lastAiResponse: result.content }));
        return result.content;
      } catch (e: any) {
        const errMsg = `AI 响应失败: ${e.message}`;
        setState((s) => ({ ...s, lastAiResponse: errMsg }));
        return errMsg;
      }
    });

    // 连接状态
    const checkStatus = async () => {
      try {
        const s = await api.getStatus();
        setState((prev) => ({ ...prev, connected: s.connected }));
      } catch {}
    };
    checkStatus();
    const interval = setInterval(checkStatus, 3000);

    cleanupRef.current = [unsubStatus, unsubLevel, unsubCoze, () => clearInterval(interval)];

    return () => {
      cleanupRef.current.forEach((fn) => fn());
    };
  }, []);

  return { ...state, connect, disconnect, sendText };
}

/**
 * 列出可用串口
 */
export async function listAudioPorts() {
  if (!(window as any).audioBridgeAPI) return [];
  return await (window as any).audioBridgeAPI.listPorts();
}
