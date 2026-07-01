import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

// ====== 主进程日志转发到 F12 Console ======
// 劫持 main:log IPC 消息 → 打印到渲染进程 DevTools
(function setupMainLogForwarding() {
  if ((window as any).mainLogAPI?.onLog) {
    (window as any).mainLogAPI.onLog((data: any) => {
      const { level, msg, timestamp } = data;
      const prefix = `[Main ${level.toUpperCase()}]`;
      if (level === 'error') console.error(prefix, msg);
      else if (level === 'warn') console.warn(prefix, msg);
      else console.log(prefix, msg);
    });
    console.log('[Renderer] ✅ 主进程日志转发已就绪 (F12可见)');
  }
})();

// ====== Web Speech API TTS 初始化 ======
// 主进程通过 IPC 发送 TTS 请求，渲染进程用 speechSynthesis 合成语音
if (window.audioBridgeAPI?.onTtsRequest) {
  window.audioBridgeAPI.onTtsRequest((text: string, requestId: string) => {
    console.log('[TTS Renderer] 收到播报请求:', text.slice(0, 50));

    if (!('speechSynthesis' in window)) {
      console.warn('[TTS Renderer] speechSynthesis 不可用');
      window.audioBridgeAPI?.sendTtsResult(requestId, new ArrayBuffer(0));
      return;
    }

    window.speechSynthesis.cancel();

    // 选择中文语音
    const voices = window.speechSynthesis.getVoices();
    const zhVoice = voices.find((v: SpeechSynthesisVoice) =>
      v.lang.startsWith('zh-CN')
    ) || voices.find((v: SpeechSynthesisVoice) =>
      v.lang.startsWith('zh')
    );

    const utterance = new SpeechSynthesisUtterance(text);
    if (zhVoice) utterance.voice = zhVoice;
    utterance.rate = 0.95;
    utterance.pitch = 1.0;

    utterance.onend = () => {
      console.log('[TTS Renderer] 播报完成');
      window.audioBridgeAPI?.sendTtsResult(requestId, new ArrayBuffer(0));
    };

    utterance.onerror = (e) => {
      console.error('[TTS Renderer] 播报错误:', e.error);
      window.audioBridgeAPI?.sendTtsResult(requestId, new ArrayBuffer(0));
    };

    window.speechSynthesis.speak(utterance);
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
