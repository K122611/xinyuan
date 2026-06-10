import React, { useEffect, useState, useRef, useCallback } from 'react';
import { usePetStore } from '../store';
import { petIPC, PetMessage } from '../services/petIPC';

// ============ 情绪映射 ============
const moodEmoji: Record<string, string> = {
  calm: '😊', anxious: '😰', sad: '😢', joyful: '🥳',
  sleepy: '😴', angry: '😠', happy: '😄', excited: '🤩',
};

const moodColors: Record<string, { bg: string; glow: string }> = {
  calm: { bg: '#6ec6ff', glow: 'rgba(110,198,255,0.4)' },
  anxious: { bg: '#ffc107', glow: 'rgba(255,193,7,0.4)' },
  sad: { bg: '#90a4ae', glow: 'rgba(144,164,174,0.4)' },
  joyful: { bg: '#ff69b4', glow: 'rgba(255,105,180,0.4)' },
  sleepy: { bg: '#7c4dff', glow: 'rgba(124,77,255,0.4)' },
  angry: { bg: '#ef5350', glow: 'rgba(239,83,80,0.4)' },
  happy: { bg: '#4caf50', glow: 'rgba(76,175,80,0.4)' },
  excited: { bg: '#ff9800', glow: 'rgba(255,152,0,0.4)' },
};

// 反应动画映射
const reactionAnimations: Record<string, string> = {
  nod: 'animate-bounce',
  heart: 'animate-heartbeat',
  hug: 'animate-wiggle',
  surprise: 'animate-shake',
  comfort: 'animate-sway',
  cheer: 'animate-jump',
  sparkle: 'animate-sparkle',
};

// ============ 悬浮宠物气泡 ============
const SpeechBubble: React.FC<{
  text: string;
  emotion: string;
  visible: boolean;
  onDismiss: () => void;
}> = ({ text, emotion, visible, onDismiss }) => {
  if (!visible || !text) return null;

  const color = moodColors[emotion] || moodColors.calm;

  return (
    <div
      className="floating-speech-bubble"
      onClick={onDismiss}
      style={{
        position: 'absolute',
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        marginBottom: 12,
        background: 'rgba(20,20,35,0.92)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${color.glow}`,
        borderRadius: 16,
        padding: '8px 14px',
        maxWidth: 220,
        minWidth: 80,
        textAlign: 'center',
        color: '#e8e8f0',
        fontSize: 12,
        lineHeight: 1.5,
        zIndex: 100,
        boxShadow: `0 0 16px ${color.glow}, 0 4px 12px rgba(0,0,0,0.5)`,
        cursor: 'pointer',
        animation: 'bubbleIn 0.3s ease-out',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ marginBottom: 4 }}>{text}</div>
      <div
        style={{
          position: 'absolute',
          bottom: -6,
          left: '50%',
          transform: 'translateX(-50%) rotate(45deg)',
          width: 12,
          height: 12,
          background: 'rgba(20,20,35,0.92)',
          borderRight: `1px solid ${color.glow}`,
          borderBottom: `1px solid ${color.glow}`,
        }}
      />
    </div>
  );
};

