# 心元 AI — 智能仓鼠伙伴

心元是一款基于 ESP32 硬件 + Electron 桌面应用的语音 AI 交互伴侣。通过心元 ESP32 设备，你可以与 AI 仓鼠伙伴进行自然语音对话，体验温暖俏皮的互动。

> **项目状态：** 	v1.0.11 — MVP 版本，核心对话功能稳定。

## 功能特性

-   **语音对话** — 通过心元 ESP32 设备采集语音，Electron 桌面端进行 AI 对话处理
-   **情绪感知** — Coze AI 引擎支持情绪识别，返回带有情绪标签的个性化回复
-   **实时流式 TTS** — 支持早期播放（首句合成即播放），低延迟语音输出
-   **VAD 语音检测** — 自研 VAD 状态机（idle → speaking → silence → idle），精准识别说话段落
-   **离线兜底** — System.Speech 引擎本地兜底，断网也能进行文本转语音
-   **搜素增强** — 自动识别查询类问题（日期、天气、知识），通过 Coze 联网增强回答
-   **LED 表情联动** — 心元 ESP32 的 LED 矩阵根据对话情绪显示不同表情

## 系统架构

```
[你说话] → ESP32 麦克风 → Opus 编码 → WebSocket
                ↓
          Electron App (xiaozhi-relay.js)
                ↓
          ai-conversation.js (核心)
          ├── VAD 语音检测
          ├── Coze STT (语音转文字)
          ├── Coze SSE (AI 对话)
          ├── 情绪标签解析
          ├── Coze TTS (文字转语音)
                ↓
          Opus 帧 → WebSocket → ESP32 喇叭播放
```

## 快速开始

### 1. 环境要求

-   **Node.js** v18+
-   **npm** v9+
-   **心元 ESP32 设备**（基于小智开源固件改造）

### 2. 克隆项目

```bash
git clone https://github.com/YOUR_USERNAME/xinyuan-emo-mate.git
cd xinyuan-emo-mate
```

### 3. 安装依赖

```bash
npm install
```

### 4. 配置 API 密钥

```bash
# 复制配置模板
copy .env.example .env      # Windows
# 或
cp .env.example .env        # Mac/Linux

# 编辑 .env 文件，填入你的 Coze API 密钥
```

获取 Coze API 密钥：https://www.coze.cn → 个人设置 → API Token

### 5. 运行开发模式

```bash
npm run dev
```

### 6. 连接心元 ESP32

1. 确保心元 ESP32 已上电并连接到同一 WiFi 网络
2. 在 Electron 应用中输入 ESP32 的 IP 地址
3. 点击连接，等待状态变为"已连接"

## 打包构建

```bash
npm run electron:build
```

构建产物在 `release2` 目录，生成 Windows NSIS 安装包。

## 项目结构

```
xinyuan-emo-mate/
├── electron/               # Electron 主进程代码
│   ├── main.js             # Electron 入口
│   ├── ai-conversation.js  # AI 对话核心（VAD/STT/LLM/TTS）
│   ├── xiaozhi-bridge.js   # ESP32 WebSocket 通信
│   ├── xiaozhi-relay.js    # ESP32 数据转发
│   ├── servo.js            # 舵机控制（预留）
│   └── preload.js          # 预加载脚本
├── src/                    # 前端 Vue/React 源码
├── public/                 # 静态资源
├── assets/                 # 应用图标
├── .env.example            # 环境变量模板
├── package.json            # 项目配置
└── electron-builder.yml    # 打包配置
```

## 技术栈

| 模块 | 技术 |
|------|------|
| 桌面框架 | Electron v33 |
| 语音识别 | Coze STT API + System.Speech |
| AI 对话 | Coze SSE 流式 API |
| 语音合成 | Coze TTS API (PCM 16kHz) |
| 音频编解码 | Opus (opusscript) |
| 实时通信 | WebSocket |
| 硬件 | ESP32-S3 (基于小智开源固件改造) |

## 开源许可

MIT License

---

**心元 — 你的智能仓鼠伙伴	**
