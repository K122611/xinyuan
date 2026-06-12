import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 懒初始化：避免 import 时因环境变量缺失直接崩溃
let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[Supabase] 缺少环境变量 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
    }
    _supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        storage: localStorage,
      },
    });
  }
  return _supabase;
}

// 兼容旧引用（懒初始化）
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) { return (getSupabase() as any)[prop]; },
  set(_, prop, value) { return ((getSupabase() as any)[prop] = value), true; },
  has(_, prop) { return prop in getSupabase(); },
  getOwnPropertyDescriptor(_, prop) {
    return Object.getOwnPropertyDescriptor(getSupabase(), prop);
  },
  ownKeys() { return Reflect.ownKeys(getSupabase()); },
  getPrototypeOf() { return Object.getPrototypeOf(getSupabase()); },
  apply(_, thisArg, args) { return (getSupabase() as any).apply(thisArg, args); },
});

// ============ 同步 profiles（登录后补写） ============
export async function syncProfile(userId: string, username: string) {
  console.log('[Supabase] syncProfile upsert:', { id: userId, username });
  try {
    const { error } = await supabase.from('profiles').upsert(
      { id: userId, username, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    );
    if (error) console.warn('[Supabase] profiles upsert 失败:', error.message);
    else console.log('[Supabase] profiles upsert 成功');
  } catch (err) {
    console.error('[Supabase] syncProfile 异常:', err);
  }
}

// ============ 注册 ============
export async function signUp(email: string, password: string, username?: string) {
  console.log('[Supabase] signUp 开始:', { email, username });
  const options: any = {};
  if (username) {
    options.data = { username, display_name: username };
  }

  const { data, error } = await supabase.auth.signUp({ email, password, options });
  console.log('[Supabase] signUp 响应:', {
    user: !!data.user,
    session: !!data.session,
    error: error?.message || null,
    emailConfirmed: data.user?.email_confirmed_at || data.user?.confirmed_at || null,
    identities: data.user?.identities?.length ?? 0,
  });
  if (error) throw error;

  console.log('[Supabase] signUp 返回:', {
    hasUser: !!data.user,
    hasSession: !!data.session,
    userId: data.user?.id,
    errorCode: (error as any)?.code,
    errorMessage: (error as any)?.message,
  });

  // 注册后写入 profiles（RLS 已禁用，无论有无 session 都写入）
  if (data.user && username) {
    console.log('[Supabase] 准备写入 profiles:', { id: data.user.id, username });
    try {
      const { error: profileError, status } = await supabase.from('profiles').upsert(
        { id: data.user.id, username, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      );
      if (profileError) console.warn('[Supabase] profiles 写入失败:', profileError.message, 'status:', status);
      else console.log('[Supabase] profiles 写入成功');
    } catch (err) {
      console.error('[Supabase] profiles upsert 异常:', err);
    }
  } else {
    console.log('[Supabase] 跳过 profiles 写入:', { hasUser: !!data.user, hasUsername: !!username });
  }
  return data;
}

// ============ 登录 ============
export async function signIn(email: string, password: string) {
  console.log('[Supabase] signIn 开始:', { email });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  console.log('[Supabase] signIn 响应:', {
    user: !!data.user,
    session: !!data.session,
    error: error?.message || null,
  });
  if (error) throw error;
  return data;
}

// ============ 登出 ============
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ============ 获取当前用户 ============
export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) return null;
  return user;
}

// ============ 监听认证状态变化 ============
export function onAuthStateChange(callback: (user: any | null) => void) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}

// ============================================================
// 跨设备对话同步 —— 对话 & 消息
// ============================================================

export interface ConversationRecord {
  id?: string;
  user_id?: string;
  session_id: string;
  coze_conversation_id?: string | null;
  coze_chat_id?: string | null;
  started_at: string;
  last_active: string;
  message_count: number;
}

/** 同步单条对话到 Supabase（按 session_id upsert）
 *  @param userId - 从 Zustand 内存中取的 user.id，避免独立 HTTP 请求
 */
export async function syncConversation(conv: ConversationRecord, userId: string) {
  const { error } = await supabase
    .from('conversations')
    .upsert({
      user_id: userId,
      session_id: conv.session_id,
      coze_conversation_id: conv.coze_conversation_id || null,
      coze_chat_id: conv.coze_chat_id || null,
      started_at: conv.started_at,
      last_active: conv.last_active,
      message_count: conv.message_count,
    }, { onConflict: 'user_id,session_id' });
  if (error) throw new Error(`syncConversation: ${error.message} (code=${error.code})`);
}

