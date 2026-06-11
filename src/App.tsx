import React, { useEffect, useState } from 'react';
import { useAppStore, usePetStore, useEmotionStore } from '@/store';
import { Titlebar } from '@/components/Titlebar';
import { Sidebar } from '@/components/Sidebar';
import { ChatPage } from '@/pages/ChatPage';
import { PetGarden } from '@/pages/PetGarden';
import { MateSpace } from '@/pages/MateSpace';
import { EmotionDashboard } from '@/pages/EmotionDashboard';
import { MemoryWall } from '@/pages/MemoryWall';
import { SettingsPage } from '@/pages/SettingsPage';
import FloatingPetPage from '@/pages/FloatingPetPage';

const pages: Record<string, React.FC> = {
  chat: ChatPage,
  pet: PetGarden,
  mate: MateSpace,
  emotion: EmotionDashboard,
  memory: MemoryWall,
  settings: SettingsPage,
};

export default function App() {
  const currentPage = useAppStore((s) => s.currentPage);
  const initSession = useAppStore((s) => s.initSession);
  const setIsElectron = useAppStore((s) => s.setIsElectron);
  const [showFloatingPet, setShowFloatingPet] = useState(false);

  useEffect(() => {
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

    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

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
