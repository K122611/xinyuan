import React, { useEffect, useState, useRef, useCallback } from 'react';
import { usePetStore } from '../store';
import { petIPC, PetMessage } from '../services/petIPC';

// ============ 情绪与表情映射 ============
const emotionMap: Record<string, string> = {
  happy: '😊', excited: '🤩', calm: '😌', neutral: '😶',
  sad: '😢', tired: '😴', anxious: '😰', angry: '😤',
  loved: '🥰', playful: '😜', curious: '🤔',
};
const emotionLabels: Record<string, string> = {
  happy: '开心', excited: '兴奋', calm: '平静', neutral: '普通',
  sad: '难过', tired: '疲惫', anxious: '焦虑', angry: '生气',
  loved: '被爱', playful: '调皮', curious: '好奇',
};

// ============ 桌宠组件 ============
const FloatingPetPage: React.FC = () => {
  const [mood, setMood] = useState('neutral');
  const [energy, setEnergy] = useState(80);
  const [exp, setExp] = useState(0);
  const [level, setLevel] = useState(1);
  const [speechBubble, setSpeechBubble] = useState<string | null>(null);
  const [bubbleTimeout, setBubbleTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  // 动画状态
  const [entranceDone, setEntranceDone] = useState(false);
  const [wandering, setWandering] = useState(false);
  const [wanderX, setWanderX] = useState(0);
  const [wanderY, setWanderY] = useState(0);
  const [petted, setPetted] = useState(false);
  const [hovered, setHovered] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const wanderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleAnimFrame = useRef<number>(0);

  // ============ 工具函数 ============
  const showBubble = useCallback((text: string, duration = 3500) => {
    if (bubbleTimeout) clearTimeout(bubbleTimeout);
    setSpeechBubble(text);
    const t = setTimeout(() => setSpeechBubble(null), duration);
    setBubbleTimeout(t);
  }, [bubbleTimeout]);

  const changeMood = useCallback((newMood: string) => {
    setMood(newMood);
    setTimeout(() => setMood('neutral'), 8000);
  }, []);

  // ============ 消息监听 ============
  useEffect(() => {
    const handler = (msg: PetMessage) => {
      switch (msg.type) {
        case 'emotion':
          changeMood(msg.payload?.emotion || msg.payload?.mood || 'neutral');
          if (msg.payload?.message) showBubble(msg.payload.message);
          break;
        case 'chat_sync':
          showBubble(msg.payload || '我在听...');
          changeMood('curious');
          break;
        case 'sync_pet_state':
          if (msg.payload) {
            if (msg.payload.mood) setMood(msg.payload.mood);
            if (msg.payload.energy !== undefined) setEnergy(msg.payload.energy);
            if (msg.payload.exp !== undefined) setExp(msg.payload.exp);
            if (msg.payload.level !== undefined) setLevel(msg.payload.level);
          }
          break;
        case 'heartbeat':
          break;
        default:
          if (typeof msg.payload === 'string') showBubble(msg.payload);
      }
    };

    petIPC.onMessage(handler);
    return () => petIPC.removeListener(handler);
  }, [changeMood, showBubble]);

  // ============ 入场动画 ============
  useEffect(() => {
    setTimeout(() => setEntranceDone(true), 600);
  }, []);

  // ============ 随机闲逛 ============
  const startWander = useCallback(() => {
    if (wandering) return;
    setWandering(true);
    const dx = (Math.random() - 0.5) * 160;
    const dy = (Math.random() - 0.5) * 100;
    setWanderX(dx);
    setWanderY(dy);
    setTimeout(() => setWandering(false), 2000);
  }, [wandering]);

  useEffect(() => {
    // 每 8~18 秒随机闲逛一次
    const schedule = () => {
      const delay = 8000 + Math.random() * 10000;
      wanderTimer.current = setTimeout(() => {
        startWander();
        schedule();
      }, delay);
    };
    schedule();
    return () => { if (wanderTimer.current) clearTimeout(wanderTimer.current); };
  }, [startWander]);

  // ============ 双击 → 打开主窗口 ============
  const handleDoubleClick = useCallback(() => {
    try { petIPC.doubleClick(); } catch {}
    // 被双击时开心
    changeMood('loved');
    showBubble('来啦~');
    setPetted(true);
    setTimeout(() => setPetted(false), 1500);
  }, [changeMood, showBubble]);

  // ============ 渲染 ============
  const emoji = emotionMap[mood] || emotionMap.neutral;

  return (
    <div
      ref={containerRef}
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        userSelect: 'none',
        WebkitAppRegion: 'drag',
        cursor: hovered ? 'pointer' : 'default',
        transform: entranceDone
          ? `translate(${wanderX}px, ${wanderY}px)`
          : 'translateY(20px)',
        transition: wandering
          ? 'transform 1.8s cubic-bezier(0.34, 1.56, 0.64, 1)'
          : 'transform 0.3s ease-out',
        opacity: entranceDone ? 1 : 0,
      }}
    >
      {/* ===== 图标区 ===== */}
      <div
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => {
          setHovered(true);
          try { petIPC.allowClick(true); } catch {}
        }}
        onMouseLeave={() => {
          setHovered(false);
          try { petIPC.allowClick(false); } catch {}
        }}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px',
          borderRadius: 20,
          WebkitAppRegion: 'no-drag',
        }}
      >
        {/* 宠物表情 */}
        <div
          className="pet-body"
          style={{
            fontSize: petted ? 80 : 72,
            filter: petted
              ? 'drop-shadow(0 0 18px rgba(255, 182, 193, 0.9)) saturate(1.3)'
              : 'drop-shadow(0 4px 12px rgba(0,0,0,0.15))',
            transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
            transform: petted ? 'scale(1.15)' : 'scale(1)',
            animation: 'float 3s ease-in-out infinite',
            lineHeight: 1,
          }}
        >
          {emoji}
        </div>

        {/* 情绪标签 */}
        <span
          style={{
            fontSize: 12,
            color: '#888',
            opacity: 0.7,
            fontWeight: 500,
            transition: 'opacity 0.3s',
          }}
        >
          {emotionLabels[mood] || '普通'}
        </span>

        {/* 能量条 */}
        <div style={{ width: 100, height: 4, background: '#eee', borderRadius: 2, overflow: 'hidden' }}>
          <div
            style={{
              width: `${Math.min(100, energy)}%`,
              height: '100%',
              background: energy > 30 ? '#7ecb76' : '#f5a623',
              transition: 'width 0.5s ease',
              borderRadius: 2,
            }}
          />
        </div>

        {/* 等级 + 经验 */}
        <div style={{ display: 'flex', gap: 8, fontSize: 11, color: '#aaa' }}>
          <span>Lv.{level}</span>
          <span>EXP {exp % 100}/100</span>
        </div>
      </div>

      {/* ===== 气泡 ===== */}
      {speechBubble && (
        <div
          className="pet-bubble"
          style={{
            position: 'absolute',
            bottom: 10,
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
          {/* 小三角 */}
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

      {/* ===== CSS 动画 ===== */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-8px) scale(1.03); }
        }
        @keyframes bubbleIn {
          from { opacity: 0; transform: translateY(8px) scale(0.9); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .pet-body:hover {
          animation: float 0.8s ease-in-out infinite !important;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
};

export default FloatingPetPage;
