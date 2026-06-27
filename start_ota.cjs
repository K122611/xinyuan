// Fake OTA server - with Content-Length header (no chunked encoding)
const http = require('http');

const server = http.createServer((req, res) => {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${req.method} ${req.url} from ${req.socket.remoteAddress}`);
  
  // Record request body for debugging
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    if (body) console.log(`  Body: ${body.slice(0, 300)}`);
  });

  // IMPORTANT: no mqtt key, only websocket
  const response = {
    firmware: {
      version: "1.0.0",
      url: ""
    },
    websocket: {
      url: "ws://192.168.137.1:8888/"
    }
  };

  const json = JSON.stringify(response);
  
  // Use Content-Length to avoid chunked encoding issues with ESP32 HTTP client
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Connection': 'close'
  });
  res.end(json);
});

server.listen(8889, '0.0.0.0', () => {
  console.log('[假OTA] ✅ OTA server on http://0.0.0.0:8889/');
  console.log('[假OTA] Response: {"firmware":{"version":"1.0.0"},"websocket":{"url":"ws://192.168.137.1:8888/"}}');
  console.log('[假OTA] No mqtt, no chunked encoding');
  setInterval(() => {}, 60000);
});