// ============ 主组件 ============
const FloatingPetPage: React.FC = () => {
  const [speechBubble, setSpeechBubble] = useState<{ text: string; emotion: string } | null>(null);
  const [reaction, setReaction] = useState('');
  const [petPos, setPetPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const pet = usePetStore((s) => s.pet);
  const loadPet = usePetStore((s) => s.loadPet);

  // 初始加载
  useEffect(() => {
    loadPet();
  }, []);

  // 监听来自主窗口的消息
  useEffect(() => {
    const unsub = petIPC.onMessage((msg: PetMessage) => {
      switch (msg.type) {
        case 'speech_bubble':
          setSpeechBubble({
            text: msg.payload.text,
            emotion: msg.payload.emotion,
          });
          // 自动消失
          setTimeout(() => setSpeechBubble(null), 5000);
          break;

        case 'reaction':
          setReaction(msg.payload.reaction);
          setTimeout(() => setReaction(''), 3000);
          break;

        case 'mood_update':
          usePetStore.getState().setPetMood(msg.payload.mood);
          break;

        case 'sync_pet_state':
          if (msg.payload) {
            usePetStore.setState({ pet: msg.payload });
          }
          break;

        case 'greeting':
          setSpeechBubble({
            text: msg.payload.text,
            emotion: 'calm',
          });
          setTimeout(() => setSpeechBubble(null), 6000);
          break;
      }
    });

    // localStorage 轮询（非 Electron 环境回退）
    let lastMsgTime = 0;
    const poll = setInterval(() => {
      try {
        const raw = localStorage.getItem('xinyuan_pet_msg');
        if (raw) {
          const msg = JSON.parse(raw) as PetMessage & { timestamp: number };
          if (msg.timestamp > lastMsgTime) {
            lastMsgTime = msg.timestamp;
            if (msg.type === 'speech_bubble') {
              setSpeechBubble({
                text: msg.payload.text,
                emotion: msg.payload.emotion,
              });
              setTimeout(() => setSpeechBubble(null), 5000);
            } else if (msg.type === 'reaction') {
              setReaction(msg.payload.reaction);
              setTimeout(() => setReaction(''), 3000);
            }
          }
        }
      } catch {}
    }, 1000);

    return () => {
      unsub?.();
      clearInterval(poll);
    };
  }, []);

  // 拖拽处理
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setDragging(true);
      dragOffset.current = {
        x: e.clientX - petPos.x,
        y: e.clientY - petPos.y,
      };
      petIPC.showPet?.(); // 确保可见
    }
  }, [petPos]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (dragging) {
      setPetPos({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    }
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragging, handleMouseMove, handleMouseUp]);

  // 双击回到主窗口
  const handleDoubleClick = useCallback(() => {
    if ((window as any).petAPI) {
      (window as any).petAPI.doubleClick();
    }
  }, []);

  const emotionKey = pet?.mood || 'calm';
  const emoji = moodEmoji[emotionKey] || '😊';
  const colors = moodColors[emotionKey] || moodColors.calm;
  const animClass = reaction ? reactionAnimations[reaction] || '' : '';
  const energyPercent = ((pet?.energy || 7) / 10) * 100;

  return (
    <div
      className="floating-pet-container"
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        userSelect: 'none',
        cursor: dragging ? 'grabbing' : 'grab',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 背景光晕 */}
      <div
        style={{
          position: 'absolute',
          width: 180,
          height: 180,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${colors.glow} 0%, transparent 70%)`,
          pointerEvents: 'none',
          animation: 'glowPulse 2s ease-in-out infinite',
        }}
      />

      {/* 等级 */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 20,
          background: 'rgba(20,20,35,0.75)',
          backdropFilter: 'blur(6px)',
          borderRadius: 10,
          padding: '2px 10px',
          fontSize: 11,
          color: '#c9a0ff',
          border: '1px solid rgba(201,160,255,0.3)',
          zIndex: 10,
        }}
      >
        Lv.{pet?.level || 1}
      </div>

      {/* 气泡 */}
      {speechBubble && (
        <SpeechBubble
          text={speechBubble.text}
          emotion={speechBubble.emotion}
          visible={!!speechBubble}
          onDismiss={() => setSpeechBubble(null)}
        />
      )}

      {/* 宠物本体 */}
      <div
        className={`floating-pet-body ${animClass}`}
        style={{
          fontSize: 72,
          filter: `drop-shadow(0 0 18px ${colors.glow})`,
          transition: 'transform 0.3s ease',
          transform: pet?.mood === 'sleepy' ? 'rotate(-10deg) scale(0.9)' : 'scale(1)',
          lineHeight: 1,
          position: 'relative',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {emoji}
      </div>

      {/* 心情标签 */}
      <div
        className="floating-mood-label"
        style={{
          marginTop: 8,
          background: `linear-gradient(135deg, ${colors.bg}44, ${colors.bg}22)`,
          border: `1px solid ${colors.bg}55`,
          borderRadius: 12,
          padding: '2px 12px',
          fontSize: 11,
          color: colors.bg,
          fontWeight: 600,
          letterSpacing: 1,
        }}
      >
        {pet?.mood === 'calm' && '平静'}
        {pet?.mood === 'anxious' && '不安'}
        {pet?.mood === 'sad' && '低落'}
        {pet?.mood === 'joyful' && '开心'}
        {pet?.mood === 'sleepy' && '困倦'}
        {pet?.mood === 'angry' && '生气'}
        {pet?.mood === 'happy' && '快乐'}
        {pet?.mood === 'excited' && '兴奋'}
        {!['calm','anxious','sad','joyful','sleepy','angry','happy','excited'].includes(pet?.mood || '') && pet?.mood}
      </div>

      {/* 能量条 */}
      <div
        style={{
          width: 120,
          height: 4,
          marginTop: 8,
          background: 'rgba(255,255,255,0.08)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${energyPercent}%`,
            background: `linear-gradient(90deg, ${colors.bg}88, ${colors.bg})`,
            borderRadius: 2,
            transition: 'width 0.5s ease',
          }}
        />
      </div>

      {/* 经验条 */}
      <div
        style={{
          width: 120,
          height: 2,
          marginTop: 4,
          background: 'rgba(255,255,255,0.05)',
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.min(100, ((pet?.exp || 0) / ((pet?.level || 1) * 100)) * 100)}%`,
            background: 'linear-gradient(90deg, #c9a0ff66, #c9a0ff)',
            borderRadius: 1,
            transition: 'width 0.5s ease',
          }}
        />
      </div>

      {/* 提示文字 */}
      <div
        style={{
          marginTop: 12,
          fontSize: 10,
          color: 'rgba(255,255,255,0.25)',
          textAlign: 'center',
        }}
      >
        拖拽移动 | 双击回主窗口
      </div>
    </div>
  );
};

export default FloatingPetPage;