/** 拉取当前用户所有对话 */
export async function fetchConversations(userId: string): Promise<ConversationRecord[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('last_active', { ascending: false });
  if (error) throw new Error(`fetchConversations: ${error.message} (code=${error.code})`);
  return (data || []) as ConversationRecord[];
}

export interface MessageRecord {
  id?: string;
  user_id?: string;
  session_id: string;
  message_local_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  emotion_score?: number | null;
  emotion_label?: string | null;
  created_at: string;
}

/** 同步单条消息到 Supabase（按 message_local_id upsert）
 *  @param userId - 从 Zustand 内存中取的 user.id，避免独立 HTTP 请求
 */
export async function syncMessage(msg: MessageRecord, userId: string) {
  const { error } = await supabase
    .from('chat_messages')
    .upsert({
      user_id: userId,
      session_id: msg.session_id,
      message_local_id: msg.message_local_id,
      role: msg.role,
      content: msg.content,
      emotion_score: msg.emotion_score ?? null,
      emotion_label: msg.emotion_label ?? null,
      created_at: msg.created_at,
    }, { onConflict: 'user_id,message_local_id' });
  if (error) throw new Error(`syncMessage: ${error.message} (code=${error.code})`);
}

/** 拉取指定对话的所有消息 */
export async function fetchMessages(sessionId: string, userId: string): Promise<MessageRecord[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`fetchMessages: ${error.message} (code=${error.code})`);
  return (data || []) as MessageRecord[];
}

// ============================================================
// 搭子空间 —— 匹配、好友请求、好友聊天
// ============================================================

export interface MateProfile {
  id: string;
  username: string;
  emotion_label?: string | null;
  mood_tags?: string | null;
  updated_at?: string;
}

/** 情绪归一化：同义词映射到同一标签 */
const EMOTION_NORMALIZE: Record<string, string> = {
  '开心': '开心',
  '快乐': '开心',
  '喜悦': '开心',
  '高兴': '开心',
  '兴奋': '开心',
  '难过': '难过',
  '悲伤': '难过',
  '低落': '难过',
  '伤心': '难过',
  '沮丧': '难过',
  '平和': '平静',
  '平静': '平静',
  '放松': '平静',
  '安心': '平静',
  '宁静': '平静',
  '焦虑': '焦虑',
  '紧张': '焦虑',
  '不安': '焦虑',
  '担心': '焦虑',
  '烦躁': '愤怒',
  '愤怒': '愤怒',
  '生气': '愤怒',
  '疲惫': '疲惫',
  '累了': '疲惫',
  '困倦': '疲惫',
};

function normalizeEmotion(label?: string | null): string | null {
  if (!label) return null;
  return EMOTION_NORMALIZE[label] || label;
}

/** 情绪匹配映射：互补模式下的情绪对 */
const COMPLEMENT_MAP: Record<string, string[]> = {
  '开心': ['难过', '平静'],
  '难过': ['平静', '开心'],
  '平静': ['焦虑', '难过'],
  '焦虑': ['平静'],
  '愤怒': ['平静'],
  '疲惫': ['平静'],
};

