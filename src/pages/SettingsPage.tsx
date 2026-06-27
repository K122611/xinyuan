import { useState } from 'react';
import { useAppStore } from '../store';

export default function SettingsPage() {
  const { settings, updateSettings } = useAppStore();
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    cozeToken: settings.cozeToken,
    cozeBotId: settings.cozeBotId,
    userName: settings.userName,
  });

  const handleSave = () => {
    updateSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="settings-page">
      <h2>⚙️ 设置</h2>

      {saved && <div className="settings-success">✅ 设置已保存</div>}

      <div className="settings-card">
        <h3>🤖 Coze AI 配置</h3>
        <div className="form-group">
          <label>API Token</label>
          <input
            type="password"
            value={form.cozeToken}
            onChange={(e) => setForm({ ...form, cozeToken: e.target.value })}
            placeholder="输入你的 Coze API Token"
          />
          <div className="form-hint">
            在 <a href="https://www.coze.cn" target="_blank" rel="noreferrer">coze.cn</a> 个人设置 → API Token 中获取
          </div>
        </div>
        <div className="form-group">
          <label>Bot ID</label>
          <input
            type="text"
            value={form.cozeBotId}
            onChange={(e) => setForm({ ...form, cozeBotId: e.target.value })}
            placeholder="输入你的 Bot ID"
          />
          <div className="form-hint">
            在 Coze Bot 发布页面可找到 Bot ID
          </div>
        </div>
      </div>

      <div className="settings-card">
        <h3>👤 个人设置</h3>
        <div className="form-group">
          <label>昵称</label>
          <input
            type="text"
            value={form.userName}
            onChange={(e) => setForm({ ...form, userName: e.target.value })}
            placeholder="你的名字"
          />
        </div>
      </div>

      <button className="settings-save-btn" onClick={handleSave}>
        保存设置
      </button>
    </div>
  );
}
