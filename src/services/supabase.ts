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
  console.log('[Supabase] syncProfile:', { id: userId, username });
  try {
    // 先检查是否已有记录
    const { data: existing } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
    console.log('[Supabase] 检查已有记录:', existing ? '存在' : '不存在');

    if (existing) {
      // UPDATE 已有记录
      const { error } = await supabase
        .from('profiles')
        .update({ username, updated_at: new Date().toISOString() })
        .eq('id', userId);
      if (error) console.warn('[Supabase] profiles UPDATE 失败:', error.message, '(code:', (error as any).code, ')');
      else console.log('[Supabase] profiles UPDATE 成功');
    } else {
      // INSERT 新记录
      const { error } = await supabase
        .from('profiles')
        .insert({ id: userId, username, updated_at: new Date().toISOString() });
      if (error) console.warn('[Supabase] profiles INSERT 失败:', error.message, '(code:', (error as any).code, ')');
      else console.log('[Supabase] profiles INSERT 成功');
    }
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

  // 注册后写入 profiles：必须等有 session 才能通过 RLS 校验
  if (data.user && username) {
    if (!data.session) {
      console.warn('[Supabase] 注册后无 session（邮件确认开启），profiles 写入推迟到首次登录');
    } else {
      console.log('[Supabase] 写入 profiles:', { id: data.user.id, username });
      try {
        const { error: profileError } = await supabase.from('profiles').upsert(
          { id: data.user.id, username, updated_at: new Date().toISOString() },
          { onConflict: 'id' }
        );
        if (profileError) console.warn('[Supabase] profiles 写入失败:', profileError.message);
        else console.log('[Supabase] profiles 写入成功');
      } catch (err) {
        console.error('[Supabase] profiles upsert 异常:', err);
      }
    }
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
