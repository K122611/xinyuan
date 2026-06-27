import { useState } from 'react';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';
import { useAppStore } from './store';

type Page = 'chat' | 'settings';

export default function App() {
  const [page, setPage] = useState<Page>('chat');
  const { settings, loadFromLocal } = useAppStore();

  // 首次加载从 localStorage 恢复
  useState(() => {
    loadFromLocal();
  });

  const needsSetup = !settings.cozeToken || !settings.cozeBotId;

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="app-title" onClick={() => setPage('chat')}>
          <span className="logo">💗</span>
          <h1>心元 EMO-Mate</h1>
        </div>
        <nav className="app-nav">
          <button
            className={`nav-btn ${page === 'chat' ? 'active' : ''}`}
            onClick={() => setPage('chat')}
          >
            对话
          </button>
          <button
            className={`nav-btn ${page === 'settings' ? 'active' : ''}`}
            onClick={() => setPage('settings')}
          >
            设置
            {needsSetup && <span className="setup-dot" />}
          </button>
        </nav>
      </header>
      <main className="app-main">
        {page === 'chat' ? <ChatPage /> : <SettingsPage />}
      </main>
    </div>
  );
}
