import React, { useState, useCallback, useMemo } from 'react';
import {
  useOutfitStore,
  type OutfitCategory,
  type OutfitItem,
  CATEGORY_LABELS,
} from '@/store/outfitStore';

// ============ 装扮详情弹窗 ============
interface DetailModalProps {
  outfit: OutfitItem;
  isEquipped: boolean;
  onClose: () => void;
  onEquip: () => void;
  onUnequip: () => void;
  onPurchase: () => void;
  canAfford: boolean;
}

const OutfitDetailModal: React.FC<DetailModalProps> = ({
  outfit,
  isEquipped,
  onClose,
  onEquip,
  onUnequip,
  onPurchase,
  canAfford,
}) => {
  return (
    <div className="outfit-detail-overlay" onClick={onClose}>
      <div
        className="outfit-detail-card glass-strong"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="outfit-detail-icon">{outfit.emoji}</div>
        <div className="outfit-detail-name">{outfit.name}</div>
        <span className={`rarity rarity-${outfit.rarity}`}>
          {outfit.rarity.toUpperCase()}
        </span>
        <div className="outfit-detail-desc">{outfit.description}</div>

        {!outfit.unlocked && (
          <div style={{ fontSize: 14, color: 'var(--accent-warm)', fontWeight: 600 }}>
            💰 {outfit.price} 金币
          </div>
        )}

        <div className="outfit-detail-actions">
          {!outfit.unlocked ? (
            <button
              className="btn btn-primary"
              onClick={onPurchase}
              disabled={!canAfford}
              style={{ opacity: canAfford ? 1 : 0.4 }}
            >
              {canAfford ? '购买并装备' : '金币不足'}
            </button>
          ) : isEquipped ? (
            <button className="btn btn-secondary" onClick={onUnequip}>
              卸下
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onEquip}>
              装备
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};

// ============ 宠物预览区 ============
const PetPreview: React.FC<{ previewOutfit: string | null }> = ({ previewOutfit }) => {
  const getOutfitById = useOutfitStore((s) => s.getOutfitById);
  const getEquippedEmoji = useOutfitStore((s) => s.getEquippedEmoji);

  // 显示已装备装扮 + 预览装扮
  const categories: OutfitCategory[] = ['hat', 'accessory', 'clothes', 'special'];

  const previewItem = previewOutfit ? getOutfitById(previewOutfit) : null;

  return (
    <div className="pet-preview-container">
      <div className="pet-preview">
        {/* 宠物本体 */}
        <div className="pet-preview-base">🐱</div>

        {/* 预览装扮（悬停时显示在正确位置） */}
        {previewItem && previewItem.category !== 'background' && (
          <div
            className="pet-preview-outfit"
            style={{
              top: previewItem.offsetY ? `${previewItem.offsetY}px` : '-18px',
              left: previewItem.offsetX ? `calc(50% + ${previewItem.offsetX}px)` : '50%',
              transform: `translateX(-50%) scale(${previewItem.scale ?? 1})`,
            }}
          >
            {previewItem.emoji}
          </div>
        )}

        {/* 已装备的其他类别装扮 */}
        {!previewItem && categories.map((cat) => {
          const emoji = getEquippedEmoji(cat);
          if (!emoji) return null;
          const outfit = useOutfitStore.getState().outfits.find(
            (o) => o.id === useOutfitStore.getState().equipped[cat]
          );
          return (
            <div
              key={cat}
              className="pet-preview-outfit"
              style={{
                top: outfit?.offsetY ? `${outfit.offsetY}px` : '-18px',
                left: outfit?.offsetX ? `calc(50% + ${outfit.offsetX}px)` : '50%',
                transform: `translateX(-50%) scale(${outfit?.scale ?? 1})`,
              }}
            >
              {emoji}
            </div>
          );
        })}

        {/* 背景特效 */}
        {getEquippedEmoji('background') && (
          <div
            style={{
              position: 'absolute',
              inset: -20,
              fontSize: 60,
              opacity: 0.3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            {getEquippedEmoji('background')}
          </div>
        )}
      </div>
    </div>
  );
};

// ============ 装扮物品卡片 ============
const OutfitItemCard: React.FC<{
  item: OutfitItem;
  isEquipped: boolean;
  isPreview: boolean;
  onHover: (id: string | null) => void;
  onClick: () => void;
}> = ({ item, isEquipped, isPreview, onHover, onClick }) => {
  return (
    <div
      className={`outfit-item ${isEquipped ? 'equipped' : ''} ${isPreview ? 'previewing' : ''}`}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
    >
      <span className="icon">{item.emoji}</span>
      <span className="name">{item.name}</span>
      <span className={`rarity rarity-${item.rarity}`}>
        {item.rarity === 'legendary'
          ? '传说'
          : item.rarity === 'epic'
          ? '史诗'
          : item.rarity === 'rare'
          ? '稀有'
          : '普通'}
      </span>
      {!item.unlocked && <span className="price">💰{item.price}</span>}
    </div>
  );
};

// ============ 装扮商店主组件 ============
const OutfitShop: React.FC = () => {
  const {
    outfits,
    equipped,
    coins,
    selectedCategory,
    previewOutfit,
    isShopOpen,
    setShopOpen,
    setSelectedCategory,
    setPreviewOutfit,
    equipOutfit,
    unequipOutfit,
    purchaseOutfit,
    isEquipped,
  } = useOutfitStore();

  const [detailOutfit, setDetailOutfit] = useState<OutfitItem | null>(null);

  // 筛选装扮
  const filteredOutfits = useMemo(() => {
    if (selectedCategory === 'all') return outfits;
    return outfits.filter((o) => o.category === selectedCategory);
  }, [outfits, selectedCategory]);

  // 已解锁数量
  const unlockedCount = useMemo(
    () => outfits.filter((o) => o.unlocked).length,
    [outfits]
  );

  const handleItemClick = useCallback((item: OutfitItem) => {
    setDetailOutfit(item);
  }, []);

  const handleEquip = useCallback(() => {
    if (detailOutfit) {
      equipOutfit(detailOutfit.id);
      setDetailOutfit(null);
    }
  }, [detailOutfit, equipOutfit]);

  const handleUnequip = useCallback(() => {
    if (detailOutfit) {
      unequipOutfit(detailOutfit.id);
      setDetailOutfit(null);
    }
  }, [detailOutfit, unequipOutfit]);

  const handlePurchase = useCallback(() => {
    if (detailOutfit) {
      purchaseOutfit(detailOutfit.id);
      setDetailOutfit(null);
    }
  }, [detailOutfit, purchaseOutfit]);

  if (!isShopOpen) return null;

  const categoryKeys: (OutfitCategory | 'all')[] = [
    'all',
    'hat',
    'accessory',
    'clothes',
    'background',
    'special',
  ];

  return (
    <>
      <div className="outfit-shop glass">
        {/* 头部 */}
        <div className="outfit-shop-header">
          <span>🎨 装扮商店</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="outfit-shop-coins">
              💰 {coins}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {unlockedCount}/{outfits.length}
            </span>
            <button
              className="btn-icon"
              onClick={() => setShopOpen(false)}
              style={{ fontSize: 16, width: 28, height: 28 }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* 宠物预览 */}
        <PetPreview previewOutfit={previewOutfit} />

        {/* 分类标签 */}
        <div className="outfit-category">
          {categoryKeys.map((cat) => (
            <button
              key={cat}
              className={`outfit-category-btn ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        {/* 装扮网格 */}
        <div className="outfit-grid">
          {filteredOutfits.map((item) => (
            <OutfitItemCard
              key={item.id}
              item={item}
              isEquipped={isEquipped(item.id)}
              isPreview={previewOutfit === item.id}
              onHover={setPreviewOutfit}
              onClick={() => handleItemClick(item)}
            />
          ))}
        </div>
      </div>

      {/* 详情弹窗 */}
      {detailOutfit && (
        <OutfitDetailModal
          outfit={detailOutfit}
          isEquipped={isEquipped(detailOutfit.id)}
          onClose={() => setDetailOutfit(null)}
          onEquip={handleEquip}
          onUnequip={handleUnequip}
          onPurchase={handlePurchase}
          canAfford={coins >= detailOutfit.price}
        />
      )}
    </>
  );
};

export default OutfitShop;
