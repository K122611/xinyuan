/**
 * ESP32 WiFi 配置工具
 *
 * 用途：当应用迁移到新电脑时，配置 ESP32 连接新电脑的 WiFi 热点
 *
 * 用法：
 *   node scripts/setup_wifi.cjs <热点名> <密码> [COM端口]
 *   node scripts/setup_wifi.cjs "MyLaptop 1234" "password123"
 *   node scripts/setup_wifi.cjs "MyLaptop 1234" "password123" COM5
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NVS_OUTPUT = path.join(ROOT, 'xiaozhi-firmware', 'nvs_custom.csv');

function detectCOMPort() {
  try {
    // Windows: 用 PowerShell 检测 ESP32-S3 设备
    const result = execSync(
      'powershell -Command "Get-WMIObject Win32_SerialPort | Select-Object -ExpandProperty DeviceID"',
      { encoding: 'utf-8', timeout: 5000 }
    );
    const ports = result.trim().split(/\s+/).filter(p => p);
    return ports.length > 0 ? ports[0] : null;
  } catch {
    return null;
  }
}

function generateNvsCsv(ssid, password) {
  const otaUrl = 'http://192.168.137.1:8888/xiaozhi/ota/';

  return [
    'key,type,encoding,value',
    'wifi,namespace,,',
    `ssid,data,string,${ssid}`,
    `password,data,string,${password}`,
    `ota_url,data,string,${otaUrl}`,
    ''
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('用法: node scripts/setup_wifi.cjs <WiFi名称> <密码> [COM端口]');
    console.log('示例: node scripts/setup_wifi.cjs "MyLaptop 2483" "mypassword"');
    console.log('      node scripts/setup_wifi.cjs "MyLaptop 2483" "mypassword" COM5');
    console.log('');
    console.log('说明:');
    console.log('  1. 在新电脑上开启移动热点');
    console.log('  2. 记下热点名称和密码');
    console.log('  3. 运行此脚本生成新的 NVS 配置');
    console.log('  4. 用 USB 线连接 ESP32 设备到电脑');
    console.log('  5. 运行输出的 esptool 命令刷写 NVS 分区');
    console.log('  6. 如不指定 COM 端口，脚本会自动检测');
    process.exit(1);
  }

  const ssid = args[0];
  const password = args[1];
  const comPort = args[2] || detectCOMPort() || 'COM5';

  console.log(`WiFi 名称: ${ssid}`);
  console.log(`WiFi 密码: ${'*'.repeat(password.length)}`);
  console.log(`COM 端口: ${comPort}${args[2] ? '' : ' (自动检测)'}`);
  console.log('');

  // 生成 NVS CSV
  const csv = generateNvsCsv(ssid, password);
  fs.mkdirSync(path.dirname(NVS_OUTPUT), { recursive: true });
  fs.writeFileSync(NVS_OUTPUT, csv, 'utf-8');
  console.log(`✓ NVS 配置文件已生成: ${NVS_OUTPUT}`);
  console.log('');

  // 输出刷写命令
  console.log('========================================');
  console.log('        刷写命令');
  console.log('========================================');
  console.log('');
  console.log('# 确保 ESP32 进入下载模式:');
  console.log('#   按住 BOOT 键 → 按一下 EN 键 → 松开 BOOT 键');
  console.log('');
  console.log(`esptool.py --chip esp32s3 --port ${comPort} write_flash 0x9000 xiaozhi-firmware/nvs_custom.csv`);
  console.log('');
  console.log('# 如果没有 esptool，先安装: pip install esptool');
  console.log('');
  console.log('========================================');
  console.log('  刷写完成后:');
  console.log('  1. 按 ESP32 的 EN (RST) 键重启');
  console.log('  2. 在新电脑上运行 启动心元_portable.bat');
  console.log('  3. ESP32 连接新热点并自动对接应用');
  console.log('========================================');
}

main();
