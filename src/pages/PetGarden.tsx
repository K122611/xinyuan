import React, { useEffect, useState, useCallback, useRef } from 'react';
import { usePetStore, useEmotionStore, useAppStore } from '@/store';

const moodAnimations: Record<string, { emoji: string; description: string; color: string; }> = {
  calm:    { emoji: '🐱', description: '你的萌宠正安静地趴着，尾巴轻轻摇摆', color: '#60b0d0' },
  anxious: { emoji: '🐱‍👤', description: '萌宠有些不安地踱步，它在担心你', color: '#d0a060' },
  sad:     { emoji: '🐱‍💻', description: '萌宠蜷缩在角落，无精打采', color: '#8060a0' },
  joyful:  { emoji: '🐱‍🚀', description: '萌宠快乐地转圈，眼睛闪闪发光', color: '#60c080' },
  sleepy:  { emoji: '🐱‍👓', description: '萌宠打着哈欠，困得眼睛眯成一条缝', color: '#8090b0' },
  angry:   { emoji: '🐱‍🐉', description: '萌宠炸毛了，但它在努力理解你', color: '#d06060' },
};

// 反应动画 CSS 类
const reactionStyles: Record<string, React.CSSProperties> = {
  nod:     { animation: 'petNod 0.5s ease-in-out 3' },
  heart:   { animation: 'petHeartbeat 0.6s ease-in-out 3' },
  hug:     { animation: 'petWiggle 0.4s ease-in-out 4' },
  surprise: { animation: 'petShake 0.3s ease-in-out 4' },
  comfort: { animation: 'petSway 1s ease-in-out 2' },
  cheer:   { animation: 'petJump 0.4s ease-out 3' },
  sparkle: { animation: 'petSparkle 0.6s ease-in-out 3' },
};

// 问候语库
const GREETINGS_CN = [
  '早上好呀，今天看起来元气满满呢！☀️',
  '下午好~ 有没有喝点水休息一下？💧',
  '晚上好！今天辛苦了，和我聊聊吧 🌙',
  '深夜了呢... 该休息了哦，明天见 🌌',
  '好久不见！我刚才还在想你哦 💙',
  '今天心情怎么样？我一直在这里等你说说话~',
  '嘿！看到你就开心！🐾',
];

