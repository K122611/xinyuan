import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

let port = null;
let isConnected = false;
let pendingAngle = null;
let debounceTimer = null;

// 呼吸摆动
let breatheTimer = null;
let breatheStartTime = 0;
let breatheConfig = null; // { minAngle, maxAngle, periodMs }
let breatheLastAngle = 90;

const SERVO_BAUD_RATE = 9600;
const DEBOUNCE_MS = 300;
const BREATHE_TICK_MS = 50; // 50ms 刷新一次，流畅

// ==================== 串口发现与连接 ====================

async function findArduinoPort() {
  const ports = await SerialPort.list();
  for (const p of ports) {
    const pid = (p.productId || '').toLowerCase();
    const mfg = (p.manufacturer || '').toLowerCase();
    const path = (p.path || '').toLowerCase();

    if (
      pid === '0043' || pid === '7523' || pid === '6001' ||
      mfg.includes('arduino') ||
      mfg.includes('wch') ||
      path.includes('usbmodem') ||
      path.includes('ttyusb') ||
      path.includes('ttyacm')
    ) {
      return p.path;
    }
  }
  const comPort = ports.find(p => p.path.match(/COM\d+/i));
  return comPort ? comPort.path : null;
}

/**
 * 列出所有可用串口（供 UI 面板选择）
 */
export async function listPorts() {
  try {
    const ports = await SerialPort.list();
    return {
      success: true,
      ports: ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer || '',
        productId: p.productId || '',
        serialNumber: p.serialNumber || '',
      })),
    };
  } catch (err) {
    return { success: false, message: err.message, ports: [] };
  }
}

export async function connectServo() {
  if (isConnected && port && port.isOpen) {
    return { success: true, message: '已连接', port: port.path };
  }

  const portPath = await findArduinoPort();
  if (!portPath) {
    return { success: false, message: '未找到 Arduino 设备，请检查 USB 连接' };
  }

  return new Promise((resolve) => {
    try {
      port = new SerialPort({
        path: portPath,
        baudRate: SERVO_BAUD_RATE,
        autoOpen: false,
      });

      const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

      parser.on('data', (line) => {
        const trimmed = line.trim();
        console.log('[Servo] Arduino says:', trimmed);
        if (trimmed === 'READY') {
          isConnected = true;
          if (pendingAngle !== null) {
            _sendNow(pendingAngle);
            pendingAngle = null;
          }
        }
      });

      port.open((err) => {
        if (err) {
          console.error('[Servo] 打开串口失败:', err.message);
          port = null;
          isConnected = false;
          resolve({ success: false, message: `串口打开失败: ${err.message}` });
        } else {
          console.log('[Servo] 串口已打开:', portPath);
          setTimeout(() => {
            if (!isConnected) {
              console.warn('[Servo] 超时未收到 READY，假定已连接');
              isConnected = true;
            }
            resolve({ success: true, message: `已连接到 ${portPath}`, port: portPath });
          }, 3000);
        }
      });

      port.on('close', () => {
        console.log('[Servo] 串口已关闭');
        isConnected = false;
        stopBreathing();
      });

      port.on('error', (err) => {
        console.error('[Servo] 串口错误:', err.message);
        isConnected = false;
        stopBreathing();
      });
    } catch (err) {
      console.error('[Servo] 初始化失败:', err.message);
      resolve({ success: false, message: err.message });
    }
  });
}

// ==================== 角度发送 ====================

export function sendAngle(angle) {
  if (typeof angle !== 'number' || isNaN(angle)) {
    console.warn('[Servo] 无效角度:', angle);
    return { success: false, message: '无效角度' };
  }

  const safeAngle = Math.round(Math.max(0, Math.min(180, angle)));

  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    _sendNow(safeAngle);
    debounceTimer = null;
  }, DEBOUNCE_MS);

  return { success: true, angle: safeAngle, debounced: true };
}

function _sendNow(angle) {
  if (!isConnected || !port || !port.isOpen) {
    console.warn('[Servo] 未连接，排队等待...');
    pendingAngle = angle;
    return { success: false, message: '未连接' };
  }

  const cmd = `ANGLE:${angle}\n`;
  port.write(cmd, (err) => {
    if (err) {
      console.error('[Servo] 写入失败:', err.message);
    } else {
      console.log(`[Servo] → ${angle}°`);
    }
  });
  breatheLastAngle = angle;
  return { success: true, angle };
}

export function sendAngleImmediate(angle) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  const safeAngle = Math.round(Math.max(0, Math.min(180, angle)));
  return _sendNow(safeAngle);
}

// ==================== 呼吸摆动引擎 ====================

/**
 * 启动呼吸摆动
 * @param {{ minAngle: number, maxAngle: number, periodMs: number }} cfg
 *   - minAngle/maxAngle: 摆动范围
 *   - periodMs: 完整一个来回的毫秒数（越小越快）
 */
export function startBreathing(cfg) {
  if (!isConnected) return { success: false, message: '舵机未连接' };

  // 先停掉已有的呼吸
  stopBreathing();

  const { minAngle, maxAngle, periodMs } = cfg;
  if (!periodMs || periodMs <= 0 || minAngle >= maxAngle) {
    return { success: false, message: '呼吸参数无效' };
  }

  breatheConfig = { minAngle, maxAngle, periodMs };
  breatheStartTime = Date.now();

  breatheTimer = setInterval(() => {
    if (!isConnected || !breatheConfig) {
      stopBreathing();
      return;
    }
    const elapsed = Date.now() - breatheStartTime;
    // 正弦波：center ± amplitude * sin
    const center = (breatheConfig.minAngle + breatheConfig.maxAngle) / 2;
    const amplitude = (breatheConfig.maxAngle - breatheConfig.minAngle) / 2;
    const phase = (elapsed % breatheConfig.periodMs) / breatheConfig.periodMs; // 0~1
    const radians = phase * Math.PI * 2;
    const angle = Math.round(center + amplitude * Math.sin(radians));

    if (angle !== breatheLastAngle) {
      _sendNow(angle);
    }
  }, BREATHE_TICK_MS);

  console.log(`[Servo] 🌬️ 呼吸摆动开始: ${minAngle}°↔${maxAngle}°, 周期${periodMs}ms`);
  return { success: true, pattern: cfg };
}

export function stopBreathing() {
  if (breatheTimer) {
    clearInterval(breatheTimer);
    breatheTimer = null;
  }
  breatheConfig = null;
  console.log('[Servo] 🌬️ 呼吸摆动停止');
  return { success: true };
}

export function isBreathing() {
  return breatheTimer !== null && breatheConfig !== null;
}

export function getBreathingConfig() {
  return breatheConfig;
}

// ==================== 断开 ====================

export async function disconnectServo() {
  stopBreathing();
  if (debounceTimer) clearTimeout(debounceTimer);
  if (port && port.isOpen) {
    _sendNow(90);
    await new Promise((resolve) => setTimeout(resolve, 300));
    port.close();
  }
  port = null;
  isConnected = false;
  pendingAngle = null;
  return { success: true, message: '已断开' };
}

export function getStatus() {
  return {
    connected: isConnected,
    breathing: isBreathing(),
    breatheConfig: getBreathingConfig(),
  };
}
