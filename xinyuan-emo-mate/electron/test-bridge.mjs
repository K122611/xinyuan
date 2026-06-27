// test-bridge.mjs - 测试桥接服务
import { XiaozhiBridge } from './xiaozhi-bridge.js';
import { speechToPcm16 } from './edge-tts.js';
import { AIConversation } from './ai-conversation.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('='.repeat(50));
console.log('[TEST] 启动心元桥接测试');
console.log('='.repeat(50));

// 启动桥接
const bridge = new XiaozhiBridge({ port: 8888 });

// 启动 AI 对话引擎
const ai = new AIConversation(bridge, speechToPcm16);

ai.onStatus = (evt) => {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] AI状态:`, JSON.stringify(evt, null, 2));
};

bridge.on('device_connected', (sessionId) => {
  console.log(`\n[${new Date().toLocaleTimeString()}] ✅ 设备已连接: ${sessionId}`);
  console.log('[INFO] 现在可以对设备说话，AI 会自动回复\n');
});

bridge.on('device_disconnected', (sessionId) => {
  console.log(`\n[${new Date().toLocaleTimeString()}] ❌ 设备断开: ${sessionId}\n`);
});

// 启动 OTA 服务 (端口 8889)
import { createServer } from 'http';
const otaServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    firmware: { version: '1.0.0' },
    websocket: { url: 'ws://192.168.137.1:8888/' }
  }));
});
otaServer.listen(8889, () => {
  console.log('[OTA] OTA 服务已启动: http://0.0.0.0:8889');
});

console.log('[WS]  WebSocket 桥接: ws://0.0.0.0:8888');
console.log('[WS]  等待设备连接...\n');
console.log('[提示] 按 Ctrl+C 停止\n');