/** 根据匹配模式搜索潜在搭子 */
export async function searchMates(
  userId: string,
  mode: string,
  myEmotionLabel?: string | null
): Promise<MateProfile[]> {
  // ===== 诊断：先查所有 profiles =====
  const { data: allProfiles, error: diagErr } = await supabase
    .from('profiles')
    .select('id, username, emotion_label');
  console.log(`[MateSearch] DIAG 所有profiles: ${allProfiles?.length || 0}条, error=`, diagErr?.message || null);
  if (allProfiles) {
    allProfiles.forEach(p => console.log(`  - id=${p.id?.substring(0,8)}... name=${p.username} emotion=${p.emotion_label}`));
  }

  // 基础查询：排除自己
  const baseQuery = () => supabase
    .from('profiles')
    .select('id, username, emotion_label, mood_tags, updated_at')
    .neq('id', userId);

  let data: any[] | null = null;
  let error: any = null;

  console.log(`[MateSearch] 搜索模式=${mode}, 我的情绪原始=${myEmotionLabel}, 归一化=${normalizeEmotion(myEmotionLabel)}, userId=${userId?.substring(0,8)}...`);

  const normalizedEmotion = normalizeEmotion(myEmotionLabel);

  if (mode === 'resonance' && normalizedEmotion) {
    // 共鸣：优先归一化后相同情绪，无结果则回退到所有用户
    const { data: d1, error: e1 } = await baseQuery()
      .eq('emotion_label', normalizedEmotion)
      .order('updated_at', { ascending: false })
      .limit(20);
    data = d1; error = e1;
    console.log(`[MateSearch] 共鸣模式 精确匹配 emotion=${normalizedEmotion}: ${data?.length || 0} 条`);
    if (!error && (!data || data.length === 0)) {
      const { data: d2, error: e2 } = await baseQuery()
        .order('updated_at', { ascending: false })
        .limit(20);
      data = d2; error = e2;
      console.log(`[MateSearch] 共鸣模式 回退全部: ${data?.length || 0} 条`);
    }
  } else if (mode === 'complement' && normalizedEmotion) {
    const targets = COMPLEMENT_MAP[normalizedEmotion] || [];
    if (targets.length > 0) {
      const { data: d1, error: e1 } = await baseQuery()
        .in('emotion_label', targets)
        .order('updated_at', { ascending: false })
        .limit(20);
      data = d1; error = e1;
      console.log(`[MateSearch] 互补模式 targets=${targets.join(',')}: ${data?.length || 0} 条`);
    }
    if (!data || data.length === 0) {
      const { data: d2, error: e2 } = await baseQuery()
        .order('updated_at', { ascending: false })
        .limit(20);
      data = d2; error = e2;
      console.log(`[MateSearch] 互补模式 回退全部: ${data?.length || 0} 条`);
    }
  } else {
    const result = await baseQuery()
      .order('updated_at', { ascending: false })
      .limit(20);
    data = result.data; error = result.error;
    console.log(`[MateSearch] ${mode}模式 全部用户: ${data?.length || 0} 条`);
  }

  if (error) {
    console.error(`[MateSearch] 错误:`, error);
    throw new Error(`searchMates: ${error.message}`);
  }
  console.log(`[MateSearch] 最终返回: ${(data || []).length} 条`);
  return (data || []) as MateProfile[];
}

