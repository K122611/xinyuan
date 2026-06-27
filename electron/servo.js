import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

let port = null;
let isConnected = false;
let pendingAngle = null;
let debounceTimer = null;

// 呼吸引擎
let breatheTimer = null;
let breatheConfig = null;

const SERVO_BAUD_RATE = 9600;
const DEBOUNCE_MS = 300; // 防抖：300ms内连续指令只发最后一次
const BREATHE_TICK_MS = 50; // 呼吸刷新间隔

/**
 * 自动发现 Arduino 串口
 * Windows: COM3, COM4...
 * macOS: /dev/cu.usbmodem*
 * Linux: /dev/ttyUSB*, /dev/ttyACM*
 */
async function findArduinoPort() {
  const ports = await SerialPort.list();
  for (const p of ports) {
    const pid = (p.productId || '').toLowerCase();
    const mfg = (p.manufacturer || '').toLowerCase();
    const path = (p.path || '').toLowerCase();

    // Arduino 常见标识
    if (
      pid === '0043' || pid === '7523' || pid === '6001' ||  // Arduino Uno / Nano / Mega
      mfg.includes('arduino') ||
      mfg.includes('wch') ||          // CH340/CH341 国产芯片
      path.includes('usbmodem') ||     // macOS
      path.includes('ttyusb') ||       // Linux
      path.includes('ttyacm')          // Linux
    ) {
      return p.path;
    }
  }
  // 回退：尝试所有 COM 口
  const comPort = ports.find(p => p.path.match(/COM\d+/i));
  return comPort ? comPort.path : null;
}

/**
 * 连接舵机串口
 */
export async function connectServo() {
  if (isConnected && port && port.isOpen) {
    return { success: true, message: '已连接' };
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
          // 发送之前排队的角度
          if (pendingAngle !== null) {
            sendAngle(pendingAngle);
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
          // 等待 Arduino 发送 READY（最多等 3 秒）
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
      });

      port.on('error', (err) => {
        console.error('[Servo] 串口错误:', err.message);
        isConnected = false;
      });
    } catch (err) {
      console.error('[Servo] 初始化失败:', err.message);
      resolve({ success: false, message: err.message });
    }
  });
}

/**
 * 发送角度到舵机（带防抖）
 */
export function sendAngle(angle) {
  // 安全检查
  if (typeof angle !== 'number' || isNaN(angle)) {
    console.warn('[Servo] 无效角度:', angle);
    return { success: false, message: '无效角度' };
  }

  // 限幅 0~180
  const safeAngle = Math.round(Math.max(0, Math.min(180, angle)));

  // 防抖：清除之前的定时器，只发最后一次
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
  return { success: true, angle };
}

/**
 * 立即发送（跳过防抖，用于测试/手动控制）
 */
export function sendAngleImmediate(angle) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  const safeAngle = Math.round(Math.max(0, Math.min(180, angle)));
  return _sendNow(safeAngle);
}

/**
 * 开始呼吸摆动（正弦波引擎）
 * @param {{ minAngle: number, maxAngle: number, periodMs: number }} cfg
 */
export function startBreathing(cfg) {
  stopBreathing(); // 先停旧的

  if (!cfg || typeof cfg.minAngle !== 'number' || typeof cfg.maxAngle !== 'number' || typeof cfg.periodMs !== 'number') {
    console.warn('[Servo] 无效的呼吸配置:', cfg);
    return { success: false, message: '无效配置' };
  }

  breatheConfig = { ...cfg };
  const center = (cfg.minAngle + cfg.maxAngle) / 2;
  const amplitude = (cfg.maxAngle - cfg.minAngle) / 2;
  const startTime = Date.now();

  console.log(`[Servo] 🌬️ 呼吸开始: ${cfg.minAngle}°↔${cfg.maxAngle}°, 周期 ${cfg.periodMs}ms`);

  breatheTimer = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const phase = (elapsed % cfg.periodMs) / cfg.periodMs;
    const angle = center + amplitude * Math.sin(phase * 2 * Math.PI);
    _sendNow(Math.round(angle));
  }, BREATHE_TICK_MS);

  return { success: true, config: breatheConfig };
}

/**
 * 停止呼吸摆动
 */
export function stopBreathing() {
  if (breatheTimer) {
    clearInterval(breatheTimer);
    breatheTimer = null;
    breatheConfig = null;
    console.log('[Servo] ⏹️ 呼吸停止');
  }
  return { success: true };
}

/**
 * 断开连接
 */
export async function disconnectServo() {
  stopBreathing();
  if (debounceTimer) clearTimeout(debounceTimer);
  if (port && port.isOpen) {
    // 归中
    _sendNow(90);
    await new Promise((resolve) => setTimeout(resolve, 300));
    port.close();
  }
  port = null;
  isConnected = false;
  pendingAngle = null;
  return { success: true, message: '已断开' };
}

/**
 * 获取连接状态（含呼吸信息）
 */
export function getStatus() {
  return {
    connected: isConnected,
    breathing: !!breatheTimer,
    breatheConfig: breatheConfig ? { ...breatheConfig } : null,
  };
}
