/**
 * 舵机服务 — 渲染进程端
 *
 * 情绪 → 角度映射：
 *   开心/高兴  → 180°（最右，高能量正情绪）
 *   兴奋       → 160°
 *   满意/满足  → 130°
 *   平静/中性  →  90°（居中，默认位置）
 *   无聊       →  60°
 *   困惑       →  45°
 *   悲伤       →  20°
 *   愤怒/沮丧  →   0°（最左，高能量负情绪）
 */

// ==================== 类型声明 ====================

interface ServoAPI {
  connect(): Promise<{ success: boolean; message: string; port?: string }>;
  disconnect(): Promise<{ success: boolean; message: string }>;
  getStatus(): Promise<{ connected: boolean }>;
  setAngle(angle: number): Promise<{ success: boolean; angle: number }>;
  setAngleImmediate(angle: number): Promise<{ success: boolean; angle: number }>;
}

declare global {
  interface Window {
    servoAPI: ServoAPI;
    supabaseAPI: { getConfig(): Promise<{ supabaseUrl: string; supabaseAnonKey: string }> };
  }
}

// ==================== 情绪映射 ====================

const EMOTION_ANGLE_MAP: Record<string, number> = {
  // 正情绪 — 右侧 (90° ~ 180°)
  happy: 180,
  joy: 180,
  excited: 160,
  grateful: 145,
  love: 145,
  content: 130,
  satisfied: 130,
  calm: 110,
  relaxed: 110,

  // 中性 — 中间 (~90°)
  neutral: 90,
  peaceful: 90,
  surprised: 100,

  // 负情绪 — 左侧 (0° ~ 90°)
  bored: 60,
  tired: 55,
  confused: 45,
  anxious: 35,
  worried: 30,
  sad: 20,
  lonely: 15,
  angry: 0,
  frustrated: 5,
  disappointed: 10,
};

/**
 * 将情绪标签映射为舵机角度
 * @param emotion 情绪标签 (例如 "happy", "sad")
 * @returns 0-180 的角度值，未匹配到返回 90（居中）
 */
export function emotionToAngle(emotion: string): number {
  const key = (emotion || '').toLowerCase().trim();
  const angle = EMOTION_ANGLE_MAP[key];
  if (angle !== undefined) return angle;

  // 模糊匹配
  for (const [emo, deg] of Object.entries(EMOTION_ANGLE_MAP)) {
    if (key.includes(emo) || emo.includes(key)) {
      return deg;
    }
  }

  // 默认：中性居中
  console.warn(`[ServoService] 未匹配情绪 "${emotion}"，默认 90°`);
  return 90;
}

// ==================== 服务状态 ====================

let connected = false;
let lastAngle = 90;
let connectionPromise: Promise<boolean> | null = null;

function getAPI(): ServoAPI | null {
  if (typeof window !== 'undefined' && window.servoAPI) {
    return window.servoAPI;
  }
  return null;
}

// ==================== 公开 API ====================

/**
 * 连接舵机（幂等，多次调用只连一次）
 */
export async function connect(): Promise<boolean> {
  const api = getAPI();
  if (!api) {
    console.warn('[ServoService] servoAPI 不可用（可能在非 Electron 环境）');
    return false;
  }

  if (connected) return true;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      const result = await api.connect();
      connected = result.success;
      if (result.success) {
        console.log('[ServoService] ✅ 已连接:', result.message);
        // 归中
        await api.setAngleImmediate(90);
        lastAngle = 90;
      } else {
        console.warn('[ServoService] ❌ 连接失败:', result.message);
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

  return connectionPromise;
}

/**
 * 根据情绪设置舵机角度
 * @param emotion 情绪标签
 * @param intensity 强度 0-1（可选，默认1；影响最终角度在 emotionAngle 和中位 90° 之间插值）
 */
export async function setEmotion(emotion: string, intensity = 1): Promise<void> {
  const api = getAPI();
  if (!api) return;

  const baseAngle = emotionToAngle(emotion);
  // 强度因子：intensity=0 时归中，=1 时完全表达
  const interp = Math.max(0, Math.min(1, intensity));
  const targetAngle = Math.round(90 + (baseAngle - 90) * interp);

  if (targetAngle === lastAngle) return;

  await api.setAngle(targetAngle);
  lastAngle = targetAngle;
  console.log(`[ServoService] 🎭 "${emotion}" (强度${intensity}) → ${targetAngle}°`);
}

/**
 * 手动设置角度（测试用）
 */
export function setAngle(angle: number): void {
  const api = getAPI();
  if (!api) return;
  const safe = Math.round(Math.max(0, Math.min(180, angle)));
  api.setAngleImmediate(safe);
  lastAngle = safe;
}

/**
 * 获取连接状态
 */
export function isConnected(): boolean {
  return connected;
}

/**
 * 获取上次设置的角度
 */
export function getLastAngle(): number {
  return lastAngle;
}

/**
 * 断开连接
 */
export async function disconnect(): Promise<void> {
  const api = getAPI();
  if (!api) return;
  await api.disconnect();
  connected = false;
  lastAngle = 90;
  console.log('[ServoService] 🔌 已断开');
}
