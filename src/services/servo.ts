/**
 * 舵机服务 — 渲染进程端
 *
 * 情绪 → 行为映射：
 *   平和/中性   → 呼吸摆动 30°↔150°, 周期 4s（缓慢温柔）
 *   轻微低落    → 呼吸摆动 30°↔150°, 周期 2s（稍快）
 *   开心/兴奋   → 呼吸摆动 120°↔180°, 周期 5s（高位轻摆）
 *   悲伤        → 呼吸摆动  0°↔40°,  周期 2.5s（低位）
 *   愤怒        → 静态 0°（僵硬）
 *   困惑        → 呼吸摆动 30°↔120°, 周期 3s
 *   其他        → 静态对应角度
 */

// ==================== 类型声明 ====================

export interface BreatheConfig {
  minAngle: number;
  maxAngle: number;
  periodMs: number; // 完整周期毫秒（越小越快）
}

interface ServoAPI {
  connect(port?: string): Promise<{ success: boolean; message: string; port?: string }>;
  disconnect(): Promise<{ success: boolean; message: string }>;
  getStatus(): Promise<{ connected: boolean, breathing: boolean, breatheConfig: BreatheConfig | null }>;
  setAngle(angle: number): Promise<{ success: boolean; angle: number }>;
  setAngleImmediate(angle: number): Promise<{ success: boolean; angle: number }>;
  startBreathing(cfg: BreatheConfig): Promise<{ success: boolean }>;
  stopBreathing(): Promise<{ success: boolean }>;
  listPorts(): Promise<{ success: boolean; ports: Array<{ path: string; manufacturer: string; productId: string; serialNumber: string }> }>;
}

declare global {
  interface Window {
    servoAPI: ServoAPI;
    supabaseAPI: { getConfig(): Promise<{ supabaseUrl: string; supabaseAnonKey: string }> };
  }
}

// ==================== 情绪→呼吸配置映射 ====================

const EMOTION_BREATHE_MAP: Record<string, BreatheConfig> = {
  // 平和状态 — 缓慢轻摆
  peaceful:  { minAngle: 30, maxAngle: 150, periodMs: 4000 },
  neutral:   { minAngle: 30, maxAngle: 150, periodMs: 4000 },
  calm:      { minAngle: 30, maxAngle: 150, periodMs: 4000 },
  relaxed:   { minAngle: 30, maxAngle: 150, periodMs: 4000 },

  // 轻微低落 — 摆动更快
  sad:        { minAngle:  0, maxAngle:  40, periodMs: 2000 },
  low:        { minAngle: 30, maxAngle: 150, periodMs: 2000 },
  lonely:     { minAngle:  0, maxAngle:  40, periodMs: 2500 },
  disappointed:{ minAngle: 0, maxAngle:  40, periodMs: 2000 },

  // 开心/兴奋 — 高位轻摆
  happy:      { minAngle: 120, maxAngle: 180, periodMs: 5000 },
  joy:        { minAngle: 120, maxAngle: 180, periodMs: 5000 },
  excited:    { minAngle: 130, maxAngle: 180, periodMs: 3000 },
  love:       { minAngle: 120, maxAngle: 180, periodMs: 5000 },
  grateful:   { minAngle: 120, maxAngle: 180, periodMs: 5000 },

  // 满意 — 中高位轻摆
  content:    { minAngle: 100, maxAngle: 160, periodMs: 4500 },
  satisfied:  { minAngle: 100, maxAngle: 160, periodMs: 4500 },

  // 困惑 — 中位摆动
  confused:   { minAngle:  30, maxAngle: 120, periodMs: 3000 },
  surprised:  { minAngle:  60, maxAngle: 150, periodMs: 3500 },

  // 焦虑/担忧 — 中低位快摆
  anxious:    { minAngle:  20, maxAngle:  80, periodMs: 1500 },
  worried:    { minAngle:  20, maxAngle:  80, periodMs: 1500 },

  // 愤怒/沮丧 — 僵硬不动（但留少量微摆）
  angry:      { minAngle:   0, maxAngle:  20, periodMs: 1000 },
  frustrated: { minAngle:   0, maxAngle:  30, periodMs: 1200 },

  // 无聊/疲惫 — 低位慢摆
  bored:      { minAngle:  40, maxAngle: 100, periodMs: 5000 },
  tired:      { minAngle:  40, maxAngle: 100, periodMs: 5000 },
};

// ==================== 静态角度映射（回退用） ====================

const EMOTION_ANGLE_MAP: Record<string, number> = {
  happy: 180, joy: 180, excited: 160,
  grateful: 145, love: 145, content: 130,
  satisfied: 130, calm: 110, relaxed: 110,
  neutral: 90, peaceful: 90, surprised: 100,
  bored: 60, tired: 55, confused: 45,
  anxious: 35, worried: 30, sad: 20,
  lonely: 15, angry: 0, frustrated: 5,
  disappointed: 10,
};

// ==================== 服务状态 ====================

let connected = false;
let breathing = false;
let connectionPromise: Promise<boolean> | null = null;
let currentEmotion = '';
let selectedPort = '';

function getAPI(): ServoAPI | null {
  if (typeof window !== 'undefined' && window.servoAPI) {
    return window.servoAPI;
  }
  return null;
}

/**
 * 扫描可用串口列表
 */
export async function listPorts(): Promise<Array<{ path: string; manufacturer: string; productId: string; serialNumber: string }>> {
  const api = getAPI();
  if (!api) return [];
  const result = await api.listPorts();
  return result.success ? result.ports : [];
}

