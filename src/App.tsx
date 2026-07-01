import React, { useEffect, useState } from 'react';
import { useAppStore, usePetStore, useEmotionStore } from '@/store';
import { useAuthStore } from '@/store/authStore';
import { Titlebar } from '@/components/Titlebar';
import { Sidebar } from '@/components/Sidebar';
import { ChatPage } from '@/pages/ChatPage';
import { PetGarden } from '@/pages/PetGarden';
import { MateSpace } from '@/pages/MateSpace';
import { EmotionDashboard } from '@/pages/EmotionDashboard';
import { MemoryWall } from '@/pages/MemoryWall';
import { SettingsPage } from '@/pages/SettingsPage';
import FloatingPetPage from '@/pages/FloatingPetPage';
import AuthPage from '@/pages/AuthPage';
import XiaozhiPanel from '@/components/XiaozhiPanel';

const pages: Record<string, React.FC> = {
  chat: ChatPage,
  pet: PetGarden,
  mate: MateSpace,
  emotion: EmotionDashboard,
  memory: MemoryWall,
  settings: SettingsPage,
  xiaozhi: XiaozhiPanel,
};

export default function App() {
  const currentPage = useAppStore((s) => s.currentPage);
  const initSession = useAppStore((s) => s.initSession);
  const setIsElectron = useAppStore((s) => s.setIsElectron);
  const [showFloatingPet, setShowFloatingPet] = useState(false);

  // ============ 认证守卫 ============
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authLoading = useAuthStore((s) => s.isLoading);
  const authInit = useAuthStore((s) => s.init);

  useEffect(() => {
    const unsubscribe = authInit();
    return () => unsubscribe();
  }, [authInit]);

  // ============ 应用初始化 ============
  useEffect(() => {
    if (!isAuthenticated) return;
    // 检测 Electron 环境
    if (typeof window !== 'undefined' && (window as any).electronAPI?.isElectron) {
      setIsElectron(true);
    }

    // 处理 Hash 路由（宠物悬浮窗通过 hash 加载）
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash === '#/floating-pet') {
        setShowFloatingPet(true);
        // Electron 环境下通知主进程这是宠物窗口
        if ((window as any).electronAPI?.isElectron) {
          document.documentElement.classList.add('floating-pet-window');
          document.body.classList.add('floating-pet-window');
          document.getElementById('root')?.classList.add('floating-pet-window');
          const appEl = document.querySelector('.app');
          if (appEl) appEl.classList.add('floating-pet-container');
        }
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);

    initSession();
    usePetStore.getState().loadPet();
    useEmotionStore.getState().loadToday();
    useEmotionStore.getState().loadWeekly();

    // 认证完成后，主窗口通知主进程创建桌宠悬浮窗
    if ((window as any).petAPI?.showPet) {
      setTimeout(() => (window as any).petAPI.showPet(), 500);
    }

    return () => window.removeEventListener('hashchange', handleHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, setIsElectron, initSession]);

  // ============ 渲染 ============

  // 正在检查认证状态 → 全屏加载
  if (authLoading) {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-primary)',
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }} className="pulse">💙</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>加载中…</div>
      </div>
    );
  }

  // 未认证 → 显示登录/注册页
  if (!isAuthenticated) {
    return <AuthPage />;
  }

  // 宠物悬浮窗：独立渲染，无Titlebar/Sidebar
  if (showFloatingPet) {
    return <FloatingPetPage />;
  }

  const PageComponent = pages[currentPage] || ChatPage;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Titlebar />
      <div className="app-layout">
        <Sidebar />
        <div className="main-content">
          <PageComponent />
        </div>
      </div>
    </div>
  );
}
