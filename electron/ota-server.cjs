/**
 * OTA Interceptor - DNS + HTTPS server to let ESP32 pass OTA check instantly.
 * 
 * ESP32 tries to reach api.tenclass.net for firmware update check.
 * This server intercepts DNS and returns "no new version" response.
 * 
 * Usage: Run Electron app as Administrator ONCE.
 * Once ESP32 connects, settings are cached in NVS — no admin needed after.
 */
'use strict';

const dgram = require('dgram');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── CONFIG ──────────────────────────────────────────────────
const FIRMWARE_VERSION = '2.2.6';       // Match the ESP32's current firmware
const DNS_PORT = 53;                   // Standard DNS port (needs admin)
const HTTPS_PORT = 8443;                // Non-privileged port (netsh forwards 443→8443)

let hotspotIp = '192.168.137.1';       // Default, will be auto-detected

// ─── Dynamic IP Detection ────────────────────────────────────
function detectLocalIP() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of (addrs || [])) {
      if (addr.family === 'IPv4' && !addr.internal) {
        candidates.push({ name, address: addr.address });
      }
    }
  }
  // Prefer WiFi / Ethernet, skip virtual adapters
  const preferred = candidates.find(c =>
    /wi-?fi|wlan|以太|eth|en\d|本地连接/i.test(c.name)) || candidates[0];
  if (preferred) {
    hotspotIp = preferred.address;
    console.log(`[OTA] 🌐 检测到本机IP: ${hotspotIp} (${preferred.name})`);
  } else {
    console.warn(`[OTA] ⚠ 未检测到活跃网卡，使用默认IP: ${hotspotIp}`);
  }
  return hotspotIp;
}

let dnsServer, httpsServer;
let running = true;

// ─── DNS SERVER ──────────────────────────────────────────────
function startDns() {
    dnsServer = dgram.createSocket('udp4');

    dnsServer.on('message', (msg, rinfo) => {
        // Basic DNS parser — handle standard A record queries for api.tenclass.net
        // DNS header: 12 bytes, then question section
        if (msg.length < 13) return;

        const id = msg.subarray(0, 2); // Transaction ID

        // Parse question section (skip header at offset 12)
        let offset = 12;
        const labels = [];
        while (offset < msg.length && msg[offset] !== 0) {
            const len = msg[offset];
            offset++;
            labels.push(msg.subarray(offset, offset + len).toString('ascii'));
            offset += len;
        }
        offset++; // Skip null terminator

        const qname = labels.join('.').toLowerCase();

        // Intercept api.tenclass.net
        if (qname === 'api.tenclass.net') {
            const response = buildDnsResponse(id, msg, hotspotIp);
            dnsServer.send(response, rinfo.port, rinfo.address, (err) => {
                if (!err) console.log('[OTA-DNS] ✅ api.tenclass.net →', hotspotIp);
            });
            return;
        }

        // Forward all other queries to upstream DNS (8.8.8.8)
        const upstream = dgram.createSocket('udp4');
        upstream.on('message', (resp) => {
            dnsServer.send(resp, rinfo.port, rinfo.address);
            upstream.close();
        });
        upstream.send(msg, 53, '8.8.8.8', (err) => {
            if (err) upstream.close();
        });
    });

    dnsServer.bind(DNS_PORT, '0.0.0.0', () => {
        console.log(`[OTA-DNS] 🟢 Listening on port ${DNS_PORT}`);
    });
}

function buildDnsResponse(id, query, ip) {
    const response = Buffer.alloc(query.length + 16);

    // Copy original query
    query.copy(response, 0, 0, query.length);

    // DNS header: set QR=1 (response), keep rest
    response[2] = 0x81; // QR=1, RA=1
    response[3] = 0x80; // RD=1, RA=1
    // ANCOUNT = 1
    response[6] = 0x00;
    response[7] = 0x01;

    // Answer section at end of query
    const answerOffset = query.length;
    // NAME: pointer to offset 12 (the question name)
    response[answerOffset] = 0xC0;
    response[answerOffset + 1] = 0x0C;
    // TYPE: A (1)
    response[answerOffset + 2] = 0x00;
    response[answerOffset + 3] = 0x01;
    // CLASS: IN (1)
    response[answerOffset + 4] = 0x00;
    response[answerOffset + 5] = 0x01;
    // TTL: 60 seconds
    response[answerOffset + 6] = 0x00;
    response[answerOffset + 7] = 0x00;
    response[answerOffset + 8] = 0x00;
    response[answerOffset + 9] = 0x3C;
    // RDLENGTH: 4
    response[answerOffset + 10] = 0x00;
    response[answerOffset + 11] = 0x04;
    // RDATA: IP address
    const octets = ip.split('.').map(Number);
    response[answerOffset + 12] = octets[0];
    response[answerOffset + 13] = octets[1];
    response[answerOffset + 14] = octets[2];
    response[answerOffset + 15] = octets[3];

    return response;
}

