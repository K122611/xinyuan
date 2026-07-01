/*
 * 心元音频桥接 - ESP32-S3 Arduino 版
 * 
 * 使用方法:
 * 1. Arduino IDE → 文件 → 首选项 → 附加开发板管理器网址:
 *    https://espressif.github.io/arduino-esp32/package_esp32_index.json
 * 2. 工具 → 开发板 → 开发板管理器 → 搜索 esp32 → 安装
 * 3. 选择开发板: ESP32S3 Dev Module
 * 4. 配置:
 *    - USB CDC On Boot: Enabled
 *    - Flash Size: 16MB
 *    - Partition Scheme: 16M Flash (3MB APP/9.9MB FATFS)
 *    - PSRAM: OPI PSRAM
 * 5. 编译上传
 * 
 * 引脚说明 (小智 ESP32-S3-CAM):
 *   I2S 麦克风 INMP441: BCLK=GPIO4, LRCLK=GPIO5, DATA=GPIO6
 *   I2S 扬声器 MAX98357: BCLK=GPIO15, LRCLK=GPIO16, DATA=GPIO7
 *   如引脚不同，修改下方 PIN_* 定义
 */

#include <driver/i2s.h>

// ========== 引脚配置 (根据实际接线修改!) ==========
#define PIN_I2S_MIC_BCLK   4
#define PIN_I2S_MIC_LRCLK  5
#define PIN_I2S_MIC_DATA   6
#define PIN_I2S_SPK_BCLK   15
#define PIN_I2S_SPK_LRCLK  16
#define PIN_I2S_SPK_DATA   7
#define PIN_I2S_SPK_ENABLE -1   // -1=无使能引脚

// ========== 音频参数 ==========
#define SAMPLE_RATE       16000
#define AUDIO_CHUNK       512    // 每次发送的采样数
#define SERIAL_BAUD       921600

// ========== 帧协议 ==========
#define FRAME_HEADER  0xAA
#define FRAME_FOOTER  0x55
#define TYPE_MIC      0x01
#define TYPE_SPK      0x02
#define TYPE_CMD      0x03
#define CMD_CAP_START 0x10
#define CMD_CAP_STOP  0x11
#define CMD_PING      0x20
#define CMD_PONG      0x21

// ========== 全局状态 ==========
static bool cap_enabled = true;

// ========== 初始化 I2S 麦克风 ==========
void initMic() {
  i2s_config_t cfg = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 512,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0,
  };
  i2s_pin_config_t pins = {
    .bck_io_num = PIN_I2S_MIC_BCLK,
    .ws_io_num = PIN_I2S_MIC_LRCLK,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = PIN_I2S_MIC_DATA,
  };
  i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pins);
  i2s_zero_dma_buffer(I2S_NUM_0);
  Serial.println("MIC:OK");
}

// ========== 初始化 I2S 扬声器 ==========
void initSpeaker() {
  #if PIN_I2S_SPK_ENABLE >= 0
  pinMode(PIN_I2S_SPK_ENABLE, OUTPUT);
  digitalWrite(PIN_I2S_SPK_ENABLE, HIGH);
  #endif

  i2s_config_t cfg = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 512,
    .use_apll = false,
    .tx_desc_auto_clear = true,
    .fixed_mclk = 0,
  };
  i2s_pin_config_t pins = {
    .bck_io_num = PIN_I2S_SPK_BCLK,
    .ws_io_num = PIN_I2S_SPK_LRCLK,
    .data_out_num = PIN_I2S_SPK_DATA,
    .data_in_num = I2S_PIN_NO_CHANGE,
  };
  i2s_driver_install(I2S_NUM_1, &cfg, 0, NULL);
  i2s_set_pin(I2S_NUM_1, &pins);
  Serial.println("SPK:OK");
}

// ========== 发送麦克风帧 ==========
void sendMicFrame(const uint8_t* data, size_t len) {
  if (len == 0) return;
  uint8_t hdr[] = { FRAME_HEADER, TYPE_MIC, (uint8_t)(len >> 8), (uint8_t)(len & 0xFF) };
  Serial.write(hdr, 4);
  Serial.write(data, len);
  Serial.write(FRAME_FOOTER);
}

// ========== 处理接收帧 ==========
void handleFrame(uint8_t type, const uint8_t* payload, uint16_t len) {
  if (type == TYPE_SPK && len > 0) {
    // 播放音频
    size_t written;
    i2s_write(I2S_NUM_1, payload, len, &written, portMAX_DELAY);
  } else if (type == TYPE_CMD && len >= 1) {
    switch (payload[0]) {
      case CMD_CAP_START: cap_enabled = true; break;
      case CMD_CAP_STOP:  cap_enabled = false; break;
      case CMD_PING: {
        uint8_t pong = CMD_PONG;
        uint8_t hdr[] = { FRAME_HEADER, TYPE_CMD, 0, 1 };
        Serial.write(hdr, 4);
        Serial.write(&pong, 1);
        Serial.write(FRAME_FOOTER);
        break;
      }
    }
  }
}

// ========== 主函数 ==========
void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(500);
  
  initMic();
  initSpeaker();
  
  Serial.println("READY");
}

void loop() {
  static uint8_t mic_buf[AUDIO_CHUNK * 2];   // 16bit
  static uint8_t rx_buf[4096];
  static size_t rx_pos = 0;
  static uint8_t rx_type = 0;
  static uint16_t rx_dlen = 0;
  static uint32_t last_stat = 0;

  // ==== 麦克风 → PC ====
  if (cap_enabled) {
    size_t bytes = 0;
    if (i2s_read(I2S_NUM_0, mic_buf, sizeof(mic_buf), &bytes, 0) == ESP_OK && bytes > 0) {
      sendMicFrame(mic_buf, bytes);
    }
  }

  // ==== PC → 扬声器 (帧解析) ====
  while (Serial.available()) {
    uint8_t b = Serial.read();

    if (rx_pos == 0) {
      if (b == FRAME_HEADER) rx_buf[rx_pos++] = b;
    } else if (rx_pos == 1) {
      rx_type = b;
      rx_buf[rx_pos++] = b;
    } else if (rx_pos == 2) {
      rx_dlen = (b << 8);
      rx_buf[rx_pos++] = b;
    } else if (rx_pos == 3) {
      rx_dlen |= b;
      if (rx_dlen == 0) rx_pos = 4;
      else rx_buf[rx_pos++] = b;
    } else if (rx_pos < 4 + rx_dlen) {
      rx_buf[rx_pos++] = b;
    } else {
      // 帧尾
      if (b == FRAME_FOOTER && rx_dlen > 0) {
        handleFrame(rx_type, rx_buf + 4, rx_dlen);
      }
      rx_pos = 0;
    }
    if (rx_pos >= sizeof(rx_buf)) rx_pos = 0; // 溢出保护
  }

  // ==== 心跳 (每5秒) ====
  uint32_t now = millis();
  if (now - last_stat > 5000) {
    last_stat = now;
    // Serial.printf("STAT:%u\n", now);
  }

  delay(1);
}
