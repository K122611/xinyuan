import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

// ============ 简易本地存储适配器 ============
const storage = {
  get(key: string, fallback: any = null) {
    try {
      const raw = localStorage.getItem(`xinyuan_${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  set(key: string, value: any) {
    try { localStorage.setItem(`xinyuan_${key}`, JSON.stringify(value)); } catch {}
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
  },
  getCozeConvId: (sessionId) => get().cozeConvMap[sessionId],

  cozeChatMap: storage.get('cozeChatMap', {}),
  setCozeChatId: (sessionId, chatId) => {
    const map = { ...get().cozeChatMap, [sessionId]: chatId };
    storage.set('cozeChatMap', map);
    set({ cozeChatMap: map });
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

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  sessions: Session[];
  loadHistory: (sessionId: string) => void;
  addMessage: (msg: Message) => void;
  loadSessions: () => void;
  setLoading: (loading: boolean) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  sessions: storage.get('sessions', []),

  loadHistory: (sessionId) => {
    const allMessages: Message[] = storage.get('allMessages', []);
    const msgs = allMessages.filter((m: Message) => m.session_id === sessionId);
    set({ messages: msgs });
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

    set((s) => ({
      messages: [...s.messages, msg],
      sessions: [...sessions],
    }));
  },

  loadSessions: () => {
    const sessions = storage.get('sessions', []);
    set({ sessions });
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

interface PetState {
  pet: { mood: string; energy: number; level: number; exp: number; skin: string };
  isAnimating: boolean;
  reaction: ReactionType;
  speechBubble: SpeechBubble | null;
  greetingQueue: string[];
  hasGreetedToday: boolean;
  lastInteraction: number;
  loadPet: () => void;
  feedPet: () => void;
  setPetMood: (mood: string) => void;
  // 方案A/B/C 新增方法
  notifyPet: (text: string, emotion: string, source?: 'ai' | 'system' | 'greeting') => void;
  showSpeechBubble: (text: string, emotion: string, source?: string) => void;
  hideSpeechBubble: () => void;
  triggerReaction: (reaction: ReactionType) => void;
  addExperience: (amount: number) => void;
  queueGreeting: (text: string) => void;
  markGreeted: () => void;
  resetGreetingTimer: () => void;
}

export const usePetStore = create<PetState>((set, get) => ({
  pet: storage.get('pet', { mood: 'calm', energy: 7, level: 1, exp: 0, skin: 'default' }),
  isAnimating: false,
  reaction: 'none' as ReactionType,
  speechBubble: null,
  greetingQueue: [],
  hasGreetedToday: storage.get('hasGreetedToday', false),
  lastInteraction: storage.get('lastInteraction', Date.now()),

  loadPet: () => {
    const pet = storage.get('pet', { mood: 'calm', energy: 7, level: 1, exp: 0, skin: 'default' });
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
  },

  setCurrentMood: (mood) => set({ currentMood: mood }),
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
interface MateMatch {
  id: string;
  mate_id: string;
  mate_nickname: string;
  match_mode: string;
  status: string;
  created_at: string;
}

interface MateMessage {
  id: string;
  match_id: string;
  sender_role: 'me' | 'mate' | 'system';
  content: string;
  created_at?: string;
}

interface MateState {
  matches: MateMatch[];
  activeMatchId: string | null;
  messages: MateMessage[];
  loadMatches: () => void;
  createMatch: (data: { mateId: string; mateNickname: string; matchMode: string }) => void;
  endMatch: (matchId: string) => void;
  setActiveMatch: (id: string | null) => void;
  loadMessages: (matchId: string) => void;
  addMessage: (msg: MateMessage) => void;
}

export const useMateStore = create<MateState>((set, get) => ({
  matches: storage.get('mateMatches', []),
  activeMatchId: null,
  messages: [],

  loadMatches: () => {
    const matches = storage.get('mateMatches', []);
    set({ matches });
  },

  createMatch: (data) => {
    const match: MateMatch = {
      id: uuidv4(),
      mate_id: data.mateId,
      mate_nickname: data.mateNickname,
      match_mode: data.matchMode,
      status: 'active',
      created_at: new Date().toISOString(),
    };
    const matches = [...storage.get('mateMatches', []), match];
    storage.set('mateMatches', matches);
    set({ matches, activeMatchId: match.id });
  },

  endMatch: (matchId) => {
    const matches = storage.get('mateMatches', []).map((m: MateMatch) =>
      m.id === matchId ? { ...m, status: 'ended', ended_at: new Date().toISOString() } : m
    );
    storage.set('mateMatches', matches);
    set({ matches, activeMatchId: null, messages: [] });
  },

  setActiveMatch: (id) => {
    set({ activeMatchId: id });
    if (id) get().loadMessages(id);
  },

  loadMessages: (matchId) => {
    const allMsg: MateMessage[] = storage.get('mateMessages', []);
    const msgs = allMsg.filter((m: MateMessage) => m.match_id === matchId);
    set({ messages: msgs });
  },

  addMessage: (msg) => {
    const allMsg: MateMessage[] = storage.get('mateMessages', []);
    allMsg.push(msg);
    storage.set('mateMessages', allMsg);
    set((s) => ({ messages: [...s.messages, msg] }));
  },
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
