import React, { useEffect, useState } from 'react';
import { usePetStore, useEmotionStore } from '@/store';

const moodAnimations: Record<string, { emoji: string; description: string; color: string; animation: string }> = {
  calm:    { emoji: '🐱', description: '你的萌宠正安静地趴着，尾巴轻轻摇摆', color: '#60b0d0', animation: 'idle' },
  anxious: { emoji: '🐱‍👤', description: '萌宠有些不安地踱步，它在担心你', color: '#d0a060', animation: 'tremble' },
  sad:     { emoji: '🐱‍💻', description: '萌宠蜷缩在角落，无精打采', color: '#8060a0', animation: 'curled' },
  joyful:  { emoji: '🐱‍🚀', description: '萌宠快乐地转圈，眼睛闪闪发光', color: '#60c080', animation: 'spin' },
  sleepy:  { emoji: '🐱‍👓', description: '萌宠打着哈欠，困得眼睛眯成一条缝', color: '#8090b0', animation: 'yawn' },
  angry:   { emoji: '🐱‍🐉', description: '萌宠炸毛了，但它在努力理解你', color: '#d06060', animation: 'bristle' },
};

export function PetGarden() {
  const { pet, isAnimating, loadPet, feedPet } = usePetStore();
  const currentMood = useEmotionStore((s) => s.currentMood);
  const [petScale, setPetScale] = useState(1);
  const [showHeart, setShowHeart] = useState(false);

  useEffect(() => { loadPet(); }, []);

  const mood = pet?.mood || 'calm';
  const moodInfo = moodAnimations[mood] || moodAnimations['calm'];

  const handleFeed = async () => {
    await feedPet();
    setPetScale(1.3);
    setShowHeart(true);
    setTimeout(() => { setPetScale(1); setShowHeart(false); }, 1500);
  };

  return (
    <div style={{ padding: 30, height: '100%', overflowY: 'auto' }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>🐾 心智萌宠花园</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Lv.{pet?.level || 1} · EXP {pet?.exp || 0}
          </span>
        </div>

        {/* 宠物展示区 */}
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius)',
          position: 'relative',
          minHeight: 280,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            fontSize: 120,
            transform: `scale(${petScale})`,
            transition: 'transform 0.3s ease-out',
            cursor: 'pointer',
            filter: `drop-shadow(0 0 30px ${moodInfo.color}44)`,
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
            fontSize: 18,
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
              marginTop: 6,
              height: 4,
              borderRadius: 2,
              background: 'var(--bg-tertiary)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${(pet?.energy || 5) * 10}%`,
                height: '100%',
                background: 'var(--accent-warm)',
                borderRadius: 2,
                transition: 'width 0.5s',
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
              marginTop: 6,
              height: 4,
              borderRadius: 2,
              background: 'var(--bg-tertiary)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${((pet?.exp || 0) % 100)}%`,
                height: '100%',
                background: 'var(--accent-calm)',
                borderRadius: 2,
                transition: 'width 0.5s',
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
          padding: 24,
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 14,
          lineHeight: 1.8,
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🌿</div>
          还没有搭子萌宠来访<br />
          去「搭子空间」找一个同行者吧
        </div>
      </div>
    </div>
  );
}
