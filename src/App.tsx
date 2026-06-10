import React, { useEffect } from 'react';
import { useAppStore, usePetStore, useEmotionStore } from '@/store';
import { Titlebar } from '@/components/Titlebar';
import { Sidebar } from '@/components/Sidebar';
import { ChatPage } from '@/pages/ChatPage';
import { PetGarden } from '@/pages/PetGarden';
import { MateSpace } from '@/pages/MateSpace';
import { EmotionDashboard } from '@/pages/EmotionDashboard';
import { MemoryWall } from '@/pages/MemoryWall';
import { SettingsPage } from '@/pages/SettingsPage';

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

  useEffect(() => {
    initSession();
    usePetStore.getState().loadPet();
    useEmotionStore.getState().loadToday();
    useEmotionStore.getState().loadWeekly();
  }, []);

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
