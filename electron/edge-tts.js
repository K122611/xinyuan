/**
 * TTS 模块 (Node.js 主进程)
 *
 * 使用 Electron 渲染进程的 Web Speech API (window.speechSynthesis)
 * 通过 IPC 发送文字到渲染进程，渲染进程执行语音合成
 * 这是完全免费、离线可用的方案
 */

import { BrowserWindow, ipcMain } from 'electron';

/**
 * 通过渲染进程 Web Speech API 朗读文字
 * 返回 Promise<{pcm, duration}> 但实际会通过事件通知
 */
export async function speechToPcm16(text, voice = null) {
  if (!text || text.trim().length === 0) {
    return { pcm: Buffer.alloc(0), duration: 0 };
  }

  return new Promise((resolve, reject) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) {
      console.warn('[TTS] 无可用窗口，回退到静音');
      resolve(generateSilence(2000));
      return;
    }

    // 发送 TTS 请求到渲染进程
    const requestId = `tts_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const timeout = setTimeout(() => {
      console.warn('[TTS] 超时，使用静音回退');
      resolve(generateSilence(3000));
    }, 15000);

    const handler = (_event, data) => {
      if (data.requestId === requestId) {
        clearTimeout(timeout);
        resolve({
          pcm: data.pcm ? Buffer.from(data.pcm) : Buffer.alloc(0),
          duration: data.duration || 0,
          sampleRate: 16000,
          channels: 1,
          bitDepth: 16,
        });
      }
    };

    // 监听渲染进程的 TTS 完成事件
    ipcMain.once('audio-bridge:tts-complete', handler);

    win.webContents.send('audio-bridge:tts-speak', { text, requestId });
  });
}

/**
 * 生成静默 PCM (回退方案)
 */
function generateSilence(durationMs = 2000) {
  const sampleRate = 16000;
  const samples = Math.floor(sampleRate * (durationMs / 1000));
  const buf = Buffer.alloc(samples * 2, 0);
  return {
    pcm: buf,
    duration: durationMs / 1000,
    sampleRate,
    channels: 1,
    bitDepth: 16,
  };
}

// 语音偏好
const VOICES = {
  xiaoxiao: 'zh-CN-XiaoxiaoNeural', // 女声，温柔
  yunxi: 'zh-CN-YunxiNeural',      // 男声，年轻
  xiaoyi: 'zh-CN-XiaoyiNeural',    // 女声，活泼
  yunyang: 'zh-CN-YunyangNeural',  // 男声，新闻播报
};

export { VOICES };
