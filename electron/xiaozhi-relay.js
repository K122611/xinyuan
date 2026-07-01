/**
 * 心元 中继模式 (Standalone Relay)
 *
 * 当用户不需要心元 APP 的 AI 处理链路时，启用中继模式。
 * 设备音频 → 官方小智云服务器 (api.tenclass.net) → TTS音频回设备。
 *
 * 流程:
 *   K210/ESP32 设备 → WebSocket → 心元 Bridge (port 8888)
 *       ↓ (relay mode)
 *   官方云服务器 wss://api.tenclass.net/...
 *       ↓
 *   TTS OPUS 音频 + JSON 消息 → 回传设备
 */

import WebSocket from 'ws';
import https from 'https';
import http from 'http';
import crypto from 'crypto';
import dns from 'dns';
import { EventEmitter } from 'events';

// 官方小智 OTA 端点
const OFFICIAL_OTA_URL = 'https://api.tenclass.net/xiaozhi/ota/';
// 官方 hostname（需要 bypass hosts 文件解析到真实 IP）
const OFFICIAL_HOST = 'api.tenclass.net';

// 创建独立 DNS Resolver，使用公共 DNS 服务器，完全绕过系统 hosts 文件
const _realDnsResolver = new dns.promises.Resolver();
_realDnsResolver.setServers(['8.8.8.8', '1.1.1.1']);
let _dnsTimeoutMs = 3000;  // DNS 超时 3 秒


async function _resolveRealHost() {
  if (_resolveRealHost._cached && (Date.now() - _resolveRealHost._ts) < 300000) {
    return _resolveRealHost._cached;
  }
  try {
    const addresses = await Promise.race([
      _realDnsResolver.resolve4(OFFICIAL_HOST),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), _dnsTimeoutMs))
    ]);
    _resolveRealHost._cached = addresses[0];
    _resolveRealHost._ts = Date.now();
    return _resolveRealHost._cached;
  } catch (e) {
    console.warn('[Relay DNS] resolve failed:', e.message);
    if (_resolveRealHost._cached) return _resolveRealHost._cached;
    return '112.74.84.224';
  }
}

