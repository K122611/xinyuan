import { create } from 'zustand';

// ============ 装扮数据类型 ============
export type OutfitCategory = 'hat' | 'accessory' | 'clothes' | 'background' | 'special';
export type OutfitRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface OutfitItem {
  id: string;
  name: string;
  emoji: string;
  category: OutfitCategory;
  rarity: OutfitRarity;
  description: string;
  price: number;
  unlocked: boolean;
  /** 装扮在宠物上的偏移位置（相对于头顶） */
  offsetY?: number;
  offsetX?: number;
  /** 装扮显示的缩放比例 */
  scale?: number;
}

// ============ 预设装扮库 ============
const DEFAULT_OUTFITS: OutfitItem[] = [
  // --- 帽子类 ---
  { id: 'crown',     name: '皇冠',   emoji: '👑', category: 'hat',    rarity: 'legendary', description: '闪烁的宝石皇冠，王者的象征',    price: 500, unlocked: false, offsetY: -28 },
  { id: 'tophat',    name: '礼帽',   emoji: '🎩', category: 'hat',    rarity: 'epic',      description: '优雅的黑色礼帽，绅士首选',        price: 300, unlocked: false, offsetY: -26 },
  { id: 'bowknot',   name: '蝴蝶结', emoji: '🎀', category: 'hat',    rarity: 'rare',      description: '可爱的粉色蝴蝶结',                   price: 150, unlocked: false, offsetY: -16, scale: 0.7 },
  { id: 'wizardhat', name: '魔法帽', emoji: '🧙', category: 'hat',    rarity: 'epic',      description: '蕴含神秘力量的尖顶魔法帽',           price: 350, unlocked: false, offsetY: -30 },
  { id: 'chefhat',   name: '厨师帽', emoji: '👨‍🍳', category: 'hat',   rarity: 'common',    description: '洁白蓬松的厨师帽',                   price: 100, unlocked: true,  offsetY: -24 },

  // --- 面部装饰 ---
  { id: 'sunglasses',name: '墨镜',   emoji: '🕶️', category: 'accessory', rarity: 'rare',   description: '酷酷的黑色墨镜，气场全开',           price: 180, unlocked: false, offsetY: -5 },
  { id: 'monocle',   name: '单片镜', emoji: '🧐', category: 'accessory', rarity: 'common', description: '精致的单片眼镜，学者气质',           price: 60,  unlocked: true,  offsetY: -4 },
  { id: 'hearteyes', name: '爱心眼', emoji: '😍', category: 'accessory', rarity: 'rare',   description: '扑通扑通的心动眼神',                 price: 120, unlocked: false, offsetY: -6 },
  { id: 'blush',     name: '腮红',   emoji: '😊', category: 'accessory', rarity: 'common', description: '可爱的害羞腮红',                       price: 40,  unlocked: true,  offsetY: -2 },
  { id: 'mask',      name: '面具',   emoji: '🎭', category: 'accessory', rarity: 'epic',   description: '神秘的双面戏剧面具',                 price: 280, unlocked: false, offsetY: -6 },

  // --- 身体服饰 ---
  { id: 'scarf',     name: '围巾',   emoji: '🧣', category: 'clothes', rarity: 'common', description: '温暖的针织围巾',                       price: 70,  unlocked: true,  offsetY: 10, scale: 0.8 },
  { id: 'bowtie',    name: '领结',   emoji: '🎀', category: 'clothes', rarity: 'common', description: '精致的蝴蝶领结',                       price: 60,  unlocked: true,  offsetY: 10, scale: 0.7 },
  { id: 'cape',      name: '披风',   emoji: '🦸', category: 'clothes', rarity: 'epic',   description: '帅气的超级英雄披风',                 price: 320, unlocked: false, offsetY: 16,  scale: 1.2 },
  { id: 'raincoat',  name: '雨衣',   emoji: '☔', category: 'clothes', rarity: 'rare',    description: '可爱的黄色小雨衣',                     price: 160, unlocked: false, offsetY: 14,  scale: 1.0 },
  { id: 'kimono',    name: '和服',   emoji: '👘', category: 'clothes', rarity: 'epic',    description: '典雅的传统日式和服',                 price: 400, unlocked: false, offsetY: 18,  scale: 1.3 },
  { id: 'tshirt',    name: 'T恤',    emoji: '👕', category: 'clothes', rarity: 'common',  description: '舒适的纯棉T恤',                       price: 50,  unlocked: true,  offsetY: 10,  scale: 0.9 },

  // --- 背景特效 ---
  { id: 'sparkle_bg', name: '星空背景', emoji: '🌌', category: 'background', rarity: 'epic',   description: '璀璨星空的梦幻背景',           price: 250, unlocked: false },
  { id: 'starmark',   name: '星光背景', emoji: '✨', category: 'background', rarity: 'common',  description: '闪烁的星芒背景特效',           price: 100, unlocked: true  },
  { id: 'flowercrown',name:'鲜花背景', emoji: '🌸', category: 'background', rarity: 'common',  description: '盛开的鲜花背景特效',           price: 100, unlocked: true  },
  { id: 'rainbow_bg', name: '彩虹背景', emoji: '🌈', category: 'background', rarity: 'rare',   description: '七色彩虹的温暖背景',           price: 200, unlocked: false },
  { id: 'hearts_bg',  name: '爱心背景', emoji: '💕', category: 'background', rarity: 'common', description: '满满爱心的甜蜜背景',           price: 100, unlocked: true  },

  // --- 特殊 ---
  { id: 'angelwings', name: '天使翅膀', emoji: '👼', category: 'special', rarity: 'legendary', description: '圣洁的天使翅膀，轻盈飞舞',     price: 600, unlocked: false, offsetY: 4,  scale: 1.5 },
  { id: 'deviltail',  name: '恶魔尾巴', emoji: '😈', category: 'special', rarity: 'rare',      description: '俏皮的小恶魔尾巴',               price: 220, unlocked: false, offsetY: 20, scale: 0.9 },
  { id: 'bubble',     name: '泡泡',      emoji: '🫧', category: 'special', rarity: 'common',    description: '飘浮的七彩泡泡',                 price: 90,  unlocked: true,  offsetY: -12 },
  { id: 'halo',       name: '光环',      emoji: '😇', category: 'special', rarity: 'epic',      description: '神圣的头顶光环',                 price: 350, unlocked: false, offsetY: -32 },
];

