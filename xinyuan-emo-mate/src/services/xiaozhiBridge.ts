/**
 * 小智 AI 桥接服务 — 渲染进程端
 *
 * 封装与 Electron 主进程中 XiaozhiBridge 的通信，
 * 提供设备管理、拍照、MCP 工具调用等功能。
 */

// ==================== 类型声明 ====================

export interface XiaozhiDevice {
  sessionId: string;
  features: Record<string, any>;
  state: string;
  connectedAt: string;
  ip: string;
}

export interface XiaozhiStatus {
  running: boolean;
  port: number;
  deviceCount: number;
  devices: XiaozhiDevice[];
}

export interface DeviceEvent {
  event: string;
  sessionId: string;
  features: Record<string, any>;
  state: string;
  ip: string;
  data?: any;
}

export interface PhotoResult {
  imageBase64?: string;
  imageUrl?: string;
  mimeType?: string;
  error?: string;
}

interface XiaozhiAPI {
  start(): Promise<{ port: number; status: string; error?: string }>;
  stop(): Promise<{ status: string }>;
  getStatus(): Promise<XiaozhiStatus>;
  sendToDevice(sessionId: string, message: any): Promise<boolean>;
  broadcast(message: any): Promise<number>;
  takePhoto(sessionId: string): Promise<PhotoResult>;
  setVolume(sessionId: string, volume: number): Promise<string>;
  setBrightness(sessionId: string, brightness: number): Promise<string>;
  ttsSpeak(sessionId: string, text: string): Promise<string>;
  sendMCPToolCall(sessionId: string, toolName: string, args?: any): Promise<string>;
  onDeviceEvent(callback: (data: DeviceEvent) => void): () => void;
}

declare global {
  interface Window {
    xiaozhiAPI: XiaozhiAPI;
  }
}

// ==================== API 获取 ====================

function getAPI(): XiaozhiAPI | null {
  if (typeof window !== 'undefined' && window.xiaozhiAPI) {
    return window.xiaozhiAPI;
  }
  return null;
}

// ==================== 服务器控制 ====================

/**
 * 启动小智桥接服务器（默认端口 8888）
 */
export async function startBridge(): Promise<{ port: number; status: string; error?: string }> {
  const api = getAPI();
  if (!api) return { port: 0, status: 'unavailable', error: '非 Electron 环境' };
  try {
    return await api.start();
  } catch (err: any) {
    return { port: 0, status: 'error', error: err.message };
  }
}

/**
 * 停止小智桥接服务器
 */
export async function stopBridge(): Promise<{ status: string }> {
  const api = getAPI();
  if (!api) return { status: 'unavailable' };
  return await api.stop();
}

/**
 * 获取桥接服务器完整状态
 */
export async function getBridgeStatus(): Promise<XiaozhiStatus> {
  const api = getAPI();
  if (!api) return { running: false, port: 0, deviceCount: 0, devices: [] };
  return await api.getStatus();
}

// ==================== 设备操作 ====================

/**
 * 拍照 — 调用小智设备摄像头
 */
export async function takePhoto(sessionId: string): Promise<PhotoResult> {
  const api = getAPI();
  if (!api) return { error: '非 Electron 环境' };
  return await api.takePhoto(sessionId);
}

/**
 * 设置设备音量 (0-100)
 */
export async function setVolume(sessionId: string, volume: number): Promise<string> {
  const api = getAPI();
  if (!api) return '';
  return await api.setVolume(sessionId, volume);
}

/**
 * 设置屏幕亮度 (0-100)
 */
export async function setBrightness(sessionId: string, brightness: number): Promise<string> {
  const api = getAPI();
  if (!api) return '';
  return await api.setBrightness(sessionId, brightness);
}

/**
 * TTS 语音播报
 */
export async function ttsSpeak(sessionId: string, text: string): Promise<string> {
  const api = getAPI();
  if (!api) return '';
  return await api.ttsSpeak(sessionId, text);
}

/**
 * 发送自定义 MCP 工具调用
 */
export async function sendMCPToolCall(
  sessionId: string,
  toolName: string,
  args?: any,
): Promise<string> {
  const api = getAPI();
  if (!api) return '';
  return await api.sendMCPToolCall(sessionId, toolName, args);
}

/**
 * 发送 JSON 消息到指定设备
 */
export async function sendToDevice(sessionId: string, message: any): Promise<boolean> {
  const api = getAPI();
  if (!api) return false;
  return await api.sendToDevice(sessionId, message);
}

// ==================== 事件监听 ====================

/**
 * 监听设备事件（连接/断开/状态变更）
 * 返回取消监听的函数
 */
export function onDeviceEvent(callback: (data: DeviceEvent) => void): () => void {
  const api = getAPI();
  if (!api) return () => {};
  return api.onDeviceEvent(callback);
}

// ==================== 便捷方法 ====================

/**
 * 向设备发送情绪状态（情绪标签映射为设备动作）
 * 可用 MCP 工具：self.screen.set_emotion, self.led.set_color 等
 */
export async function sendEmotion(sessionId: string, emotion: string): Promise<void> {
  const api = getAPI();
  if (!api) return;

  // 情绪 → 屏幕表情映射
  const emotionToExpression: Record<string, string> = {
    happy: '^_^', joy: '^_^', excited: '*o*', grateful: ':D', love: '<3',
    calm: ': )', relaxed: ': )', peaceful: ': )', content: ': )', satisfied: ': )',
    neutral: ':| ', surprised: 'O_O',
    sad: ';( ', low: ';_;', lonely: '._.', disappointed: '-_-',
    anxious: '>_<', worried: 'o_o',
    angry: '#_#', frustrated: '>:( ',
    bored: '-_-', tired: '(-_-)',
  };

  const expression = emotionToExpression[emotion.toLowerCase()] || emotion;
  await api.sendMCPToolCall(sessionId, 'self.screen.set_emotion', { expression });
}