export class XiaozhiRelay extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.serverUrl = opts.serverUrl || null;
    this.otaUrl = opts.otaUrl || OFFICIAL_OTA_URL;
    this.relays = new Map();
    this.enabled = false;
    this.log = opts.log || ((...args) => console.log('[中继]', ...args));

    // 模拟设备 ID（匹配固件的 Device-Id/Client-Id 行为）
    this._mockMac = this._generateMac();
    this._mockUuid = crypto.randomUUID();
  }

  _generateMac() {
    const bytes = crypto.randomBytes(6);
    return bytes.toString('hex').match(/.{2}/g).join(':');
  }

  /**
   * 启动中继：获取官方 WebSocket URL
   */
  async start() {
    if (!this.serverUrl) {
      this.log('📡 正在查询官方 OTA 端点获取 WebSocket URL...');
      try {
        this.serverUrl = await this._fetchWebSocketUrl();
      } catch (err) {
        this.log(`⚠ OTA 查询失败: ${err.message}`);
      }
    }
    // BUGFIX: 只有成功获取到 serverUrl 才启用中继
    // 否则 enabled=true 但 serverUrl=null 会拦截设备连接但无法转发，堵塞本地 AI 通路
    if (!this.serverUrl) {
      this.log('❌ 中继模式启用失败：无法获取官方 WebSocket URL（官方服务器可能已变更）');
      this.emit('status', { enabled: false, url: null, error: '官方服务器不可达' });
      return { success: false, serverUrl: null, error: '官方服务器不可达' };
    }
    this.enabled = true;
    this.log(`✅ 中继模式已启用 → ${this.serverUrl}`);
    this.emit('started', { serverUrl: this.serverUrl });
    return { success: true, serverUrl: this.serverUrl };
  }

  /**
   * 停止中继
   */
  stop() {
    this.enabled = false;
    for (const [deviceId, ctx] of this.relays) {
      this.log(`🔌 关闭中继: ${deviceId}`);
      try { ctx.serverWs.close(1000, 'Relay stopped'); } catch (_) {}
    }
    this.relays.clear();
    this.log('⏹ 中继模式已停用');
    this.emit('stopped');
    return { success: true };
  }

  /**
   * 从官方 OTA 端点获取 WebSocket URL
   * 完全模仿固件行为（ota.cc CheckVersion）：
   *   - 带 Device-Id, Client-Id, Activation-Version, User-Agent 头
   *   - POST system info JSON
   *   - 从响应中提取 websocket.url
   */
  async _fetchWebSocketUrl() {
    // 尝试1：POST + 固件头（匹配 ota.cc SetupHttp）
    try {
      const url = await this._otaPost(this.otaUrl);
      if (url) return url;
    } catch (err) {
      this.log(`⚠ OTA POST 失败: ${err.message}`);
    }

    // 尝试2：GET + 固件头
    try {
      const url = await this._otaGet(this.otaUrl);
      if (url) return url;
    } catch (err) {
      this.log(`⚠ OTA GET 失败: ${err.message}`);
    }

    // 尝试3：无尾斜杠
    const noSlash = this.otaUrl.replace(/\/+$/, '');
    try {
      const url = await this._otaPost(noSlash);
      if (url) return url;
    } catch (_) {}

    // 尝试4：回退 WebSocket URL 列表（包含 redirect 处理）
    return this._tryFallbackUrls();
  }

  _otaPost(otaUrl) {
    return new Promise(async (resolve, reject) => {
      try {
        const urlObj = new URL(otaUrl);
        // 🔧 Bypass hosts 文件：使用公共 DNS 解析 api.tenclass.net 到真实 IP
        const realIp = await _resolveRealHost();
        const options = {
          hostname: realIp,
          servername: OFFICIAL_HOST,  // TLS SNI
          port: urlObj.port || 443,
          path: urlObj.pathname + urlObj.search,
          method: 'POST',
          headers: {
            'Host': OFFICIAL_HOST,
            'Device-Id': this._mockMac,
            'Client-Id': this._mockUuid,
            'Activation-Version': '1',
            'User-Agent': 'XiaoZhi/1.0 (K210)',
            'Accept-Language': 'zh-CN',
            'Content-Type': 'application/json',
          },
          rejectUnauthorized: false,
          timeout: 10000,
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            this.log(`📡 OTA POST → ${res.statusCode}: ${data.slice(0, 200)}`);
            const url = this._parseOtaResponse(data);
            if (url) resolve(url);
            else reject(new Error(`OTA POST: 无 websocket.url, status=${res.statusCode}`));
          });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('超时')); });

        const body = JSON.stringify({
          board: 'xiaozhi-esp32',
          version: '1.0.0',
          mac: this._mockMac,
        });
        req.write(body);
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  _otaGet(otaUrl) {
    return new Promise(async (resolve, reject) => {
      try {
        const urlObj = new URL(otaUrl);
        // 🔧 Bypass hosts 文件
        const realIp = await _resolveRealHost();
        const options = {
          hostname: realIp,
          servername: OFFICIAL_HOST,
          port: urlObj.port || 443,
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          headers: {
            'Host': OFFICIAL_HOST,
            'Device-Id': this._mockMac,
            'Client-Id': this._mockUuid,
            'Activation-Version': '1',
            'User-Agent': 'XiaoZhi/1.0 (K210)',
            'Accept-Language': 'zh-CN',
          },
          rejectUnauthorized: false,
          timeout: 10000,
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            this.log(`📡 OTA GET → ${res.statusCode}: ${data.slice(0, 200)}`);
            const url = this._parseOtaResponse(data);
            if (url) resolve(url);
            else reject(new Error(`OTA GET: 无 websocket.url, status=${res.statusCode}`));
          });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('超时')); });
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  _parseOtaResponse(data) {
    try {
      const json = JSON.parse(data);
      return json.websocket?.url || null;
    } catch (_) {
      return null;
    }
  }

  async _tryFallbackUrls() {
    const candidates = [
      'wss://api.tenclass.net/xiaozhi/v1',
      'wss://api.tenclass.net/xiaozhi/v1/',
      'wss://api.tenclass.net/xiaozhi/ws',
      'wss://api.tenclass.net/ws',
    ];

    this.log(`🔍 尝试 ${candidates.length} 个回退 URL...`);

    for (const url of candidates) {
      try {
        this.log(`🔍 测试: ${url}`);
        const finalUrl = await this._resolveWebSocketUrl(url, 5000);
        this.log(`✅ 连接成功: ${finalUrl}`);
        return finalUrl;
      } catch (err) {
        this.log(`❌ ${url}: ${err.message}`);
      }
    }

    throw new Error('所有回退 URL 均不可用');
  }

  /**
   * 解析 WebSocket URL（跟随 HTTP 重定向）
   * 如果返回 301/302，提取 Location 头
   */
  async _resolveWebSocketUrl(wsUrl, timeoutMs) {
    const urlObj = new URL(wsUrl);
    let hostname = urlObj.hostname;
    let servername = undefined;

    // 🔧 Bypass hosts 文件：将 api.tenclass.net 解析到真实 IP
    if (hostname === OFFICIAL_HOST || hostname.endsWith('.tenclass.net')) {
      hostname = await _resolveRealHost();
      servername = OFFICIAL_HOST;
    }

    const isSecure = urlObj.protocol === 'wss:' || urlObj.protocol === 'https:';
    const httpModule = isSecure ? https : http;

    // 🔧 构建使用真实 IP 的 WebSocket URL
    const resolvedWsUrl = hostname === urlObj.hostname ? wsUrl :
      urlObj.protocol + '//' + hostname + (urlObj.port ? ':' + urlObj.port : '') + urlObj.pathname + urlObj.search;

    return new Promise((resolve, reject) => {
      // 先用 HTTP 请求检查是否有重定向
      const options = {
        hostname: hostname,
        servername: servername,
        port: urlObj.port || (isSecure ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'Host': OFFICIAL_HOST,
          'Device-Id': this._mockMac,
          'Client-Id': this._mockUuid,
          'User-Agent': 'XiaoZhi/1.0 (K210)',
        },
        rejectUnauthorized: false,
        timeout: timeoutMs,
      };

      const req = httpModule.request(options, (res) => {
        // 301/302 → 跟随重定向
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) {
            let redirectUrl;
            try {
              redirectUrl = new URL(location, wsUrl.replace(/^wss?/, isSecure ? 'https' : 'http')).href;
              redirectUrl = redirectUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');
              this.log(`  ↳ 重定向: ${wsUrl} → ${redirectUrl}`);
              resolve(this._resolveWebSocketUrl(redirectUrl, timeoutMs));
            } catch (e) {
              reject(new Error(`重定向解析失败: ${e.message}`));
            }
            return;
          }
        }

        // 非重定向 → 检查 WebSocket upgrade
        res.resume();
        this._directWsTest(resolvedWsUrl, timeoutMs).then(resolve).catch(reject);
      });

      req.on('error', (err) => {
        // HTTP 请求失败，直接尝试 WebSocket
        this._directWsTest(resolvedWsUrl, timeoutMs).then(resolve).catch(reject);
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy();
        this._directWsTest(resolvedWsUrl, Math.min(timeoutMs, 3000)).then(resolve).catch(reject);
      });

      req.end();
    });
  }

  _directWsTest(wsUrl, timeoutMs) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          'Host': OFFICIAL_HOST,
          'Device-Id': this._mockMac,
          'Client-Id': this._mockUuid,
          'Protocol-Version': '1',
        },
        rejectUnauthorized: false,
      });
      const timer = setTimeout(() => { ws.close(); reject(new Error('连接超时')); }, timeoutMs);
      ws.on('open', () => { clearTimeout(timer); ws.close(); resolve(wsUrl); });
      ws.on('error', (err) => { clearTimeout(timer); reject(new Error(err.message)); });
      ws.on('unexpected-response', (_req, res) => {
        clearTimeout(timer);
        // 如果是 301/302，尝试跟随
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) {
            try {
              const redirectUrl = new URL(location, wsUrl).href;
              reject(new Error(`→ ${redirectUrl}`));
            } catch (_) {
              reject(new Error(`${res.statusCode}`));
            }
            return;
          }
        }
        reject(new Error(`HTTP ${res.statusCode}`));
      });
    });
  }

  /**
   * 设备连接时调用：建立到官方服务器的 WebSocket 连接
   */
  onDeviceConnected(deviceId, deviceWs, helloMsg) {
    if (!this.enabled) return;

    // BUGFIX: 严格检查 serverUrl，无有效 URL 则不拦截设备，让本地 AI 通路正常工作
    if (!this.serverUrl) {
      this.log(`[中继] 设备 ${deviceId} 上线但无有效 serverUrl，跳过中继（本地 AI 将接管）`);
      return;
    }

    this.log(`🔗 设备 ${deviceId} 上线，建立到官方服务器的中继...`);

    const existing = this.relays.get(deviceId);
    if (existing) {
      try { existing.serverWs.close(); } catch (_) {}
    }

    this._doConnect(deviceId, deviceWs, helloMsg);
  }

  async _doConnect(deviceId, deviceWs, helloMsg) {
    if (!this.serverUrl) {
      this.log(`❌ _doConnect 被调用但 serverUrl 为 null，放弃中继`);
      return;
    }
    let serverWs;
    try {
      // 🔧 Bypass hosts 文件：将 WebSocket URL 中的 hostname 解析到真实 IP
      let connectUrl = this.serverUrl;
      try {
        const urlObj = new URL(this.serverUrl);
        if (urlObj.hostname === OFFICIAL_HOST || urlObj.hostname.endsWith('.tenclass.net')) {
          const realIp = await _resolveRealHost();
          urlObj.hostname = realIp;
          connectUrl = urlObj.href;
          this.log(`🔧 直连真实服务器 IP: ${realIp}`);
        }
      } catch (_) {}

      // 匹配固件 websocket_protocol.cc 行为：带 Authorization/Device-Id/Client-Id/Protocol-Version 头
      serverWs = new WebSocket(connectUrl, {
        headers: {
          'Host': OFFICIAL_HOST,
          'Device-Id': deviceId,
          'Client-Id': this._mockUuid,
          'Protocol-Version': '1',
        },
        rejectUnauthorized: false,
      });
    } catch (err) {
      this.log(`❌ 无法创建 WebSocket 连接 [${deviceId}]: ${err.message}`);
      return;
    }

    const ctx = {
      deviceWs,
      serverWs,
      deviceReady: true,
      serverReady: false,
      pendingMessages: [],
    };
    this.relays.set(deviceId, ctx);

    serverWs.on('open', () => {
      this.log(`✅ 官方服务器连接成功 [${deviceId}]`);
      try {
        serverWs.send(JSON.stringify(helloMsg));
        this.log(`📤 已转发 hello → 官方服务器 [${deviceId}]`);
      } catch (err) {
        this.log(`⚠ 发送 hello 失败 [${deviceId}]: ${err.message}`);
      }
    });

    serverWs.on('message', (data, isBinary) => {
      try {
        if (isBinary) {
          deviceWs.send(data);
        } else {
          const msgStr = data.toString();
          try {
            const msg = JSON.parse(msgStr);
            if (msg.type === 'hello') {
              ctx.serverReady = true;
              this.log(`👋 官方服务器 hello 确认 [${deviceId}], session=${msg.session_id || '?'}`);
              for (const pending of ctx.pendingMessages) {
                try { serverWs.send(pending.data, { binary: pending.isBinary }); } catch (_) {}
              }
              ctx.pendingMessages = [];
            }
          } catch (_) {}

          deviceWs.send(msgStr);
        }
      } catch (err) {
        this.log(`⚠ 转发到设备失败 [${deviceId}]: ${err.message}`);
      }
    });

    serverWs.on('close', (code) => {
      this.log(`🔌 官方服务器断开 [${deviceId}], code=${code}`);
      ctx.serverReady = false;
      this.relays.delete(deviceId);
      // BUGFIX: 官方服务器断开时，绝对不能关闭设备连接！
      // 否则会导致设备→断开→重连→relay又拦截→又断开→死循环
      // 正确做法：静默清理 relay 上下文，音频回落本地 AI 处理
      this.log(`[中继] 官方服务器断连 [${deviceId}]，设备保持连接，回落本地 AI`);
      
      // 🔧 智能退避：如果官方服务器主动断开（非正常关闭），自动禁用中继
      // 防止设备每次重连都触发 relay 尝试 → 失败的无限循环
      if (code !== 1000 && code !== 1001) {
        this.log(`[中继] ⚠ 官方服务器异常断开 (code=${code})，自动禁用中继模式`);
        this.enabled = false;
        this.emit('status', { enabled: false, url: this.serverUrl, reason: `官方服务器断开 code=${code}` });
      }
      
      this.emit('serverDisconnected', { deviceId, code });
    });

    serverWs.on('error', (err) => {
      this.log(`⚠ 官方服务器错误 [${deviceId}]: ${err.message}`);
      ctx.serverReady = false;
      this.relays.delete(deviceId);
      // BUGFIX: 官方服务器出错时同样不关闭设备连接，回落本地 AI
      this.log(`[中继] 官方服务器错误 [${deviceId}]，设备保持连接，回落本地 AI`);
      this.emit('serverError', { deviceId, error: err.message });
    });
  }

  /**
   * 设备发送数据时调用
   */
  onDeviceMessage(deviceId, data, isBinary) {
    if (!this.enabled) return false;

    const ctx = this.relays.get(deviceId);
    if (!ctx || !ctx.serverWs) return false;

    if (!ctx.serverReady) {
      ctx.pendingMessages.push({ data, isBinary });
      return true;
    }

    try {
      if (isBinary) {
        ctx.serverWs.send(data);
      } else {
        ctx.serverWs.send(data.toString());
      }
      return true;
    } catch (err) {
      this.log(`⚠ 中继发送失败 [${deviceId}]: ${err.message}`);
      return false;
    }
  }

  /**
   * 设备断开时调用
   */
  onDeviceDisconnected(deviceId) {
    const ctx = this.relays.get(deviceId);
    if (ctx) {
      this.log(`🔌 设备断开 [${deviceId}]，关闭中继`);
      try { ctx.serverWs.close(1000, 'Device disconnected'); } catch (_) {}
      this.relays.delete(deviceId);
    }
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      enabled: this.enabled,
      serverUrl: this.serverUrl,
      activeRelays: this.relays.size,
      devices: [...this.relays.keys()],
    };
  }
}
