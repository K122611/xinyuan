import React, { useState, useEffect, useCallback, useRef } from 'react';
import { usePetStore, SHOP_ITEMS } from '../store';

const PET_EMOJIS: Record<string, string> = {
  normal: '🐱', calm: '🐱',
  happy: '😸',
  loved: '😻',
  thinking: '🤔',
  sleepy: '😴',
  hungry: '🍽️',
  excited: '🎉',
};

const EMOTION_LABELS: Record<string, string> = {
  normal: '平静', calm: '平静',
  happy: '开心',
  loved: '被爱',
  thinking: '思考中',
  sleepy: '困了',
  hungry: '饿了',
  excited: '兴奋',
};

const WANDER_MESSAGES = [
  '今天天气真好~', '想喝奶茶了…', '好安静呀', '有人在吗？',
  '肚子有点饿了', '想出去走走', '发会儿呆…', '✨',
  '喵~', '好无聊哦', '唱首歌吧♪', '(*^▽^*)',
];

export default function FloatingPetPage() {
  const wanderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ============ 从共享 Store 读取 ============
  const pet = usePetStore((s) => s.pet);
  const loadPet = usePetStore((s) => s.loadPet);

  // ============ 本地 UI 状态 ============
  const [entranceDone, setEntranceDone] = useState(false);
  const [speechBubble, setSpeechBubble] = useState<string | null>(null);
  const [bubbleTimer, setBubbleTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [wandering, setWandering] = useState(false);
  const [wanderX, setWanderX] = useState(0);
  const [wanderY, setWanderY] = useState(0);
  // 本地体力计数（避免每秒触发 store 渲染）
  const [localEnergy, setLocalEnergy] = useState(pet.energy);

  // 主应用修改 pet → 同步本地体力
  useEffect(() => { setLocalEnergy(pet.energy); }, [pet.energy]);

  // 启动时加载持久化 pet 数据
  useEffect(() => { loadPet(); }, []); // eslint-disable-line

  // ============ 入场动画 ============
  useEffect(() => {
    const timer = setTimeout(() => setEntranceDone(true), 400);
    return () => clearTimeout(timer);
  }, []);

  // ============ 体力消耗 ============
  useEffect(() => {
    const interval = setInterval(() => {
      setLocalEnergy((prev) => {
        const next = Math.max(0, prev - 0.005);
        // 每 5 秒存一次 localStorage
        if (Math.round(next * 100) % 50 === 0) {
          try {
            const raw = localStorage.getItem('xinyuan_pet');
            if (raw) {
              const data = JSON.parse(raw);
              data.energy = next;
              localStorage.setItem('xinyuan_pet', JSON.stringify(data));
            }
          } catch {}
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ============ 气泡 ============
  const showBubble = useCallback((text: string, duration = 3000) => {
    if (bubbleTimer) clearTimeout(bubbleTimer);
    setSpeechBubble(text);
    const timer = setTimeout(() => {
      setSpeechBubble(null);
      setBubbleTimer(null);
    }, duration);
    setBubbleTimer(timer);
  }, [bubbleTimer]);

  // ============ 漫游 ============
  const scheduleWander = useCallback(() => {
    if (wanderTimer.current) clearTimeout(wanderTimer.current);
    const delay = 4000 + Math.random() * 8000;
    wanderTimer.current = setTimeout(() => {
      setWandering(true);
      setWanderX((Math.random() - 0.5) * 30);
      setWanderY((Math.random() - 0.5) * 20);
      if (Math.random() < 0.35) {
        showBubble(WANDER_MESSAGES[Math.floor(Math.random() * WANDER_MESSAGES.length)]);
      }
      wanderTimer.current = setTimeout(() => {
        setWandering(false);
        setWanderX(0);
        setWanderY(0);
        scheduleWander();
      }, 1800);
    }, delay);
  }, [showBubble]);

  useEffect(() => {
    scheduleWander();
    return () => { if (wanderTimer.current) clearTimeout(wanderTimer.current); };
  }, [scheduleWander]);

  // ============ 渲染 ============
  const petEmoji = PET_EMOJIS[pet.mood] || PET_EMOJIS.normal;
  const emotionLabel = EMOTION_LABELS[pet.mood] || EMOTION_LABELS.normal;
  const energy = Math.round(localEnergy * 10); // 0-10 → 0-100
  const energyColor = energy > 60 ? '#4ade80' : energy > 30 ? '#facc15' : '#ef4444';

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        userSelect: 'none',
        transform: entranceDone
          ? `translate(${wanderX}px, ${wanderY}px) scale(1)`
          : `translate(${wanderX}px, ${wanderY}px) scale(0.85)`,
        transition: wandering
          ? 'transform 1.8s cubic-bezier(0.34, 1.56, 0.64, 1)'
          : entranceDone
            ? 'transform 1.8s cubic-bezier(0.34, 1.56, 0.64, 1)'
            : 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
        opacity: 1,
      }}
    >
      {/* ===== 宠物交互区 ===== */}
      <div
        onContextMenu={(e) => e.preventDefault()}
        style={{
          WebkitAppRegion: 'no-drag',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          padding: '16px 20px',
          borderRadius: 24,
          background: 'rgba(0,0,0,0.25)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.15)',
        }}
      >
        {/* ===== 图标区 —— drag 区域原生拖动 ===== */}
        <div
          style={{
            WebkitAppRegion: 'drag',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            borderRadius: 20,
            cursor: 'grab',
          }}
        >
          {/* 宠物本体 */}
          <div
            style={{
              fontSize: 32,
              lineHeight: 1,
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
              marginBottom: 2,
            }}
          >
            {petEmoji}
          </div>

          {/* 装饰品 */}
          {Array.isArray(pet.accessories) && pet.accessories.length > 0 && (
            <div style={{ display: 'flex', gap: 2, justifyContent: 'center', fontSize: 13, marginTop: -4 }}>
              {pet.accessories.map(id => {
                const item = SHOP_ITEMS.find(i => i.id === id);
                return item ? <span key={id} title={item.name}>{item.emoji}</span> : null;
              })}
            </div>
          )}

          {/* 情绪标签 */}
          <div
            style={{
              fontSize: 11,
              color: '#aaa',
              fontWeight: 500,
              lineHeight: 1,
              textShadow: '0 1px 2px rgba(0,0,0,0.4)',
            }}
          >
            {emotionLabel}
          </div>

          {/* 体力条 */}
          <div
            style={{
              width: 72,
              height: 5,
              background: 'rgba(255,255,255,0.15)',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${energy}%`,
                height: '100%',
                background: energyColor,
                borderRadius: 3,
                transition: 'width 1s linear, background 0.5s ease',
              }}
            />
          </div>

          {/* 等级 / 经验 */}
          <div
            style={{
              fontSize: 10,
              color: '#aaa',
              lineHeight: 1,
              textShadow: '0 1px 2px rgba(0,0,0,0.4)',
            }}
          >
            Lv.{pet.level} · {pet.exp} EXP
          </div>
        </div>

        {/* ===== 气泡 ===== */}
        {speechBubble && (
          <div
            style={{
              position: 'absolute',
              bottom: -8,
              maxWidth: 220,
              padding: '8px 14px',
              background: 'rgba(255,255,255,0.92)',
              borderRadius: 16,
              fontSize: 13,
              color: '#444',
              lineHeight: 1.5,
              boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
              animation: 'bubbleIn 0.3s ease-out',
              textAlign: 'center',
              wordBreak: 'break-word',
              WebkitAppRegion: 'no-drag',
            }}
          >
            {speechBubble}
            <div
              style={{
                position: 'absolute',
                top: -6,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 0,
                height: 0,
                borderLeft: '6px solid transparent',
                borderRight: '6px solid transparent',
                borderBottom: '6px solid rgba(255,255,255,0.92)',
              }}
            />
          </div>
        )}
      </div>

      {/* ===== CSS 动画 ===== */}
      <style>{`
        @keyframes bubbleIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