/**
 * 指定端口并连接
 */
export async function connectWithPort(portPath: string): Promise<{ success: boolean; message: string }> {
  const api = getAPI();
  if (!api) return { success: false, message: '非 Electron 环境' };

  if (connected) return { success: true, message: '已连接' };
  if (connectionPromise) {
    const ok = await connectionPromise;
    return { success: ok, message: ok ? '已连接' : '连接失败' };
  }

  selectedPort = portPath;
  connectionPromise = (async () => {
    try {
      const result = await api.connect(portPath);
      connected = result.success;
      if (result.success) {
        console.log('[ServoService] ✅ 已连接:', result.port || portPath);
        await api.setAngleImmediate(90);
        const mood = currentEmotion || 'calm';
        currentEmotion = mood;
        await applyEmotionBreathing(mood);
      }
      return connected;
    } catch (err) {
      console.error('[ServoService] 连接异常:', err);
      connected = false;
      return false;
    } finally {
      connectionPromise = null;
    }
  })();

  const ok = await connectionPromise;
  return { success: ok, message: ok ? '已连接' : '连接失败' };
}

// ==================== 连接管理 ====================

export async function connect(): Promise<{ success: boolean; message: string }> {
  if (selectedPort) return connectWithPort(selectedPort);

  const api = getAPI();
  if (!api) return { success: false, message: '非 Electron 环境' };

  if (connected) return { success: true, message: '已连接' };
  if (connectionPromise) {
    const ok = await connectionPromise;
    return { success: ok, message: ok ? '已连接' : '连接失败' };
  }

  connectionPromise = (async () => {
    try {
      const result = await api.connect();
      connected = result.success;
      if (result.success) {
        console.log('[ServoService] ✅', result.message);
        await api.setAngleImmediate(90);
        const mood = currentEmotion || 'calm';
        currentEmotion = mood;
        await applyEmotionBreathing(mood);
      }
      return connected;
    } catch (err) {
      console.error('[ServoService] 连接异常:', err);
      connected = false;
      return false;
    } finally {
      connectionPromise = null;
    }
  })();

  const ok = await connectionPromise;
  return { success: ok, message: ok ? '已连接' : '连接失败' };
}

export async function disconnect(): Promise<void> {
  const api = getAPI();
  if (!api) return;
  await api.stopBreathing();
  await api.disconnect();
  connected = false;
  breathing = false;
  console.log('[ServoService] 🔌 已断开');
}

// ==================== 情绪驱动 ====================

/**
 * 根据情绪启动呼吸摆动（核心入口）
 */
export async function setEmotion(emotion: string): Promise<void> {
  const api = getAPI();
  console.log('[ServoService] setEmotion called:', emotion, 'connected:', connected, 'hasAPI:', !!api);
  if (!api || !connected) return;

  const key = (emotion || '').toLowerCase().trim();
  if (key === currentEmotion) return;
  currentEmotion = key;

  await applyEmotionBreathing(key);
}

async function applyEmotionBreathing(emotionKey: string): Promise<void> {
  const api = getAPI();
  if (!api) return;

  // 1. 优先查找呼吸配置
  const breathe = EMOTION_BREATHE_MAP[emotionKey];
  if (breathe) {
    await api.startBreathing(breathe);
    breathing = true;
    console.log(`[ServoService] 🎭 "${emotionKey}" → 呼吸 ${breathe.minAngle}°↔${breathe.maxAngle}°, ${breathe.periodMs}ms`);
    return;
  }

  // 2. 模糊匹配呼吸配置
  for (const [emo, cfg] of Object.entries(EMOTION_BREATHE_MAP)) {
    if (emotionKey.includes(emo) || emo.includes(emotionKey)) {
      await api.startBreathing(cfg);
      breathing = true;
      console.log(`[ServoService] 🎭 "${emotionKey}" ~> "${emo}" 呼吸 ${cfg.minAngle}°↔${cfg.maxAngle}°`);
      return;
    }
  }

  // 3. 回退到静态角度
  await api.stopBreathing();
  breathing = false;
  const angle = EMOTION_ANGLE_MAP[emotionKey] ?? 90;
  await api.setAngle(angle);
  console.log(`[ServoService] 🎭 "${emotionKey}" → 静态 ${angle}°`);
}

// ==================== 手动控制（测试/调试） ====================

export async function setAngle(angle: number): Promise<void> {
  const api = getAPI();
  if (!api) return;
  await api.stopBreathing();
  breathing = false;
  const safe = Math.round(Math.max(0, Math.min(180, angle)));
  await api.setAngleImmediate(safe);
}

export async function testBreathing(min: number, max: number, periodMs: number): Promise<void> {
  const api = getAPI();
  if (!api) return;
  await api.startBreathing({ minAngle: min, maxAngle: max, periodMs });
  breathing = true;
}

// ==================== 状态查询 ====================

export function isConnected(): boolean { return connected; }
export function isBreathing(): boolean { return breathing; }
export function getCurrentEmotion(): string { return currentEmotion; }

/**
 * 获取完整状态（供 UI 面板使用）
 */
export async function getFullStatus(): Promise<{
  connected: boolean;
  breathing: boolean;
  breatheConfig: BreatheConfig | null;
  emotion: string;
}> {
  const api = getAPI();
  let status = { connected: false, breathing: false, breatheConfig: null };
  if (api) {
    try { status = await api.getStatus(); } catch {}
  }
  return {
    connected: status.connected,
    breathing: status.breathing,
    breatheConfig: status.breatheConfig,
    emotion: currentEmotion,
  };
}