/** 更新用户情绪标签（每次发送消息或记录情绪时调用） */
export async function updateProfileEmotion(
  userId: string,
  emotionLabel: string,
  moodTags?: string
): Promise<void> {
  const normalized = normalizeEmotion(emotionLabel) || emotionLabel;
  const { error } = await supabase
    .from('profiles')
    .update({
      emotion_label: normalized,
      mood_tags: moodTags || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) console.warn('[Supabase] updateProfileEmotion 失败:', error.message);
}

// ---- 工具 ----

/** 计算两个用户之间的共享频道 ID（双向一致，幂等） */
export function computeChannelId(userA: string, userB: string): string {
  return [userA, userB].sort().join('_');
}

// ---- 好友请求 ----

export interface FriendRequestRecord {
  id: number;
  from_user_id: string;
  to_user_id: string;
  message: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  // JOIN 来的字段
  from_username?: string;
  from_emotion_label?: string;
}

/** 发送好友申请 */
export async function sendFriendRequest(
  fromUserId: string,
  toUserId: string,
  message?: string
): Promise<void> {
  console.log('[Supabase] sendFriendRequest 发送中:', { fromUserId, toUserId, message });
  const { error } = await supabase
    .from('friend_requests')
    .upsert({
      from_user_id: fromUserId,
      to_user_id: toUserId,
      message: message || '',
      status: 'pending',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'from_user_id,to_user_id' });
  if (error) {
    console.error('[Supabase] sendFriendRequest 失败:', error);
    throw new Error(`sendFriendRequest: ${error.message} (code: ${error.code})`);
  }
  console.log('[Supabase] sendFriendRequest 成功');
}

/** 获取发给我的好友申请（含发送者信息） */
export async function getFriendRequests(userId: string): Promise<FriendRequestRecord[]> {
  const { data, error } = await supabase
    .from('friend_requests')
    .select('id, from_user_id, to_user_id, message, status, created_at')
    .eq('to_user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`getFriendRequests: ${error.message}`);
  if (!data || data.length === 0) return [];

  // 批量获取发送者信息
  const fromIds = [...new Set(data.map(r => r.from_user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, emotion_label')
    .in('id', fromIds);

  const profileMap = new Map<string, { username: string; emotion_label?: string }>();
  for (const p of (profiles || [])) {
    profileMap.set(p.id, { username: p.username, emotion_label: p.emotion_label });
  }

  return data.map((r: any) => ({
    ...r,
    from_username: profileMap.get(r.from_user_id)?.username,
    from_emotion_label: profileMap.get(r.from_user_id)?.emotion_label,
  }));
}

/** 响应好友申请（接受/拒绝） */
export async function respondFriendRequest(
  requestId: number,
  accept: boolean,
  fromUserId: string,
  toUserId: string
): Promise<{ channel_id: string } | void> {
  const status = accept ? 'accepted' : 'rejected';

  // 1. 更新申请状态
  const { error } = await supabase
    .from('friend_requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) throw new Error(`respondFriendRequest: ${error.message}`);
  if (!accept) return;

  // 2. 建立双向好友关系（共享 channel_id）
  const channelId = computeChannelId(fromUserId, toUserId);
  console.log('[Supabase] respondFriendRequest 建立好友:', { fromUserId, toUserId, channelId });

  const { error: e1 } = await supabase
    .from('friends')
    .upsert({ user_id: fromUserId, friend_id: toUserId, channel_id: channelId }, { onConflict: 'user_id,friend_id' });
  if (e1) throw new Error(`respondFriendRequest friends(1): ${e1.message}`);

  const { error: e2 } = await supabase
    .from('friends')
    .upsert({ user_id: toUserId, friend_id: fromUserId, channel_id: channelId }, { onConflict: 'user_id,friend_id' });
  if (e2) throw new Error(`respondFriendRequest friends(2): ${e2.message}`);

  return { channel_id: channelId };
}

// ---- 好友列表 ----

export interface FriendRecord {
  id: number;
  user_id: string;
  friend_id: string;
  channel_id: string;
  friend_username?: string;
  friend_emotion_label?: string;
  created_at: string;
}

/** 获取我的好友列表 */
export async function getFriends(userId: string): Promise<FriendRecord[]> {
  const { data, error } = await supabase
    .from('friends')
    .select('id, user_id, friend_id, channel_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`getFriends: ${error.message}`);
  if (!data || data.length === 0) return [];

  // 批量获取好友信息
  const friendIds = [...new Set(data.map(f => f.friend_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, emotion_label')
    .in('id', friendIds);

  const profileMap = new Map<string, { username: string; emotion_label?: string }>();
  for (const p of (profiles || [])) {
    profileMap.set(p.id, { username: p.username, emotion_label: p.emotion_label });
  }

  return data.map((f: any) => ({
    ...f,
    friend_username: profileMap.get(f.friend_id)?.username,
    friend_emotion_label: profileMap.get(f.friend_id)?.emotion_label,
  }));
}

/** 获取与某个好友的共享 channel_id */
export async function getFriendshipId(userId: string, friendId: string): Promise<string | null> {
  // 优先用计算值（无需网络请求，且兼容旧数据）
  const computed = computeChannelId(userId, friendId);
  // 验证该 channel 确实存在
  const { data, error } = await supabase
    .from('friends')
    .select('channel_id')
    .eq('user_id', userId)
    .eq('friend_id', friendId)
    .maybeSingle();
  if (error || !data) return null;
  return data.channel_id || computed;
}

// ---- 好友聊天 ----

export interface FriendMessageRecord {
  id: number;
  friendship_id: number;      // 旧字段保留兼容
  channel_id: string;         // 共享频道 ID
  sender_id: string;
  content: string;
  created_at: string;
}

/** 发送好友消息（通过 channel_id） */
export async function sendFriendMessage(
  channelId: string,
  senderId: string,
  content: string
): Promise<void> {
  const { error } = await supabase
    .from('friend_messages')
    .insert({
      channel_id: channelId,
      sender_id: senderId,
      content,
    });
  if (error) throw new Error(`sendFriendMessage: ${error.message}`);
}

/** 获取好友聊天记录（通过 channel_id） */
export async function getFriendMessages(channelId: string): Promise<FriendMessageRecord[]> {
  const { data, error } = await supabase
    .from('friend_messages')
    .select('*')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) throw new Error(`getFriendMessages: ${error.message}`);
  return (data || []) as FriendMessageRecord[];
}

// ============================================================
// 诊断
// ============================================================

/** 检查同步表是否存在并返回诊断信息 */
export async function checkSyncReady(userId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { error: e1 } = await supabase.from('conversations').select('id').limit(1);
    if (e1) {
      if ((e1 as any).code === '42P01') {
        return { ok: false, message: 'conversations 表不存在 — 请在 Supabase SQL Editor 中执行 supabase_migration.sql' };
      }
      return { ok: false, message: `conversations 表查询失败: ${e1.message}` };
    }

    const { error: e2 } = await supabase.from('chat_messages').select('id').limit(1);
    if (e2) {
      if ((e2 as any).code === '42P01') {
        return { ok: false, message: 'chat_messages 表不存在 — 请在 Supabase SQL Editor 中执行 supabase_migration.sql' };
      }
      return { ok: false, message: `chat_messages 表查询失败: ${e2.message}` };
    }

    return { ok: true, message: '同步就绪 ✓' };
  } catch (err: any) {
    return { ok: false, message: `诊断异常: ${err.message}` };
  }
}