// ============ 分类中文名 ============
export const CATEGORY_LABELS: Record<OutfitCategory | 'all', string> = {
  all: '全部',
  hat: '帽子',
  accessory: '面饰',
  clothes: '服饰',
  background: '背景',
  special: '特殊',
};

// ============ Store ============
interface OutfitState {
  outfits: OutfitItem[];
  equipped: Partial<Record<OutfitCategory, string>>; // category -> outfitId
  coins: number;
  selectedCategory: OutfitCategory | 'all';
  previewOutfit: string | null; // hover 预览的装扮 ID
  isShopOpen: boolean;

  // Actions
  setShopOpen: (open: boolean) => void;
  setSelectedCategory: (cat: OutfitCategory | 'all') => void;
  setPreviewOutfit: (id: string | null) => void;
  equipOutfit: (id: string) => void;
  unequipOutfit: (id: string) => void;
  purchaseOutfit: (id: string) => void;
  unlockOutfit: (id: string) => void;
  addCoins: (amount: number) => void;
  getOutfitById: (id: string) => OutfitItem | undefined;
  isEquipped: (id: string) => boolean;
  getEquippedEmoji: (category: OutfitCategory) => string | null;

  // 持久化
  saveToStorage: () => void;
  loadFromStorage: () => void;
}

const STORAGE_KEY = 'xinyuan_outfit_data';