export function PetGarden() {
  const { pet, isAnimating, reaction, speechBubble, hasGreetedToday, loadPet, feedPet, showSpeechBubble, hideSpeechBubble, queueGreeting, markGreeted, resetGreetingTimer } = usePetStore();
  const currentMood = useEmotionStore((s) => s.currentMood);
  const togglePetWindow = useAppStore((s) => s.togglePetWindow);
  const petWindowVisible = useAppStore((s) => s.petWindowVisible);
  const [petScale, setPetScale] = useState(1);
  const [showHeart, setShowHeart] = useState(false);
  const [showBubble, setShowBubble] = useState(true);
  const greetingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { loadPet(); resetGreetingTimer(); }, []);

  const mood = pet?.mood || 'calm';
  const moodInfo = moodAnimations[mood] || moodAnimations['calm'];

  // 方案C：定时问候系统
  useEffect(() => {
    // 检查是否今天已问候
    if (hasGreetedToday) return;

    const scheduleGreeting = () => {
      const now = new Date();
      const hour = now.getHours();
      let greetingText = '';

      if (hour >= 6 && hour < 9) {
        greetingText = GREETINGS_CN[0]; // 早上
      } else if (hour >= 12 && hour < 14) {
        greetingText = GREETINGS_CN[1]; // 下午
      } else if (hour >= 18 && hour < 21) {
        greetingText = GREETINGS_CN[2]; // 晚上
      } else if (hour >= 22 || hour < 2) {
        greetingText = GREETINGS_CN[3]; // 深夜
      }

      if (greetingText) {
        // 延迟30秒后弹出问候
        setTimeout(() => {
          showSpeechBubble(greetingText, 'calm', 'greeting');
          markGreeted();
        }, 30000);
      }
    };

    scheduleGreeting();

    // 每小时检查一次
    greetingTimerRef.current = setInterval(scheduleGreeting, 3600000);

    return () => {
      if (greetingTimerRef.current) clearInterval(greetingTimerRef.current);
    };
  }, [hasGreetedToday]);

  // 监听 speechBubble 变化
  useEffect(() => {
    if (speechBubble) {
      setShowBubble(true);
    } else {
      setShowBubble(false);
    }
  }, [speechBubble]);

  const handleFeed = async () => {
    await feedPet();
    setPetScale(1.3);
    setShowHeart(true);
    setTimeout(() => { setPetScale(1); setShowHeart(false); }, 1500);
  };

  const reactionAnimStyle = reaction && reaction !== 'none' ? reactionStyles[reaction] : undefined;

  return (
    <div style={{ padding: 30, height: '100%', overflowY: 'auto' }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>🐾 心智萌宠花园</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Lv.{pet?.level || 1} · EXP {pet?.exp || 0}
            </span>
            {/* 方案B：悬浮窗开关 */}
            <button
              onClick={togglePetWindow}
              title={petWindowVisible ? '隐藏悬浮宠物' : '显示悬浮宠物'}
              style={{
                background: petWindowVisible ? 'var(--accent-warm)' : 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '2px 8px',
                fontSize: 12,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {petWindowVisible ? '🖥️ 桌面宠 ON' : '🪟 弹出桌面'}
            </button>
          </div>
        </div>

        {/* 宠物展示区 */}
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius)',
          position: 'relative',
          minHeight: 320,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {/* 方案A：AI气泡 */}
          {showBubble && speechBubble && (
            <div
              className="pet-speech-bubble fade-in"
              onClick={hideSpeechBubble}
              style={{
                position: 'absolute',
                top: 8,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(20,20,40,0.93)',
                backdropFilter: 'blur(10px)',
                border: `1px solid ${moodInfo.color}55`,
                borderRadius: 16,
                padding: '8px 16px',
                maxWidth: 280,
                zIndex: 10,
                boxShadow: `0 4px 20px rgba(0,0,0,0.4), 0 0 12px ${moodInfo.color}22`,
                cursor: 'pointer',
              }}
            >
              <div style={{
                fontSize: 12,
                color: '#e0e0f0',
                lineHeight: 1.6,
                marginBottom: 4,
              }}>
                {speechBubble?.text}
              </div>
              <div style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                textAlign: 'right',
              }}>
                {speechBubble?.source === 'ai' && '💬 AI心声'}
                {speechBubble?.source === 'greeting' && '👋 主动问候'}
                {speechBubble?.source === 'system' && '⚡ 系统'}
                <span style={{ marginLeft: 4 }}>点击关闭</span>
              </div>
              {/* 三角指示器 */}
              <div style={{
                position: 'absolute',
                bottom: -6,
                left: '50%',
                transform: 'translateX(-50%) rotate(45deg)',
                width: 12,
                height: 12,
                background: 'rgba(20,20,40,0.93)',
                borderRight: `1px solid ${moodInfo.color}55`,
                borderBottom: `1px solid ${moodInfo.color}55`,
              }} />
            </div>
          )}

          {/* 宠物本体 + 反应动画 */}
          <div style={{
            fontSize: 120,
            transform: `scale(${petScale})`,
            transition: 'transform 0.3s ease-out',
            cursor: 'pointer',
            filter: `drop-shadow(0 0 30px ${moodInfo.color}44)`,
            ...reactionAnimStyle,
          }}
            onClick={handleFeed}
            title="点击喂食"
          >
            {moodInfo.emoji}
          </div>

          {showHeart && (
            <div className="fade-in" style={{
              position: 'absolute',
              top: '30%',
              fontSize: 36,
              color: 'var(--accent-heart)',
              pointerEvents: 'none',
            }}>
              💕
            </div>
          )}

          <div style={{
            marginTop: 16,
            fontSize: 16,
            fontWeight: 600,
            color: moodInfo.color,
          }}>
            {moodInfo.description}
          </div>

          {isAnimating && (
            <div className="pulse" style={{ marginTop: 8, fontSize: 13, color: 'var(--accent-leaf)' }}>
              投喂成功！萌宠很开心 ✨
            </div>
          )}

          {/* 反应标签 */}
          {reaction && reaction !== 'none' && (
            <div className="fade-in" style={{
              marginTop: 6,
              fontSize: 12,
              color: 'var(--accent-calm)',
              background: 'var(--bg-tertiary)',
              borderRadius: 10,
              padding: '2px 10px',
            }}>
              {reaction === 'heart' && '💗 感受到你的温暖'}
              {reaction === 'hug' && '🤗 想给你一个拥抱'}
              {reaction === 'comfort' && '🫂 陪在你身边'}
              {reaction === 'nod' && '🤔 正在认真听'}
              {reaction === 'surprise' && '😮 哇！'}
              {reaction === 'cheer' && '🎉 为你开心！'}
              {reaction === 'sparkle' && '✨ 闪闪发光'}
            </div>
          )}
        </div>

        {/* 状态栏 */}
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div className="card" style={{ textAlign: 'center', padding: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>⚡ 能量</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-warm)' }}>
              {pet?.energy || 5}
              <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' }}>/10</span>
            </div>
            <div style={{
              marginTop: 6, height: 4, borderRadius: 2,
              background: 'var(--bg-tertiary)', overflow: 'hidden',
            }}>
              <div style={{
                width: `${(pet?.energy || 5) * 10}%`,
                height: '100%', background: 'var(--accent-warm)',
                borderRadius: 2, transition: 'width 0.5s',
              }} />
            </div>
          </div>

          <div className="card" style={{ textAlign: 'center', padding: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>📈 经验</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-calm)' }}>
              {pet?.exp || 0}
              <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' }}> XP</span>
            </div>
            <div style={{
              marginTop: 6, height: 4, borderRadius: 2,
              background: 'var(--bg-tertiary)', overflow: 'hidden',
            }}>
              <div style={{
                width: `${Math.min(100, ((pet?.exp || 0) / ((pet?.level || 1) * 100)) * 100)}%`,
                height: '100%', background: 'var(--accent-calm)',
                borderRadius: 2, transition: 'width 0.5s',
              }} />
            </div>
          </div>

          <div className="card" style={{ textAlign: 'center', padding: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>🎭 情绪</div>
            <div style={{ fontSize: 24 }}>{moodInfo.emoji}</div>
            <div style={{ fontSize: 12, color: moodInfo.color, marginTop: 4 }}>
              {currentMood || mood}
            </div>
          </div>
        </div>

        {/* 互动按钮 */}
        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={handleFeed} style={{ flex: 1 }}>
            🍪 喂食（+10 EXP）
          </button>
          <button className="btn btn-secondary" style={{ flex: 1 }}>
            🎮 玩耍
          </button>
          <button className="btn btn-secondary" style={{ flex: 1 }}>
            🎀 装扮
          </button>
        </div>
      </div>

      {/* 萌宠社交预览 */}
      <div className="card">
        <div className="card-header">🌍 心元花园（搭子萌宠互访）</div>
        <div style={{
          padding: 24, textAlign: 'center', color: 'var(--text-muted)',
          fontSize: 14, lineHeight: 1.8,
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🌿</div>
          还没有搭子萌宠来访<br />
          去「搭子空间」找一个同行者吧
        </div>
      </div>
    </div>
  );
}
