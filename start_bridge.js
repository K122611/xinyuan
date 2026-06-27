/**
 * 心元 XiaoZhi Bridge 独立启动器
 * 不依赖 Electron GUI，纯 Node.js 运行
 * 
 * 用法: node start_bridge.js
 */
import { XiaozhiBridge } from './electron/xiaozhi-bridge.js';

// 解析命令行参数 --ip=
const args = process.argv.slice(2);
let hotspotIp = null;
for (const arg of args) {
  if (arg.startsWith('--ip=')) {
    hotspotIp = arg.slice(5);
    break;
  }
}

const bridge = new XiaozhiBridge({
  hotspotIp,
  log: (...args) => console.log('[Bridge]', ...args),
  enableWss: true,
  wssPort: 443,
  enableMqtt: true,
  mqttPorts: [1883],
  onMessage: ({ deviceId, text }) => {
    console.log(`[Bridge] 💬 ${deviceId}: ${text}`);
  },
  onAudio: ({ deviceId, audioPath }) => {
    console.log(`[Bridge] 🎤 ${deviceId} → ${audioPath}`);
  },
  onTtsRequest: ({ deviceId, text }) => {
    console.log(`[Bridge] 🔊 TTS: ${deviceId}: ${text}`);
  },
});

bridge.on('deviceConnected', ({ deviceId, info }) => {
  console.log(`[Bridge] ✅ 设备上线: ${deviceId}`, info);
});
bridge.on('deviceDisconnected', ({ deviceId }) => {
  console.log(`[Bridge] ❌ 设备离线: ${deviceId}`);
});
bridge.on('chat', ({ deviceId, text }) => {
  console.log(`[Bridge] 💬 ${deviceId}: ${text}`);
});

console.log('🚀 启动心元 XiaoZhi Bridge...');

try {
  const result = await bridge.start();
  console.log('[Bridge] ✅ 启动成功:', JSON.stringify(result, null, 2));
  console.log('\n📡 监听端口:');
  console.log('   WS:  ws://0.0.0.0:8888');
  console.log('   WSS: wss://0.0.0.0:443');
  console.log('   MQTT: 0.0.0.0:1883');
  console.log('\n按 Ctrl+C 停止...');
} catch (err) {
  console.error('[Bridge] ❌ 启动失败:', err);
  process.exit(1);
}

// 优雅退出
process.on('SIGINT', async () => {
  console.log('\n🛑 正在关闭 Bridge...');
  await bridge.stop();
  process.exit(0);
});
