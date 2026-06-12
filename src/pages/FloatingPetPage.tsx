import React, { useState, useEffect, useCallback, useRef } from 'react';
import { usePetStore } from '../store';
import { useOutfitStore } from '../store/outfitStore';
import OutfitShop from '../components/OutfitShop';
import { petIPC } from '@/services/petIPC';
import { PetAction, ACTION_VISUALS } from '@/utils/petActionParser';

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

// ============ System A (PetGarden SHOP_ITEMS) → System B (outfitStore OutfitItems) ID 映射 ============
// 主窗口 PetGarden 使用 SHOP_ITEMS (store/index.ts)，桌宠使用 DEFAULT_OUTFITS (store/outfitStore.ts)
// 两套系统数据独立，此映射让主窗口装备也能在桌宠上显示
const SHOP_TO_OUTFIT_MAP: Record<string, string> = {
  'sunglasses': 'sunglasses',   // 🕶️ → 🕶️
  'crown':      'crown',         // 👑 → 👑
  'ribbon':     'bowknot',       // 🎀 → 🎀 (蝴蝶结)
  'scarf':      'scarf',         // 🧣 → 🧣
  'flower':     'flowercrown',   // 🌸 → 🌸 (鲜花背景)
  'sparkles':   'starmark',      // ✨ → ✨ (星光背景)
  'hearts':     'hearts_bg',     // 💕 → 💕 (爱心背景)
  'bowtie':     'bowtie',        // 🎀 → 🎀 (领结)
  'hat':        'tophat',        // 🎩 → 🎩 (礼帽)
};

