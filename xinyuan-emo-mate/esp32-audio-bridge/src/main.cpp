/**
 * 心元音频桥接 - ESP32-S3 极简固件
 * 
 * 功能：USB 串口音频透明传输
 * - 麦克风 (INMP441) → I2S 采集 → USB 串口 → PC
 * - PC → USB 串口 → I2S 播放 → 扬声器 (MAX98357)
 * 
 * 协议 (二进制帧):
 *   [0xAA] [type:1B] [length:2B BE] [data...] [0x55]
 *   帧头 0xAA, 帧尾 0x55, type: 0x01=麦克风PCM, 0x02=扬声器PCM, 0x03=命令
 * 
 * 音频格式: 16kHz, 16bit, 单声道, PCM
 */

#include <Arduino.h>
#include <driver/i2s.h>

// ========== 引脚配置 (通过 platformio.ini build_flags 覆盖) ==========
#ifndef I2S_MIC_BCLK
#define I2S_MIC_BCLK  4
#endif
#ifndef I2S_MIC_LRCLK
#define I2S_MIC_LRCLK 5
#endif
#ifndef I2S_MIC_DATA
#define I2S_MIC_DATA   6
#endif
#ifndef I2S_SPK_BCLK
#define I2S_SPK_BCLK  15
#endif
#ifndef I2S_SPK_LRCLK
#define I2S_SPK_LRCLK 16
#endif
#ifndef I2S_SPK_DATA
#define I2S_SPK_DATA   7
#endif
#ifndef I2S_SPK_ENABLE
#define I2S_SPK_ENABLE -1  // -1 表示无使能引脚
#endif

// ========== 音频参数 ==========
#define SAMPLE_RATE      16000
#define BITS_PER_SAMPLE  16
#define NUM_CHANNELS     1
#define DMA_BUF_COUNT    8
#define DMA_BUF_LEN      512

// 串口传输块大小 (采样点数)
#define AUDIO_CHUNK_SAMPLES 512  // 512 采样 * 2 字节 = 1024 字节/帧
// 串口波特率 (921600 足够 16kHz 16bit 单声道实时传输)
#define SERIAL_BAUD      921600

// ========== 帧协议常量 ==========
#define FRAME_HEADER  0xAA
#define FRAME_FOOTER  0x55
#define FRAME_TYPE_MIC_AUDIO  0x01
#define FRAME_TYPE_SPK_AUDIO  0x02
#define FRAME_TYPE_COMMAND    0x03

// 命令
#define CMD_START_CAPTURE  0x10
#define CMD_STOP_CAPTURE   0x11
#define CMD_PING           0x20
#define CMD_PONG           0x21

// ========== 全局状态 ==========
static bool capture_enabled = true;
static uint32_t last_ping = 0;
static uint32_t total_mic_bytes = 0;
static uint32_t total_spk_bytes = 0;

// I2S 配置
static i2s_config_t mic_config;
static i2s_pin_config_t mic_pins;
static i2s_config_t spk_config;
static i2s_pin_config_t spk_pins;

// ========== 初始化 ==========
void setup() {
  // 0. 如果扬声器有使能引脚，先拉高
  #if I2S_SPK_ENABLE >= 0
  pinMode(I2S_SPK_ENABLE, OUTPUT);
  digitalWrite(I2S_SPK_ENABLE, HIGH);
  #endif

  // 1. USB 串口
  Serial.begin(SERIAL_BAUD);
  while (!Serial && millis() < 3000) {
    delay(10);
  }

  // 2. I2S 麦克风 (输入)
  mic_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = (i2s_bits_per_sample_t)BITS_PER_SAMPLE,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = DMA_BUF_COUNT,
    .dma_buf_len = DMA_BUF_LEN,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0,
  };

  mic_pins = {
    .bck_io_num = I2S_MIC_BCLK,
    .ws_io_num = I2S_MIC_LRCLK,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_MIC_DATA,
  };

  esp_err_t err = i2s_driver_install(I2S_NUM_0, &mic_config, 0, NULL);
  if (err != ESP_OK) {
    Serial.println("ERR:MIC_INIT");
  }
  err = i2s_set_pin(I2S_NUM_0, &mic_pins);
  if (err != ESP_OK) {
    Serial.println("ERR:MIC_PIN");
  }
  // 清空麦克风 DMA 缓冲区
  i2s_zero_dma_buffer(I2S_NUM_0);

  // 3. I2S 扬声器 (输出)
  spk_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = (i2s_bits_per_sample_t)BITS_PER_SAMPLE,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = DMA_BUF_COUNT,
    .dma_buf_len = DMA_BUF_LEN,
    .use_apll = false,
    .tx_desc_auto_clear = true,
    .fixed_mclk = 0,
  };

  spk_pins = {
    .bck_io_num = I2S_SPK_BCLK,
    .ws_io_num = I2S_SPK_LRCLK,
    .data_out_num = I2S_SPK_DATA,
    .data_in_num = I2S_PIN_NO_CHANGE,
  };

  err = i2s_driver_install(I2S_NUM_1, &spk_config, 0, NULL);
  if (err != ESP_OK) {
    Serial.println("ERR:SPK_INIT");
  }
  err = i2s_set_pin(I2S_NUM_1, &spk_pins);
  if (err != ESP_OK) {
    Serial.println("ERR:SPK_PIN");
  }

  last_ping = millis();
  Serial.println("READY");
}