export const useOutfitStore = create<OutfitState>((set, get) => ({
  outfits: [...DEFAULT_OUTFITS],
  equipped: {},
  coins: 500,
  selectedCategory: 'all',
  previewOutfit: null,
  isShopOpen: false,

  setShopOpen: (open) => set({ isShopOpen: open }),

  setSelectedCategory: (cat) => set({ selectedCategory: cat }),

  setPreviewOutfit: (id) => set({ previewOutfit: id }),

  equipOutfit: (id) => {
    const outfit = get().outfits.find((o) => o.id === id);
    if (!outfit || !outfit.unlocked) return;

    // 同一分类只能装备一个
    set((state) => ({
      equipped: { ...state.equipped, [outfit.category]: id },
    }));
    get().saveToStorage();
  },

  unequipOutfit: (id) => {
    const outfit = get().outfits.find((o) => o.id === id);
    if (!outfit) return;

    set((state) => {
      const newEquipped = { ...state.equipped };
      if (newEquipped[outfit.category] === id) {
        delete newEquipped[outfit.category];
      }
      return { equipped: newEquipped };
    });
    get().saveToStorage();
  },

  purchaseOutfit: (id) => {
    const state = get();
    const outfit = state.outfits.find((o) => o.id === id);
    if (!outfit || outfit.unlocked) return;
    if (state.coins < outfit.price) return;

    set((s) => ({
      coins: s.coins - outfit.price,
      outfits: s.outfits.map((o) =>
        o.id === id ? { ...o, unlocked: true } : o
      ),
    }));
    // 购买后自动装备
    get().equipOutfit(id);
  },

  unlockOutfit: (id) => {
    set((state) => ({
      outfits: state.outfits.map((o) =>
        o.id === id ? { ...o, unlocked: true } : o
      ),
    }));
    get().saveToStorage();
  },

  addCoins: (amount) => {
    set((state) => ({ coins: state.coins + amount }));
    get().saveToStorage();
  },

  getOutfitById: (id) => get().outfits.find((o) => o.id === id),

  isEquipped: (id) => {
    const outfit = get().outfits.find((o) => o.id === id);
    if (!outfit) return false;
    return get().equipped[outfit.category] === id;
  },

  getEquippedEmoji: (category) => {
    const equippedId = get().equipped[category];
    if (!equippedId) return null;
    const outfit = get().outfits.find((o) => o.id === equippedId);
    return outfit?.emoji ?? null;
  },

  saveToStorage: () => {
    try {
      const { outfits, equipped, coins } = get();
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          outfits: outfits.map((o) => ({ id: o.id, unlocked: o.unlocked })),
          equipped,
          coins,
        })
      );
      // 反向同步 → PetGarden pet.accessories
      const OUTFIT_TO_SHOP: Record<string, string> = {
        'sunglasses': 'sunglasses', 'crown': 'crown', 'bowknot': 'ribbon',
        'scarf': 'scarf', 'flowercrown': 'flower', 'starmark': 'sparkles',
        'hearts_bg': 'hearts', 'bowtie': 'bowtie', 'tophat': 'hat',
      };
      const accessories = Object.values(equipped)
        .map((id) => OUTFIT_TO_SHOP[id])
        .filter(Boolean);
      if (accessories.length > 0) {
        // 扫描所有 xinyuan_*_pet 键并更新
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.includes('_pet')) {
            try {
              const petData = JSON.parse(localStorage.getItem(key)!);
              if (petData && Array.isArray(petData.accessories)) {
                // 合并：保留已有 + 新增 outfilt 映射的
                const merged = [...new Set([...petData.accessories, ...accessories])];
                petData.accessories = merged;
                localStorage.setItem(key, JSON.stringify(petData));
              }
            } catch {}
          }
        }
      }
    } catch {}
  },

  loadFromStorage: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);

      if (data.outfits && Array.isArray(data.outfits)) {
        const unlockMap = new Map<string, boolean>();
        data.outfits.forEach((o: { id: string; unlocked: boolean }) => {
          unlockMap.set(o.id, o.unlocked);
        });

        set((state) => ({
          outfits: state.outfits.map((o) =>
            unlockMap.has(o.id) ? { ...o, unlocked: unlockMap.get(o.id)! } : o
          ),
        }));
      }

      if (data.equipped) set({ equipped: data.equipped });
      if (typeof data.coins === 'number') set({ coins: data.coins });
    } catch {}
  },
}));
