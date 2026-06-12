import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { PetAction } from '@/utils/petActionParser';
import { syncMessage, syncConversation, fetchConversations, fetchMessages } from '@/services/supabase';

// ============ 简易本地存储适配器（按用户隔离） ============
let _getAuthUserId: (() => string) | null = null;

/** 注入获取当前用户ID的方法（由 authStore 在 init 时调用） */
export function injectAuthUserIdGetter(getter: () => string) {
  _getAuthUserId = getter;
}

const storage = {
  getUserId(): string {
    return _getAuthUserId?.() || 'anonymous';
  },
  get(key: string, fallback: any = null) {
    try {
      const raw = localStorage.getItem(`xinyuan_${this.getUserId()}_${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  set(key: string, value: any) {
    try { localStorage.setItem(`xinyuan_${this.getUserId()}_${key}`, JSON.stringify(value)); } catch {}
  },
};

// ============ 应用 Store ============
type PageId = 'chat' | 'pet' | 'mate' | 'emotion' | 'memory' | 'settings';

interface AppState {
  currentPage: PageId;
  setPage: (page: PageId) => void;
  currentSessionId: string | null;
  setCurrentSession: (id: string) => void;
  initSession: () => string;
  userNickname: string;
  setUserNickname: (name: string) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  // 方案B：悬浮窗
  petWindowVisible: boolean;
  togglePetWindow: () => void;
  isElectron: boolean;
  setIsElectron: (v: boolean) => void;
  // Coze 会话ID映射: session_id -> coze conversation_id
  cozeConvMap: Record<string, string>;
  setCozeConvId: (sessionId: string, convId: string) => void;
  getCozeConvId: (sessionId: string) => string | undefined;
  // Coze 初始 chat_id 映射: session_id -> 首次 chat_id（用于后续轮询）
  cozeChatMap: Record<string, string>;
  setCozeChatId: (sessionId: string, chatId: string) => void;
  getCozeChatId: (sessionId: string) => string | undefined;
}

export const useAppStore = create<AppState>((set, get) => ({
  currentPage: 'chat',
  setPage: (page) => set({ currentPage: page }),
  currentSessionId: null,
  setCurrentSession: (id) => {
    set({ currentSessionId: id });
    storage.set('currentSessionId', id);
  },
  initSession: () => {
    const id = uuidv4();
    set({ currentSessionId: id });
    storage.set('currentSessionId', id);
    return id;
  },
  userNickname: storage.get('nickname', '你'),
  setUserNickname: (name) => {
    set({ userNickname: name });
    storage.set('nickname', name);
  },
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  cozeConvMap: storage.get('cozeConvMap', {}),
  setCozeConvId: (sessionId, convId) => {
    const map = { ...get().cozeConvMap, [sessionId]: convId };
    storage.set('cozeConvMap', map);
    set({ cozeConvMap: map });

    // 同步对话到 Supabase（含 Coze conversation_id）
    const userId = storage.getUserId();
    if (userId && userId !== 'anonymous') {
      const sessions: any[] = storage.get('sessions', []);
      const session = sessions.find((s: any) => s.session_id === sessionId);
      const chatMap: Record<string, string> = storage.get('cozeChatMap', {});
      syncConversation({
        session_id: sessionId,
        coze_conversation_id: convId,
        coze_chat_id: chatMap[sessionId] || null,
        started_at: session?.started_at || new Date().toISOString(),
        last_active: session?.last_active || new Date().toISOString(),
        message_count: session?.message_count || 0,
      }, userId).catch(err => _logSyncError('setCozeConvId', err));
    }
  },
  getCozeConvId: (sessionId) => get().cozeConvMap[sessionId],
  cozeChatMap: storage.get('cozeChatMap', {}),
  setCozeChatId: (sessionId, chatId) => {
    const map = { ...get().cozeChatMap, [sessionId]: chatId };
    storage.set('cozeChatMap', map);
    set({ cozeChatMap: map });

    // 同步对话到 Supabase（含 Coze chat_id）
    const userId = storage.getUserId();
    if (userId && userId !== 'anonymous') {
      const sessions: any[] = storage.get('sessions', []);
      const session = sessions.find((s: any) => s.session_id === sessionId);
      const convMap: Record<string, string> = storage.get('cozeConvMap', {});
      syncConversation({
        session_id: sessionId,
        coze_conversation_id: convMap[sessionId] || null,
        coze_chat_id: chatId,
        started_at: session?.started_at || new Date().toISOString(),
        last_active: session?.last_active || new Date().toISOString(),
        message_count: session?.message_count || 0,
      }, userId).catch(err => _logSyncError('setCozeChatId', err));
    }
  },
  getCozeChatId: (sessionId) => get().cozeChatMap[sessionId],
  // 方案B：悬浮窗控制
  petWindowVisible: false,
  togglePetWindow: () => {
    const visible = !get().petWindowVisible;
    set({ petWindowVisible: visible });
    // 通过 IPC 通知 Electron 主进程
    if (typeof window !== 'undefined' && (window as any).petAPI) {
      if (visible) {
        (window as any).petAPI.showPet();
      } else {
        (window as any).petAPI.hidePet();
      }
    }
  },
  isElectron: false,
  setIsElectron: (v) => set({ isElectron: v }),
}));

// ============ Coze 配置 Store ============
interface CozeConfig {
  token: string;
  botId: string;
  baseUrl: string;
}

interface CozeConfigState {
  config: CozeConfig | null;
  isConfigured: boolean;
  saveConfig: (config: CozeConfig) => void;
  clearConfig: () => void;
  loadConfig: () => void;
}

export const useCozeConfigStore = create<CozeConfigState>((set) => ({
  config: storage.get('cozeConfig', null),
  isConfigured: !!storage.get('cozeConfig', null),

  saveConfig: (config) => {
    storage.set('cozeConfig', config);
    set({ config, isConfigured: true });
  },

  clearConfig: () => {
    storage.set('cozeConfig', null);
    set({ config: null, isConfigured: false });
  },

  loadConfig: () => {
    const config = storage.get('cozeConfig', null);
    set({ config, isConfigured: !!config });
  },
}));

// ============ 对话 Store ============
interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  emotion_score?: number;
  emotion_label?: string;
  created_at?: string;
}

interface Session {
  session_id: string;
  started_at: string;
  last_active: string;
  message_count: number;
}

// 防抖消息同步 timer 映射
const _msgSyncTimers: Record<string, ReturnType<typeof setTimeout>> = {};

/** 记录同步错误到 localStorage，方便调试 */
function _logSyncError(ctx: string, err: any) {
  console.error(`[Sync:${ctx}]`, err);
  try {
    const key = `xinyuan_${storage.getUserId()}_syncErrors`;
    const prev = JSON.parse(localStorage.getItem(key) || '[]');
    prev.push({ time: new Date().toISOString(), ctx, message: err?.message || String(err) });
    if (prev.length > 50) prev.splice(0, prev.length - 50);
    localStorage.setItem(key, JSON.stringify(prev));
  } catch {}
}

/** 异步同步一条消息到 Supabase（不影响 UI） */
function _syncOneMessage(msg: Message) {
  const userId = storage.getUserId();
  console.log('[Sync] _syncOneMessage 触发 | userId:', userId, '| msgId:', msg.id, '| role:', msg.role);
  if (!userId || userId === 'anonymous') {
    console.warn('[Sync] ⚠️ 跳过同步（用户未登录或匿名）');
    return;
  }
  console.log('[Sync] 开始同步消息:', { session_id: msg.session_id, message_local_id: msg.id, role: msg.role });
  syncMessage({
    session_id: msg.session_id,
    message_local_id: msg.id,
    role: msg.role,
    content: msg.content,
    emotion_score: msg.emotion_score ?? undefined,
    emotion_label: msg.emotion_label ?? undefined,
    created_at: msg.created_at || new Date().toISOString(),
  }, userId).then(() => {
    console.log('[Sync] ✅ 消息同步成功:', msg.id);
  }).catch(err => {
    console.error('[Sync] ❌ 消息同步失败:', err);
    _logSyncError('message', err);
  });
}

/** 异步同步一条对话元数据到 Supabase */
function _syncConversation(session: Session) {
  const userId = storage.getUserId();
  console.log('[Sync] _syncConversation 触发 | userId:', userId, '| sessionId:', session.session_id);
  if (!userId || userId === 'anonymous') {
    console.warn('[Sync] ⚠️ 跳过会话同步（用户未登录或匿名）');
    return;
  }
  const convMap: Record<string, string> = storage.get('cozeConvMap', {});
  const chatMap: Record<string, string> = storage.get('cozeChatMap', {});
  syncConversation({
    session_id: session.session_id,
    coze_conversation_id: convMap[session.session_id] || null,
    coze_chat_id: chatMap[session.session_id] || null,
    started_at: session.started_at,
    last_active: session.last_active,
    message_count: session.message_count,
  }, userId).then(() => {
    console.log('[Sync] ✅ 会话同步成功:', session.session_id);
  }).catch(err => {
    console.error('[Sync] ❌ 会话同步失败:', err);
    _logSyncError('conversation', err);
  });
}

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  sessions: Session[];
  loadHistory: (sessionId: string) => void;
  addMessage: (msg: Message) => void;
  updateMessage: (id: string, content: string) => void;
  loadSessions: () => void;
  setLoading: (loading: boolean) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  sessions: storage.get('sessions', []),

  loadHistory: (sessionId) => {
    // 先从 localStorage 加载（立即渲染）
    const allMessages: Message[] = storage.get('allMessages', []);
    const msgs = allMessages.filter((m: Message) => m.session_id === sessionId);
    set({ messages: msgs });

    // 异步从 Supabase 拉取远程消息并合并
    const userId = storage.getUserId();
    if (userId && userId !== 'anonymous') {
      fetchMessages(sessionId, userId).then(remoteMsgs => {
        if (remoteMsgs.length > 0) {
          // 重新获取最新的 allMessages（可能已被其他操作修改）
          const all = storage.get('allMessages', []) as Message[];
          const localMsgIds = new Set(all.map(m => m.id));
          let hasNew = false;
          for (const rm of remoteMsgs) {
            if (!localMsgIds.has(rm.message_local_id)) {
              all.push({
                id: rm.message_local_id,
                session_id: rm.session_id,
                role: rm.role,
                content: rm.content,
                emotion_score: rm.emotion_score ?? undefined,
                emotion_label: rm.emotion_label ?? undefined,
                created_at: rm.created_at,
              });
              hasNew = true;
            }
          }
          if (hasNew) {
            storage.set('allMessages', all);
            // 恢复 Coze conversation_id 映射
            const remoteConv = remoteMsgs.length > 0 ? null : null; // 由 fetchConversations 处理
            const merged = all.filter((m: Message) => m.session_id === sessionId);
            set({ messages: merged });
          }
        }
      }).catch(err => _logSyncError('fetchMessages', err));
    }
  },

  addMessage: (msg) => {
    const allMessages: Message[] = storage.get('allMessages', []);
    allMessages.push(msg);
    // 只保留最近1000条
    if (allMessages.length > 1000) allMessages.splice(0, allMessages.length - 1000);
    storage.set('allMessages', allMessages);

    // 更新会话列表
    const sessions: Session[] = storage.get('sessions', []);
    const existingIdx = sessions.findIndex(s => s.session_id === msg.session_id);
    if (existingIdx >= 0) {
      sessions[existingIdx].last_active = new Date().toISOString();
      sessions[existingIdx].message_count++;
    } else {
      sessions.unshift({
        session_id: msg.session_id,
        started_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
        message_count: 1,
      });
    }
    storage.set('sessions', sessions);

    // 🔄 异步同步到 Supabase（不影响 UI 渲染）
    _syncOneMessage(msg);
    const conv = sessions.find(s => s.session_id === msg.session_id);
    if (conv) _syncConversation(conv);

    set((s) => ({
      messages: [...s.messages, msg],
      sessions: [...sessions],
    }));
  },

  updateMessage: (id, content) => {
    const allMessages: Message[] = storage.get('allMessages', []);
    const idx = allMessages.findIndex((m: Message) => m.id === id);
    if (idx >= 0) allMessages[idx].content = content;
    storage.set('allMessages', allMessages);

    // 🔄 防抖同步到 Supabase（流式输出期间 500ms 触发一次即可）
    clearTimeout(_msgSyncTimers[id]);
    _msgSyncTimers[id] = setTimeout(() => {
      delete _msgSyncTimers[id];
      const msg = allMessages.find((m: Message) => m.id === id);
      if (msg) _syncOneMessage(msg);
    }, 500);

    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)),
    }));
  },

  loadSessions: () => {
    // 先从 localStorage 加载
    const localSessions: Session[] = storage.get('sessions', []);
    set({ sessions: localSessions });

    // 🔄 异步从 Supabase 拉取远程会话并合并
    const userId = storage.getUserId();
    if (userId && userId !== 'anonymous') {
      fetchConversations(userId).then(remoteConvs => {
        if (remoteConvs.length > 0) {
          const convMap = new Map<string, Session>();
          for (const s of localSessions) convMap.set(s.session_id, s);
          for (const rc of remoteConvs) {
            if (!convMap.has(rc.session_id)) {
              convMap.set(rc.session_id, {
                session_id: rc.session_id,
                started_at: rc.started_at,
                last_active: rc.last_active,
                message_count: rc.message_count,
              });
            } else {
              const local = convMap.get(rc.session_id)!;
              if (new Date(rc.last_active) > new Date(local.last_active)) {
                local.last_active = rc.last_active;
              }
              if (rc.message_count > local.message_count) {
                local.message_count = rc.message_count;
              }
            }
            // 恢复 Coze conversation_id / chat_id 映射
            if (rc.coze_conversation_id) {
              const convMapData: Record<string, string> = storage.get('cozeConvMap', {});
              if (!convMapData[rc.session_id]) {
                convMapData[rc.session_id] = rc.coze_conversation_id;
                storage.set('cozeConvMap', convMapData);
              }
            }
            if (rc.coze_chat_id) {
              const chatMapData: Record<string, string> = storage.get('cozeChatMap', {});
              if (!chatMapData[rc.session_id]) {
                chatMapData[rc.session_id] = rc.coze_chat_id;
                storage.set('cozeChatMap', chatMapData);
              }
            }
          }
          const merged = Array.from(convMap.values()).sort(
            (a, b) => new Date(b.last_active).getTime() - new Date(a.last_active).getTime()
          );
          storage.set('sessions', merged);
          set({ sessions: merged });
        }
      }).catch(err => _logSyncError('fetchConversations', err));
    }
  },

  setLoading: (loading) => set({ isLoading: loading }),
}));

// ============ 萌宠 Store ============
type ReactionType = 'none' | 'nod' | 'heart' | 'hug' | 'surprise' | 'comfort' | 'cheer' | 'sparkle';

interface SpeechBubble {
  text: string;
  emotion: string;
  visible: boolean;
  timestamp: number;
  source: 'ai' | 'system' | 'greeting';
  type?: string; // 'reaction' | 'greeting' | 'milestone'
}


// ============ 装扮系统 ============
export interface AccessoryItem {
  id: string;
  name: string;
  emoji: string;
  price: number;
  category: 'face' | 'head' | 'body' | 'effect';
  description: string;
}

export const SHOP_ITEMS: AccessoryItem[] = [
  { id: 'sunglasses', name: '墨镜', emoji: '🕶️', price: 100, category: 'face',   description: '酷酷的墨镜，戴上超有型' },
  { id: 'crown',      name: '皇冠', emoji: '👑', price: 300, category: 'head',   description: '金光闪闪的小皇冠' },
  { id: 'ribbon',     name: '蝴蝶结', emoji: '🎀', price: 80,  category: 'head',   description: '可爱的蝴蝶结发饰' },
  { id: 'scarf',      name: '围巾', emoji: '🧣', price: 120, category: 'body',   description: '暖和的围巾，冬天必备' },
  { id: 'flower',     name: '小花', emoji: '🌸', price: 50,  category: 'head',   description: '一朵清新的小花' },
  { id: 'sparkles',   name: '星光', emoji: '✨', price: 150, category: 'effect', description: '身边闪烁的星光特效' },
  { id: 'hearts',     name: '爱心', emoji: '💕', price: 200, category: 'effect', description: '漂浮的爱心气泡' },
  { id: 'bowtie',     name: '领结', emoji: '🎀', price: 90,  category: 'body',   description: '绅士的小领结' },
  { id: 'hat',        name: '礼帽', emoji: '🎩', price: 250, category: 'head',   description: '优雅的黑色礼帽' },
  { id: 'cat_ears',   name: '猫耳', emoji: '🐱', price: 180, category: 'head',   description: '更可爱的猫耳头饰' },
];
// ============ System A → System B 装扮同步（PetGarden 装备 → 桌宠显示） ============
const SHOP_TO_OUTFIT_MAP: Record<string, string> = {
  "sunglasses": "sunglasses", "crown": "crown", "ribbon": "bowknot",
  "scarf": "scarf", "flower": "flowercrown", "sparkles": "starmark",
  "hearts": "hearts_bg", "bowtie": "bowtie", "hat": "tophat", "cat_ears": "catear",
};
const SHOP_CATEGORY_TO_OUTFIT: Record<string, string> = {
  "sunglasses": "accessory", "crown": "hat", "ribbon": "hat",
  "scarf": "clothes", "flower": "background", "sparkles": "background",
  "hearts": "background", "bowtie": "clothes", "hat": "hat",
};
function syncPetToOutfit(petAccessories: string[]) {
  try {
    const equipped: Record<string, string> = {};
    for (const accId of petAccessories) {
      const outfitId = SHOP_TO_OUTFIT_MAP[accId];
      const category = SHOP_CATEGORY_TO_OUTFIT[accId];
      if (outfitId && category) equipped[category] = outfitId;
    }
    const raw = localStorage.getItem("xinyuan_outfit_data");
    const existing = raw ? JSON.parse(raw) : {};
    localStorage.setItem("xinyuan_outfit_data", JSON.stringify({ ...existing, equipped }));
  } catch {}
}

interface PetState {
  pet: { mood: string; energy: number; level: number; exp: number; skin: string; accessories: string[] };
  isAnimating: boolean;
  reaction: ReactionType;
  speechBubble: SpeechBubble | null;
  greetingQueue: string[];
  hasGreetedToday: boolean;
  lastInteraction: number;
  targetAction: PetAction;
  loadPet: () => void;
  feedPet: () => void;
  setPetMood: (mood: string) => void;
	equipAccessory: (itemId: string) => void;
	unequipAccessory: (itemId: string) => void;
	isAccessoryEquipped: (itemId: string) => boolean;
  // 方案A/B/C 新增方法
  notifyPet: (text: string, emotion: string, source?: 'ai' | 'system' | 'greeting') => void;
  showSpeechBubble: (text: string, emotion: string, source?: string) => void;
  hideSpeechBubble: () => void;
  triggerReaction: (reaction: ReactionType) => void;
  addExperience: (amount: number) => void;
  queueGreeting: (text: string) => void;
  markGreeted: () => void;
  resetGreetingTimer: () => void;
  setTargetAction: (action: PetAction) => void;
}

export const usePetStore = create<PetState>((set, get) => ({
  pet: storage.get('pet', { mood: 'calm', energy: 7, level: 1, exp: 0, skin: 'default', accessories: [] }),
  isAnimating: false,
  reaction: 'none' as ReactionType,
  speechBubble: null,
  greetingQueue: [],
  hasGreetedToday: storage.get('hasGreetedToday', false),
  lastInteraction: storage.get('lastInteraction', Date.now()),
  targetAction: 'idle' as PetAction,

  loadPet: () => {
    const pet = storage.get('pet', { mood: 'calm', energy: 7, level: 1, exp: 0, skin: 'default', accessories: [] });
    const hasGreetedToday = storage.get('hasGreetedToday', false);
    const lastInteraction = storage.get('lastInteraction', Date.now());
    set({ pet, hasGreetedToday, lastInteraction });
  },

  feedPet: () => {
    const pet = { ...get().pet };
    pet.energy = Math.min(10, pet.energy + 1);
    pet.exp += 10;
    if (pet.exp >= pet.level * 100) {
      pet.level++;
    }
    storage.set('pet', pet);
    storage.set('lastInteraction', Date.now());
    set({ pet, isAnimating: true, lastInteraction: Date.now() });
    setTimeout(() => set({ isAnimating: false }), 2000);
  },


  equipAccessory: (itemId: string) => {
    const pet = { ...get().pet };
    if (!pet.accessories.includes(itemId)) {
      pet.accessories = [...pet.accessories, itemId];
      storage.set('pet', pet);
      syncPetToOutfit(pet.accessories);
      set({ pet });
    }
  },

  unequipAccessory: (itemId: string) => {
    const pet = { ...get().pet };
    pet.accessories = pet.accessories.filter(id => id !== itemId);
    storage.set('pet', pet);
    syncPetToOutfit(pet.accessories);
    set({ pet });
  },

  isAccessoryEquipped: (itemId: string) => {
    return get().pet.accessories.includes(itemId);
  },
		  setPetMood: (mood) => {
    const pet = { ...get().pet, mood };
    storage.set('pet', pet);
    set({ pet });
  },

  // ---- 方案A：AI回复实时气泡 ----
  notifyPet: (text, emotion, source = 'ai') => {
    // 提取关键情绪词作为气泡文本（限制15字）
    const shortText = text.length > 25 ? text.slice(0, 25) + '...' : text;
    get().showSpeechBubble(shortText, emotion, source);

    // 根据情绪触发对应反应动画
    const reactionMap: Record<string, ReactionType> = {
      '开心': 'heart', '快乐': 'heart', '喜悦': 'sparkle', '高兴': 'cheer',
      '难过': 'comfort', '悲伤': 'comfort', '低落': 'comfort',
      '焦虑': 'nod', '紧张': 'nod', '不安': 'nod',
      '惊讶': 'surprise', '震惊': 'surprise',
      '温暖': 'hug', '感动': 'hug', '安慰': 'hug',
    };
    const reaction = reactionMap[emotion] || 'nod';
    get().triggerReaction(reaction);

    // 每次交流增加经验
    get().addExperience(5);
  },

  showSpeechBubble: (text, emotion, source = 'ai') => {
    const bubble: SpeechBubble = {
      text, emotion, visible: true,
      timestamp: Date.now(),
      source: source as SpeechBubble['source'],
    };
    set({ speechBubble: bubble });
    // 5秒后自动消失
    setTimeout(() => {
      const current = get().speechBubble;
      if (current && current.timestamp === bubble.timestamp) {
        set({ speechBubble: null });
      }
    }, 5000);
  },

  hideSpeechBubble: () => set({ speechBubble: null }),

  triggerReaction: (reaction) => {
    set({ reaction, isAnimating: true });
    setTimeout(() => set({ reaction: 'none', isAnimating: false }), 3000);
  },

  addExperience: (amount) => {
    const pet = { ...get().pet };
    pet.exp += amount;
    let leveledUp = false;
    while (pet.exp >= pet.level * 100) {
      pet.exp -= pet.level * 100;
      pet.level++;
      leveledUp = true;
    }
    storage.set('pet', pet);
    set({ pet });
    // 升级提示
    if (leveledUp) {
      get().showSpeechBubble(`🎉 升到 Lv.${pet.level} 啦！`, '喜悦', 'system');
    }
  },

  // ---- 方案C：定时问候 ----
  queueGreeting: (text) => {
    set((s) => ({ greetingQueue: [...s.greetingQueue, text] }));
  },

  markGreeted: () => {
    storage.set('hasGreetedToday', true);
    set({ hasGreetedToday: true });
  },

  resetGreetingTimer: () => {
    // 每天重置问候标记
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0); // 次日8点重置
    const msUntilReset = tomorrow.getTime() - now.getTime();
    setTimeout(() => {
      set({ hasGreetedToday: false });
      storage.set('hasGreetedToday', false);
    }, msUntilReset);
  },

  setTargetAction: (action: PetAction) => {
    set({ targetAction: action });
  },
}));

// ============ 情绪 Store ============
interface EmotionLog {
  id?: string;
  date: string;
  hour: number;
  score: number;
  label: string;
  stressor?: string;
  note?: string;
}

interface EmotionState {
  todayLogs: EmotionLog[];
  weeklyData: { date: string; avg_score: number; labels: string }[];
  currentMood: string;
  loadToday: () => void;
  loadWeekly: () => void;
  addLog: (log: EmotionLog) => void;
  setCurrentMood: (mood: string) => void;
}

export const useEmotionStore = create<EmotionState>((set, get) => ({
  todayLogs: [],
  weeklyData: [],
  currentMood: '平静',

  loadToday: () => {
    const allLogs: EmotionLog[] = storage.get('emotionLogs', []);
    const today = new Date().toISOString().split('T')[0];
    const logs = allLogs.filter((l: EmotionLog) => l.date === today);
    set({ todayLogs: logs });
  },

  loadWeekly: () => {
    const allLogs: EmotionLog[] = storage.get('emotionLogs', []);
    const weekly: { date: string; avg_score: number; labels: string }[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayLogs = allLogs.filter((l: EmotionLog) => l.date === dateStr);
      if (dayLogs.length > 0) {
        const avg = dayLogs.reduce((s, l) => s + l.score, 0) / dayLogs.length;
        weekly.push({ date: dateStr, avg_score: avg, labels: dayLogs.map(l => l.label).join(',') });
      } else {
        weekly.push({ date: dateStr, avg_score: 6, labels: '无数据' });
      }
    }
    set({ weeklyData: weekly });
  },

  addLog: (log) => {
    const allLogs: EmotionLog[] = storage.get('emotionLogs', []);
    log.id = uuidv4();
    allLogs.push(log);
    storage.set('emotionLogs', allLogs);
    set({ currentMood: log.label });
    get().loadToday();
    get().loadWeekly();
    // 同步情绪到 Supabase 供搭子匹配
    const userId = storage.getUserId();
    if (userId && userId !== 'anonymous') {
      import('@/services/supabase').then(({ updateProfileEmotion }) => {
        updateProfileEmotion(userId, log.label).catch(() => {});
      });
    }
  },

  setCurrentMood: (mood) => {
    set({ currentMood: mood });
    const userId = storage.getUserId();
    if (userId && userId !== 'anonymous') {
      import('@/services/supabase').then(({ updateProfileEmotion }) => {
        updateProfileEmotion(userId, mood).catch(() => {});
      });
    }
  },
}));

// ============ 人格 Store ============
interface PersonaState {
  params: Record<string, number>;
  loadParams: () => void;
  updateParam: (name: string, value: number) => void;
}

export const usePersonaStore = create<PersonaState>((set) => ({
  params: storage.get('persona', {
    '共情深度': 7, '引导主动性': 5, '幽默感': 4,
    '坚定度': 5, '温柔度': 8, '结构化程度': 4, '自发性问候': 3,
  }),

  loadParams: () => {
    const params = storage.get('persona', {
      '共情深度': 7, '引导主动性': 5, '幽默感': 4,
      '坚定度': 5, '温柔度': 8, '结构化程度': 4, '自发性问候': 3,
    });
    set({ params });
  },

  updateParam: (name, value) => {
    const params = { ...storage.get('persona', {}), [name]: value };
    storage.set('persona', params);
    set({ params });
  },
}));

// ============ 搭子 Store ============
import {
  searchMates,
  sendFriendRequest,
  getFriendRequests,
  respondFriendRequest,
  getFriends,
  getFriendshipId,
  sendFriendMessage as supabaseSendFriendMessage,
  getFriendMessages,
  updateProfileEmotion,
  type MateProfile,
  type FriendRequestRecord,
  type FriendRecord,
  type FriendMessageRecord,
} from '@/services/supabase';

interface MateMatch {
  id: string;               // channel_id（共享频道——双向一致）
  mate_id: string;          // 对方 user_id
  mate_nickname: string;
  mate_emotion_label?: string;
  match_mode: string;
  created_at: string;
}

interface MateMessage {
  id: number | string;      // 数据库 id 或本地临时 id
  match_id: string;         // channel_id
  sender_role: 'me' | 'mate' | 'system';
  content: string;
  created_at?: string;
}

interface MateState {
  // 好友列表
  mates: MateMatch[];
  // 收到的好友申请
  incomingRequests: FriendRequestRecord[];
  // 发出的好友申请（to_user_id -> status）
  outgoingRequests: Record<string, string>;
  // 活跃聊天
  activeMateId: string | null;      // channel_id
  activeMateUserId: string | null;  // 对方 user_id
  messages: MateMessage[];
  // 搜索
  searchResults: MateProfile[];
  isSearching: boolean;
  hasSearched: boolean;

  // 操作
  loadMates: () => Promise<void>;
  loadIncomingRequests: () => Promise<void>;
  searchForMates: (mode: string, myEmotionLabel?: string) => Promise<void>;
  requestMate: (toUserId: string, toUsername: string, message?: string) => Promise<void>;
  acceptRequest: (requestId: number, fromUserId: string, fromUsername: string) => Promise<void>;
  rejectRequest: (requestId: number) => Promise<void>;
  setActiveMate: (channelId: string | null, mateUserId?: string | null) => void;
  loadMateMessages: (channelId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  updateMyEmotion: (label: string, tags?: string) => Promise<void>;
  clearSearch: () => void;
}

export const useMateStore = create<MateState>((set, get) => ({
  mates: [],
  incomingRequests: [],
  outgoingRequests: {},
  activeMateId: null,
  activeMateUserId: null,
  messages: [],
  searchResults: [],
  isSearching: false,
  hasSearched: false,

  loadMates: async () => {
    const userId = storage.getUserId();
    if (!userId || userId === 'anonymous') return;
    try {
      const friends = await getFriends(userId);
      const mates: MateMatch[] = friends.map(f => ({
        id: f.channel_id,
        mate_id: f.friend_id,
        mate_nickname: f.friend_username || '未知用户',
        mate_emotion_label: f.friend_emotion_label || undefined,
        match_mode: 'resonance',
        created_at: f.created_at,
      }));
      set({ mates });
    } catch (err) {
      console.error('[MateStore] loadMates 失败:', err);
    }
  },

  loadIncomingRequests: async () => {
    const userId = storage.getUserId();
    if (!userId || userId === 'anonymous') return;
    try {
      const requests = await getFriendRequests(userId);
      set({ incomingRequests: requests });
    } catch (err) {
      console.error('[MateStore] loadIncomingRequests 失败:', err);
    }
  },

  searchForMates: async (mode, myEmotionLabel) => {
    const userId = storage.getUserId();
    if (!userId || userId === 'anonymous') return;
    set({ isSearching: true, searchResults: [] });
    try {
      const results = await searchMates(userId, mode, myEmotionLabel);
      // 过滤掉已经是好友的人
      const existingMateIds = new Set(get().mates.map(m => m.mate_id));
      // 过滤掉已经发出申请的人
      const pendingIds = new Set(Object.keys(get().outgoingRequests));
      const filtered = results.filter(
        r => !existingMateIds.has(r.id) && !pendingIds.has(r.id)
      );
      set({ searchResults: filtered, isSearching: false, hasSearched: true });
    } catch (err) {
      console.error('[MateStore] searchForMates 失败:', err);
      set({ isSearching: false, hasSearched: true });
    }
  },

  requestMate: async (toUserId, toUsername, message) => {
    const userId = storage.getUserId();
    if (!userId || userId === 'anonymous') return;
    try {
      await sendFriendRequest(userId, toUserId, message || `Hi ${toUsername}，想和你成为搭子~`);
      // 记录已发出
      set(s => ({
        outgoingRequests: { ...s.outgoingRequests, [toUserId]: 'pending' },
        // 从搜索结果中移除
        searchResults: s.searchResults.filter(r => r.id !== toUserId),
      }));
    } catch (err) {
      console.error('[MateStore] requestMate 失败:', err);
      throw err;
    }
  },

  acceptRequest: async (requestId, fromUserId, fromUsername) => {
    const userId = storage.getUserId();
    if (!userId || userId === 'anonymous') return;
    try {
      const resp = await respondFriendRequest(requestId, true, fromUserId, userId);
      // 立即本地加入搭子列表（用返回的 channel_id）
      if (resp?.channel_id) {
        set(s => ({
          mates: [...s.mates.filter(m => m.mate_id !== fromUserId), {
            id: resp.channel_id,
            mate_id: fromUserId,
            mate_nickname: fromUsername,
            match_mode: 'resonance',
            created_at: new Date().toISOString(),
          }],
        }));
      }
      // 刷新完整列表
      await get().loadMates();
      await get().loadIncomingRequests();
    } catch (err) {
      console.error('[MateStore] acceptRequest 失败:', err);
      throw err;
    }
  },

  rejectRequest: async (requestId) => {
    const userId = storage.getUserId();
    if (!userId || userId === 'anonymous') return;
    try {
      // 需要 fromUserId 和 toUserId，从当前申请列表中找到
      const req = get().incomingRequests.find(r => r.id === requestId);
      if (!req) return;
      await respondFriendRequest(requestId, false, req.from_user_id, userId);
      // 从列表中移除
      set(s => ({
        incomingRequests: s.incomingRequests.filter(r => r.id !== requestId),
      }));
    } catch (err) {
      console.error('[MateStore] rejectRequest 失败:', err);
    }
  },

  setActiveMate: (channelId, mateUserId) => {
    set({
      activeMateId: channelId,
      activeMateUserId: mateUserId || null,
      messages: [],
    });
  },

  loadMateMessages: async (channelId) => {
    try {
      const msgs = await getFriendMessages(channelId);
      const userId = storage.getUserId();
      const mapped: MateMessage[] = msgs.map(m => ({
        id: m.id,
        match_id: m.channel_id || channelId,
        sender_role: m.sender_id === userId ? 'me' : 'mate',
        content: m.content,
        created_at: m.created_at,
      }));
      set({ messages: mapped });
    } catch (err) {
      console.error('[MateStore] loadMateMessages 失败:', err);
    }
  },

  sendMessage: async (content) => {
    const { activeMateId } = get();
    const userId = storage.getUserId();
    if (!activeMateId || !userId || userId === 'anonymous') return;

    // 乐观更新：立即显示消息
    const tempId = `temp_${Date.now()}`;
    const tempMsg: MateMessage = {
      id: tempId,
      match_id: activeMateId,
      sender_role: 'me',
      content,
      created_at: new Date().toISOString(),
    };
    set(s => ({ messages: [...s.messages, tempMsg] }));

    try {
      await supabaseSendFriendMessage(activeMateId, userId, content);
      // 重新加载以获取真实 id
      await get().loadMateMessages(activeMateId);
    } catch (err) {
      console.error('[MateStore] sendMessage 失败:', err);
      // 移除乐观更新的消息
      set(s => ({
        messages: s.messages.filter(m => m.id !== tempId),
      }));
    }
  },

  updateMyEmotion: async (label, tags) => {
    const userId = storage.getUserId();
    if (!userId || userId === 'anonymous') return;
    try {
      await updateProfileEmotion(userId, label, tags);
    } catch (err) {
      console.error('[MateStore] updateMyEmotion 失败:', err);
    }
  },

  clearSearch: () => set({ searchResults: [], isSearching: false, hasSearched: false }),
}));

// ============ 记忆锚点 Store ============
interface MemoryAnchor {
  id: string;
  type: string;
  title: string;
  content: string;
  tags?: string;
  emotion?: string;
  importance?: number;
  is_marked?: number;
  recalled_at?: string;
  created_at: string;
}

interface MemoryState {
  anchors: MemoryAnchor[];
  loadAnchors: () => void;
  addAnchor: (anchor: MemoryAnchor) => void;
}

export const useMemoryStore = create<MemoryState>((set) => ({
  anchors: storage.get('memoryAnchors', []),

  loadAnchors: () => {
    const anchors = storage.get('memoryAnchors', []);
    set({ anchors });
  },

  addAnchor: (anchor) => {
    const anchors = [anchor, ...storage.get('memoryAnchors', [])];
    storage.set('memoryAnchors', anchors);
    set({ anchors });
  },
}));

// ============ 里程碑 Store ============
interface Milestone {
  id: string;
  type: string;
  title: string;
  description?: string;
  unlocked_at: string;
}

interface MilestoneState {
  milestones: Milestone[];
  load: () => void;
  unlock: (m: Omit<Milestone, 'id' | 'unlocked_at'>) => void;
}

export const useMilestoneStore = create<MilestoneState>((set) => ({
  milestones: storage.get('milestones', []),
  load: () => set({ milestones: storage.get('milestones', []) }),
  unlock: (m) => {
    const milestone: Milestone = { ...m, id: uuidv4(), unlocked_at: new Date().toISOString() };
    const milestones = [milestone, ...storage.get('milestones', [])];
    storage.set('milestones', milestones);
    set({ milestones });
  },
}));

export * from './outfitStore';