// ========== 发送麦克风音频帧 ==========
void send_mic_frame(const uint8_t* data, size_t len) {
  if (len == 0 || len > 65535) return;

  uint8_t header[4];
  header[0] = FRAME_HEADER;
  header[1] = FRAME_TYPE_MIC_AUDIO;
  header[2] = (len >> 8) & 0xFF;
  header[3] = len & 0xFF;

  Serial.write(header, 4);
  Serial.write(data, len);
  Serial.write(FRAME_FOOTER);

  total_mic_bytes += len;
}

// ========== 主循环 ==========
void loop() {
  static uint8_t mic_buffer[AUDIO_CHUNK_SAMPLES * 2];  // 16bit = 2 bytes/sample
  static size_t rx_buffer_pos = 0;
  static uint8_t rx_buffer[4096];

  // ---- 麦克风 → PC ----
  if (capture_enabled) {
    size_t bytes_read = 0;
    esp_err_t err = i2s_read(I2S_NUM_0, mic_buffer, sizeof(mic_buffer), &bytes_read, 0);
    if (err == ESP_OK && bytes_read > 0) {
      send_mic_frame(mic_buffer, bytes_read);
    }
  }

  // ---- PC → 扬声器 ----
  while (Serial.available() > 0) {
    uint8_t b = Serial.read();

    if (rx_buffer_pos == 0) {
      // 等待帧头
      if (b == FRAME_HEADER) {
        rx_buffer[rx_buffer_pos++] = b;
      }
      // 如果不是帧头且不是 READY 文本消息，忽略
    } else if (rx_buffer_pos == 1) {
      // 类型
      rx_buffer[rx_buffer_pos++] = b;
    } else if (rx_buffer_pos == 2) {
      // 长度高字节
      rx_buffer[rx_buffer_pos++] = b;
    } else if (rx_buffer_pos == 3) {
      // 长度低字节
      rx_buffer[rx_buffer_pos++] = b;
      uint16_t data_len = (rx_buffer[2] << 8) | rx_buffer[3];
      if (data_len == 0) {
        // 无数据帧，直接等帧尾
        rx_buffer_pos = 4;
      }
    } else if (rx_buffer_pos >= 4) {
      uint16_t data_len = (rx_buffer[2] << 8) | rx_buffer[3];
      size_t total_frame_size = 4 + data_len + 1;  // header + data + footer

      if (rx_buffer_pos < total_frame_size - 1) {
        // 数据字节
        if (rx_buffer_pos < sizeof(rx_buffer)) {
          rx_buffer[rx_buffer_pos++] = b;
        }
      } else {
        // 帧尾
        if (b == FRAME_FOOTER) {
          // 处理完整帧
          uint8_t type = rx_buffer[1];
          uint8_t* payload = rx_buffer + 4;

          if (type == FRAME_TYPE_SPK_AUDIO && data_len > 0) {
            // 播放音频
            size_t written = 0;
            i2s_write(I2S_NUM_1, payload, data_len, &written, portMAX_DELAY);
            total_spk_bytes += written;
          } else if (type == FRAME_TYPE_COMMAND) {
            // 处理命令
            if (data_len >= 1) {
              uint8_t cmd = payload[0];
              switch (cmd) {
                case CMD_START_CAPTURE:
                  capture_enabled = true;
                  break;
                case CMD_STOP_CAPTURE:
                  capture_enabled = false;
                  break;
                case CMD_PING: {
                  // 回复 PONG
                  uint8_t pong[] = { CMD_PONG };
                  uint8_t resph[4] = { FRAME_HEADER, FRAME_TYPE_COMMAND, 0, 1 };
                  Serial.write(resph, 4);
                  Serial.write(pong, 1);
                  Serial.write(FRAME_FOOTER);
                  break;
                }
              }
            }
          }
        }
        rx_buffer_pos = 0;
      }
    }
  }

  // ---- 定期心跳 ----
  uint32_t now = millis();
  if (now - last_ping > 5000) {
    // 每5秒输出统计
    // Serial.printf("STAT:%u,%u\n", total_mic_bytes, total_spk_bytes);
    last_ping = now;
  }

  delay(1);  // 让出 CPU
}