// ─── HTTPS SERVER ────────────────────────────────────────────
async function startHttps() {
    // Generate self-signed cert on the fly
    const certDir = path.join(os.tmpdir(), 'xinyuan-ota');
    if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

    const keyPath = path.join(certDir, 'key.pem');
    const certPath = path.join(certDir, 'cert.pem');

    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        const selfsigned = require('selfsigned');
        const attrs = [{ name: 'commonName', value: 'api.tenclass.net' }];
        const pems = await selfsigned.generate(attrs, {
            keySize: 2048,
            days: 365,
            algorithm: 'sha256',
            extensions: [{ name: 'subjectAltName', cA: false, altNames: [{ type: 2, value: 'api.tenclass.net' }] }],
        });
        fs.writeFileSync(keyPath, pems.private);
        fs.writeFileSync(certPath, pems.cert);
        console.log('[OTA-HTTPS] 🔑 Self-signed cert generated for api.tenclass.net');
    }

    const options = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
    };

    httpsServer = https.createServer(options, (req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            console.log(`[OTA-HTTPS] ${req.method} ${req.url}`);

            // OTA response: same firmware version → no update needed
            const response = {
                firmware: {
                    version: FIRMWARE_VERSION,
                },
                websocket: {
                    url: `ws://${hotspotIp}:8888`,
                },
            };

            const json = JSON.stringify(response);

            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(json),
                'Access-Control-Allow-Origin': '*',
            });
            res.end(json);

            console.log('[OTA-HTTPS] ✅ OTA check passed → version', FIRMWARE_VERSION);
            console.log('[OTA-HTTPS] ✅ WebSocket →', `ws://${hotspotIp}:8888`);
        });
    });

    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`[OTA-HTTPS] 🟢 Listening on port ${HTTPS_PORT}`);
    });
}

// ─── MAIN ────────────────────────────────────────────────────
function start() {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║    心元 OTA Interceptor v1.0            ║');
    console.log('║    Intercepting api.tenclass.net         ║');
    console.log(`║    Firmware: v${FIRMWARE_VERSION}                          ║`);
    console.log(`║    Redirect: ${hotspotIp}                      ║`);
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    try {
        startDns();
    } catch (e) {
        console.error('[OTA-DNS] ❌ Failed to start DNS server:', e.message);
        console.error('[OTA-DNS] 💡 Make sure you run as Administrator');
    }

    try {
        startHttps();
    } catch (e) {
        console.error('[OTA-HTTPS] ❌ Failed to start HTTPS server:', e.message);
        console.error('[OTA-HTTPS] 💡 Make sure you run as Administrator');
    }

    console.log('');
    console.log('📡 ESP32 OTA check will now resolve to this PC');
    console.log('⏳ Keep this running until ESP32 connects to the bridge');
    console.log('');

    // Graceful shutdown
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

function stop() {
    console.log('\n🔴 Shutting down OTA interceptor...');
    running = false;
    if (dnsServer) { dnsServer.close(); console.log('[OTA-DNS] Stopped'); }
    if (httpsServer) { httpsServer.close(); console.log('[OTA-HTTPS] Stopped'); }
    process.exit(0);
}

// ─── EXPORT for Electron integration ─────────────────────────
module.exports = { start, stop, startDns, startHttps, detectLocalIP };

// ─── Run standalone if executed directly ─────────────────────
const isMain = process.argv[1] && process.argv[1].includes('ota-server');
if (isMain) {
    // Check for optional dependency
    try {
        require.resolve('selfsigned');
    } catch (e) {
        console.error('❌ Missing dependency: selfsigned');
        console.error('   Run: npm install selfsigned');
        process.exit(1);
    }
    detectLocalIP();
    start();
}
