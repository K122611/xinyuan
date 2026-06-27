import { create } from 'zustand';
import { supabase, signIn, signUp, signOut, onAuthStateChange, syncProfile } from '@/services/supabase';
import { injectAuthUserIdGetter } from '@/store';

interface AuthState {
  user: any | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  authError: string | null;
  username: string;

  // 初始化（从 Supabase 恢复 session）
  init: () => () => void;

  // 登录
  login: (email: string, password: string) => Promise<void>;

  // 注册
  register: (email: string, password: string, username?: string) => Promise<void>;

  // 登出
  logout: () => Promise<void>;

  // 清除错误
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  authError: null,
  username: '',

  init: () => {
    // 🔒 安全阀：5 秒后无论如何结束 loading，防止网络问题导致永久卡死
    const safetyTimer = setTimeout(() => {
      if (get().isLoading) {
        console.warn('[Auth] init 超时，强制结束 loading');
        set({ isLoading: false });
      }
    }, 5000);

    // 恢复并验证已有 session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        try {
          // 🔑 用 getUser() 向服务器验证 token 是否有效
          const { data: { user }, error } = await supabase.auth.getUser();
          if (user && !error) {
            const name = user.user_metadata?.username || '';
            clearTimeout(safetyTimer);
            set({
              user,
              username: name,
              isAuthenticated: true,
              isLoading: false,
            });
            // 恢复 session 后补写 profiles
            syncProfile(user.id, name || user.email?.split('@')[0] || 'unknown');
          } else {
            console.log('[Auth] 缓存 session 已失效，清除本地数据');
            await supabase.auth.signOut({ scope: 'local' });
            clearTimeout(safetyTimer);
            set({ isLoading: false });
          }
        } catch {
          console.log('[Auth] getUser 连接失败，清除本地缓存');
          await supabase.auth.signOut({ scope: 'local' });
          clearTimeout(safetyTimer);
          set({ isLoading: false });
        }
      } else {
        clearTimeout(safetyTimer);
        set({ isLoading: false });
      }
    }).catch(() => {
      // getSession 本身失败（极少见）
      clearTimeout(safetyTimer);
      set({ isLoading: false });
    });

    // 监听认证状态变化
    const { data: { subscription } } = onAuthStateChange((user) => {
      const name = user?.user_metadata?.username || '';
      set({
        user,
        username: name,
        isAuthenticated: !!user,
        isLoading: false,
      });
    });

    return () => {
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  },

  login: async (email, password) => {
    set({ authError: null, isLoading: true });
    try {
      const data = await signIn(email, password);
      const name = data.user?.user_metadata?.username || '';

      // 登录后补写 profiles
      if (data.user?.id) {
        syncProfile(data.user.id, name || data.user.email?.split('@')[0] || 'unknown');
      }

      set({
        user: data.user,
        username: name,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err: any) {
      set({
        authError: err.message || '登录失败',
        isLoading: false,
      });
    }
  },

  register: async (email, password, username) => {
    set({ authError: null, isLoading: true });
    try {
      // 先登出旧账号，确保 signUp 用新用户身份写 profile
      await supabase.auth.signOut();
      const data = await signUp(email, password, username);

      // 无论有无 session，都强制写入 profile
      if (data.user?.id && username) {
        syncProfile(data.user.id, username);
      }

      if (data.session) {
        set({
          user: data.user,
          username: username || '',
          isAuthenticated: true,
          isLoading: false,
        });
      } else if (data.user) {
        // 邮箱确认已开启 → 需要先确认邮箱
        set({
          isLoading: false,
          authError: '注册成功！请检查邮箱，点击确认链接后即可登录。登录后资料会自动同步。',
        });
      } else {
        // 未知情况
        set({
          isLoading: false,
          authError: '注册异常，请稍后重试',
        });
      }
    } catch (err: any) {
      set({
        authError: err.message || '注册失败',
        isLoading: false,
      });
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await signOut();
    } catch { /* 忽略 */ }

    // 关闭桌宠窗口
    try {
      (window as any).petAPI?.hidePet();
    } catch { /* 忽略 */ }

    set({
      user: null,
      username: '',
      isAuthenticated: false,
      isLoading: false,
    });
  },

  clearError: () => set({ authError: null }),
}));

// 注入用户ID获取器，使所有本地存储按用户隔离
injectAuthUserIdGetter(() => useAuthStore.getState().user?.id || 'anonymous');
