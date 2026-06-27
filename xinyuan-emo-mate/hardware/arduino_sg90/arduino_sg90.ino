/**
 * 心元 EMO-Mate — SG90 舵机情绪驱动器 (丝滑版)
 * 串口协议: ANGLE:0~180 (以换行符结束)
 * 收到后渐进移动舵机并回复 "OK <角度>"
 * 上电后回复 "READY" 通知上位机
 */

#include <Servo.h>

Servo emotionServo;
const int SERVO_PIN = 9;

int currentAngle = 90;   // 当前实际角度
int targetAngle = 90;    // 目标角度
unsigned long lastStepMs = 0;
const int STEP_DELAY_MS = 15;  // 每步间隔15ms → 丝滑慢速
const int STEP_SIZE = 1;       // 每步1度 → 细腻过渡

bool readySent = false;

void setup() {
  emotionServo.attach(SERVO_PIN);
  emotionServo.write(90);          // 归中
  Serial.begin(9600);
  delay(500);
  Serial.println("READY");
  readySent = true;
  currentAngle = 90;
  targetAngle = 90;
}

void loop() {
  // ——— 丝滑插值：逐步逼近目标角度 ———
  if (currentAngle != targetAngle) {
    unsigned long now = millis();
    if (now - lastStepMs >= STEP_DELAY_MS) {
      lastStepMs = now;
      if (currentAngle < targetAngle) {
        currentAngle = min(currentAngle + STEP_SIZE, targetAngle);
      } else {
        currentAngle = max(currentAngle - STEP_SIZE, targetAngle);
      }
      emotionServo.write(currentAngle);
    }
  }

  // ——— 接收串口指令 ———
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd.startsWith("ANGLE:")) {
      targetAngle = cmd.substring(6).toInt();
      targetAngle = constrain(targetAngle, 0, 180);
      Serial.print("OK ");
      Serial.println(targetAngle);
    }
    else if (cmd == "RESET") {
      targetAngle = 90;
      Serial.println("OK 90");
    }
    else if (cmd == "PING") {
      Serial.println("PONG");
    }
    else if (cmd == "SPEED:FAST") {
      // 心跳状态时可加速（待扩展）
      Serial.println("OK FAST");
    }
    else if (cmd == "SPEED:SLOW") {
      Serial.println("OK SLOW");
    }
  }
}
