/**
 * 自动检测本机热点 IP
 *
 * Windows 移动热点默认网关 IP: 192.168.137.1
 * 如果检测到其他地址，也会返回
 */
const os = require('os');

function detectHotspotIP() {
  const interfaces = os.networkInterfaces();

  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;

      // Windows 移动热点接口特征：
      // - IP 在 192.168.137.x 网段
      // - 或者接口名包含 "Hotspot" / "Local Area Connection*"
      if (addr.address.startsWith('192.168.137.')) {
        return { ip: addr.address, interface: name, type: 'hotspot' };
      }
    }
  }

  // 没有找到标准热点 IP，尝试找到可用的局域网 IP
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (addr.address.startsWith('192.168.') || addr.address.startsWith('10.')) {
        return { ip: addr.address, interface: name, type: 'lan' };
      }
    }
  }

  return null;
}

module.exports = { detectHotspotIP };

// 直接运行时输出检测结果
if (require.main === module) {
  const result = detectHotspotIP();
  if (result) {
    console.log(JSON.stringify(result));
  } else {
    console.error('未检测到可用 IP');
    process.exit(1);
  }
}
