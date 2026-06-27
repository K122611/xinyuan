import { useState } from 'react';
import { useCozeConfigStore } from '@/store';

interface SetupPageProps {
  onComplete: () => void;
}

export function SetupPage({ onComplete }: SetupPageProps) {
  const { config, saveConfig } = useCozeConfigStore();
  const [token, setToken] = useState(config?.token || '');
  const [botId, setBotId] = useState(config?.botId || '');
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl || 'https://api.coze.cn/v3/chat');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // 检查是否从环境变量自动填充
  const hasEnvCreds = !!(import.meta.env.VITE_COZE_TOKEN && import.meta.env.VITE_COZE_BOT_ID);
  const [useEnv, setUseEnv] = useState(hasEnvCreds && !config);

  const handleSave = async () => {
    setError('');

    if (!token.trim()) {
      setError('请输入 Coze API Token');
      return;
    }
    if (!botId.trim()) {
      setError('请输入 Bot ID');
      return;
    }
    if (!baseUrl.trim()) {
      setError('请输入 API 地址');
      return;
    }

    setIsSaving(true);
    // 清洁输入：去除前后空格
    const cleanConfig = {
      token: token.trim(),
      botId: botId.trim(),
      baseUrl: baseUrl.trim().replace(/\/$/, ''), // 去掉末尾斜杠
    };

    saveConfig(cleanConfig);
    setIsSaving(false);
    onComplete();
  };

  const handleUseEnv = () => {
    const envToken = import.meta.env.VITE_COZE_TOKEN || '';
    const envBotId = import.meta.env.VITE_COZE_BOT_ID || '';
    const envBaseUrl = import.meta.env.VITE_COZE_BASE_URL || 'https://api.coze.cn/v3/chat';

    setToken(envToken);
    setBotId(envBotId);
    setBaseUrl(envBaseUrl.replace(/\/$/, ''));
    setUseEnv(true);
  };

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
      fontFamily: 'var(--font-sans)',
    }}>
      <div className="fade-in" style={{
        width: '100%',
        maxWidth: 440,
        padding: '0 24px',
      }}>
        {/* 标题 */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🌱</div>
          <h1 style={{
            fontSize: 26,
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: 4,
          }}>
            欢迎来到心元
          </h1>
          <p style={{
            fontSize: 14,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}>
            在开始之前，请配置你的 Coze API 凭据
            <br />
            让心元能够连接到你的专属 AI 伙伴
          </p>
        </div>

        {/* 环境变量快速填充 */}
        {hasEnvCreds && !useEnv && (
          <div
            onClick={handleUseEnv}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--accent-calm)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 16px',
              marginBottom: 20,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-card)';
            }}
          >
            <span style={{ fontSize: 18 }}>🔑</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                检测到 .env 配置文件
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                点击此处自动填充凭据
              </div>
            </div>
          </div>
        )}

        {/* 表单 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: 6,
            }}>
              API Token
            </label>
            <input
              className="input-field"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="输入你的 Coze API Token"
              style={{ fontFamily: 'monospace' }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: 6,
            }}>
              Bot ID
            </label>
            <input
              className="input-field"
              type="text"
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
              placeholder="输入你的 Coze Bot ID"
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: 6,
            }}>
              API 地址
            </label>
            <input
              className="input-field"
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.coze.cn/v3/chat"
            />
          </div>
        </div>

        {/* 错误信息 */}
        {error && (
          <div style={{
            marginTop: 16,
            padding: '10px 14px',
            background: 'rgba(224, 96, 96, 0.1)',
            border: '1px solid rgba(224, 96, 96, 0.3)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--accent-heart)',
            fontSize: 13,
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* 按钮 */}
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={isSaving}
          style={{
            marginTop: 24,
            width: '100%',
            padding: '14px 0',
            fontSize: 16,
            fontWeight: 600,
            borderRadius: 'var(--radius)',
            opacity: isSaving ? 0.7 : 1,
          }}
        >
          {isSaving ? '✨ 正在连接…' : '✨ 开始使用心元'}
        </button>

        {/* 底部提示 */}
        <p style={{
          marginTop: 20,
          textAlign: 'center',
          fontSize: 12,
          color: 'var(--text-muted)',
          lineHeight: 1.6,
        }}>
          凭据将安全保存在本地，不会上传到任何服务器<br />
          你可以在设置页面随时修改
        </p>
      </div>
    </div>
  );
}
