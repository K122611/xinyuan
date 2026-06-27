# 心元 EMO-Mate 跨电脑部署指南

## 前提条件

- **Windows 10/11** 电脑
- **Node.js 18+** (https://nodejs.org 下载 LTS 版)
- **Python 3** (可选，SSL 证书功能需要)

---

## 第一步：在新电脑上部署应用

### 1.1 复制文件夹
将整个 `心元` 文件夹复制到新电脑上任意位置。

### 1.2 安装依赖
在 `心元` 文件夹中打开命令行，运行：
```bash
npm install --production
```

---

## 第二步：配置 WiFi 热点

### 2.1 开启 Windows 移动热点
1. 打开 **设置 → 网络和 Internet → 移动热点**
2. 开启 **"从我的 Internet 连接共享"**
3. 记下 **网络名称** 和 **网络密码**（可点击"编辑"修改）

> ⚠️ Windows 移动热点的默认 IP 是 `192.168.137.1`，应用会自动检测。

---

## 第三步：配置 ESP32 设备 WiFi

> 如果 ESP32 设备之前已配置过当前电脑的热点，可跳过此步骤。

### 3.1 生成新配置
```bash
node scripts/setup_wifi.cjs "你的热点名称" "你的热点密码"
```

例如：
```bash
node scripts/setup_wifi.cjs "DESKTOP-ABC 1234" "mypassword"
```

### 3.2 刷写配置到 ESP32
1. 用 **USB-C 数据线** 连接 ESP32 到电脑
2. 按住 ESP32 上的 **BOOT 键**，按一下 **EN (RST) 键**，松开 BOOT 键（进入下载模式）
3. 运行脚本输出的 `esptool.py` 命令

查看 COM 端口：
```powershell
Get-WMIObject Win32_SerialPort | Select Name,Description
```

---

## 第四步：启动应用

双击 **`启动心元_portable.bat`**

或手动启动：
```bash
node scripts/auto_detect_ip.cjs        # 检测本机 IP
node start_bridge.js --ip=192.168.137.1  # 启动桥接
node start_ota.cjs                       # 启动 OTA
node launcher.mjs --ip=192.168.137.1     # 启动应用
```

---

## 第五步：连接 ESP32 设备

1. ESP32 上电启动
2. 设备会自动连接配置的 WiFi 热点
3. 连接成功后，设备会对接桥接服务
4. 应用中出现设备在线提示即完成

---

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| 设备连不上热点 | 确认热点已开启，WiFi 名称/密码正确 |
| 设备在线但无声音 | 检查 Windows 音频输出设备，确认 TTS 引擎正常 |
| IP 检测失败 | 确保已开启 Windows 移动热点 |
| COM 端口找不到 | 安装 CP210x USB 驱动 |
| esptool 命令不存在 | `pip install esptool` |
| 端口被占用 | 关闭占用 8888/443/1883 的程序 |

---

## 说明

- **不需要 DNS 劫持**：ESP32 直连 `192.168.137.1`（Windows 热点标准 IP）
- **不需要 ARP 欺骗**：全程直连 IP，无需任何网络中间人操作
- **所有路径为相对路径**：文件夹可以放在任意位置