export default function FloatingPetPage() {
  const wanderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ============ 从共享 Store 读取 ============
  const pet = usePetStore((s) => s.pet);
  const loadPet = usePetStore((s) => s.loadPet);
  const targetAction = usePetStore((s) => s.targetAction);
  const setTargetAction = usePetStore((s) => s.setTargetAction);

  // ============ 装扮 Store ============
  const {
    isShopOpen,
    setShopOpen,
    equipped,
    getOutfitById,
    loadFromStorage: loadOutfits,
  } = useOutfitStore();

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

  // 启动时加载持久化 pet 数据 + 装扮数据
  useEffect(() => { loadPet(); loadOutfits(); }, []); // eslint-disable-line

  // ============ 跨窗口同步：storage 事件 + polling 兜底 + focus 即时刷新 ============
  useEffect(() => {
    // polling：每 2 秒检测一次（保证可靠同步）
    const poll = setInterval(() => {
      loadPet();
      loadOutfits();
    }, 2000);
    // storage 事件：其他窗口修改时立即响应
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key.includes('_pet') || e.key === 'xinyuan_pet') loadPet();
      if (e.key === 'xinyuan_outfit_data') loadOutfits();
    };
    // focus 事件：切换回桌面宠物窗口时立即刷新
    const onFocus = () => {
      loadPet();
      loadOutfits();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(poll);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadPet, loadOutfits]);

  // ============ IPC 监听：主窗口 → 宠物动作 ============
  const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsub = petIPC.onMessage((msg) => {
      if (msg.type === 'set_action') {
        const action = msg.data?.action as PetAction;
        if (action && ACTION_VISUALS[action]) {
          setTargetAction(action);
          // 瞬态动作自动重置为 idle
          const visual = ACTION_VISUALS[action];
          if (visual.duration > 0) {
            if (actionTimer.current) clearTimeout(actionTimer.current);
            actionTimer.current = setTimeout(() => {
              setTargetAction('idle');
            }, visual.duration);
          }
        }
      }
    });
    return () => { unsub(); if (actionTimer.current) clearTimeout(actionTimer.current); };
  }, [setTargetAction]);

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
  const actionVisual = ACTION_VISUALS[targetAction] || ACTION_VISUALS.idle;
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
          {/* 宠物 + 装扮容器（共享 relative 定位基准） */}
          <div style={{ position: 'relative', display: 'inline-block' }}>
            {/* 宠物本体 */}
            <div
              className={targetAction !== 'idle' ? actionVisual.animationClass : ''}
              style={{
                fontSize: 32,
                lineHeight: 1,
                filter: `drop-shadow(0 2px 6px ${actionVisual.color}44)`,
                marginBottom: 2,
                transition: 'filter 0.5s',
              }}
            >
              {targetAction !== 'idle' ? actionVisual.emoji : petEmoji}
            </div>

            {/* 装饰品 — 合并 System B (outfitStore.equipped) + System A (pet.accessories) */}
            {(Object.keys(equipped).length > 0 || pet.accessories.length > 0) && (
            <div style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              pointerEvents: 'none',
            }}>
              {/* ===== System B: outfitStore 精确定位装备 ===== */}
              {Object.entries(equipped).map(([category, outfitId]) => {
                const outfit = getOutfitById(outfitId as string);
                if (!outfit || outfit.category === 'background') return null;
                // offsetY 为 48px 预览设计，按 32/48≈0.667 缩放 / translateX 居中（不做 translateY）
                const top = outfit.offsetY ? Math.round(outfit.offsetY * 0.667) : 0;
                return (
                  <div key={`outfit-${category}`}
                    style={{
                      position: 'absolute',
                      top,
                      left: 0,
                      width: '100%',
                      textAlign: 'center',
                      fontSize: 28, lineHeight: 1,
                      transform: `scale(${outfit.scale ?? 1})`,
                      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.3))',
                      transition: 'all 0.3s ease',
                    }}>
                    {outfit.emoji}
                  </div>
                );
              })}
              {/* ===== System A: pet.accessories 通过映射桥接 ===== */}
              {pet.accessories.map((accId) => {
                const mappedId = SHOP_TO_OUTFIT_MAP[accId];
                if (!mappedId) return null;
                const outfit = getOutfitById(mappedId);
                if (!outfit) return null;
                if (equipped[outfit.category] === mappedId) return null;
                const top = outfit.offsetY ? Math.round(outfit.offsetY * 0.667) : 0;
                return (
                  <div key={`acc-${accId}`}
                    style={{
                      position: 'absolute',
                      top,
                      left: 0,
                      width: '100%',
                      textAlign: 'center',
                      fontSize: 28, lineHeight: 1,
                      transform: `scale(${outfit.scale ?? 1})`,
                      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.3))',
                      transition: 'all 0.3s ease',
                    }}>
                    {outfit.emoji}
                  </div>
                );
              })}
              {/* 背景特效 */}
              {equipped.background && getOutfitById(equipped.background) && (
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    fontSize: 60,
                    opacity: 0.2,
                    pointerEvents: 'none',
                  }}
                >
                  {getOutfitById(equipped.background)!.emoji}
                </div>
              )}
            </div>
            )}
          </div>

          {/* 情绪标签 + 动作标签 */}
          <div
            style={{
              fontSize: 11,
              color: targetAction !== 'idle' ? actionVisual.color : '#aaa',
              fontWeight: 500,
              lineHeight: 1,
              textShadow: '0 1px 2px rgba(0,0,0,0.4)',
            }}
          >
            {emotionLabel}{targetAction !== 'idle' ? ` · ${actionVisual.label}` : ''}
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

          {/* 装扮商店按钮 */}
          <button
            className="btn btn-secondary"
            onClick={(e) => { e.stopPropagation(); setShopOpen(true); }}
            style={{
              fontSize: 12,
              padding: '3px 12px',
              borderRadius: 12,
              border: '1px solid var(--glass-border)',
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              color: '#ccc',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'var(--accent-calm)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#ccc'; e.currentTarget.style.borderColor = 'var(--glass-border)'; }}
          >
            🎨 装扮
          </button>
        </div>

        {/* ===== 气泡 ===== */}
        {speechBubble && (
          <div
            className="floating-speech-bubble"
            style={{
              position: 'absolute',
              bottom: -8,
              maxWidth: 220,
              padding: '8px 14px',
              borderRadius: 16,
              fontSize: 13,
              color: '#ccc',
              lineHeight: 1.5,
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
                borderBottom: '6px solid var(--glass-bg)',
              }}
            />
          </div>
        )}
      </div>

      {/* ===== 装扮商店面板 ===== */}
      {isShopOpen && (
        <div
          style={{
            position: 'absolute',
            top: 60,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            width: 320,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <OutfitShop />
        </div>
      )}

      {/* ===== CSS 动画 ===== */}
      <style>{`
        @keyframes bubbleIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* 倾听：微微左右摆动耳朵 */
        .anim-listening {
          animation: anim-listening 1.2s ease-in-out infinite;
        }
        @keyframes anim-listening {
          0%, 100% { transform: rotate(0deg) scale(1); }
          25% { transform: rotate(-3deg) scale(1.02); }
          75% { transform: rotate(3deg) scale(1.02); }
        }

        /* 安抚：轻柔上下浮动 */
        .anim-comforting {
          animation: anim-comforting 1.5s ease-in-out infinite;
        }
        @keyframes anim-comforting {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-6px) scale(1.05); }
        }

        /* 开心：跳动 */
        .anim-happy {
          animation: anim-happy 0.5s ease-in-out infinite;
        }
        @keyframes anim-happy {
          0%, 100% { transform: translateY(0) scale(1); }
          25% { transform: translateY(-10px) scale(1.1); }
          50% { transform: translateY(0) scale(1.05); }
          75% { transform: translateY(-5px) scale(1.08); }
        }

        /* 担心：左右轻微颤抖 */
        .anim-worried {
          animation: anim-worried 0.6s ease-in-out infinite;
        }
        @keyframes anim-worried {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-3px); }
          75% { transform: translateX(3px); }
        }

        /* 呼吸引导：规律缩放 */
        .anim-breathing {
          animation: anim-breathing 4s ease-in-out infinite;
        }
        @keyframes anim-breathing {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.85; }
        }

        /* 危机：快速脉冲 */
        .anim-crisis {
          animation: anim-crisis 0.8s ease-in-out infinite;
        }
        @keyframes anim-crisis {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.7; }
        }

        /* 待机：无动画 */
        .anim-idle {
          animation: none;
        }
      `}</style>
    </div>
  );
}
