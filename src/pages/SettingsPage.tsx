import React, { useEffect, useState } from 'react';
import { useAppStore, usePersonaStore, usePetStore, useCozeConfigStore } from '@/store';

export function SettingsPage() {
  const userNickname = useAppStore((s) => s.userNickname);
  const setUserNickname = useAppStore((s) => s.setUserNickname);
  const { params, loadParams } = usePersonaStore();
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const { config: cozeConfig, saveConfig, clearConfig } = useCozeConfigStore();

  const [nicknameInput, setNicknameInput] = useState(userNickname);
  const [showPersonaEditor, setShowPersonaEditor] = useState(false);
  const [showApiEditor, setShowApiEditor] = useState(false);
  const [apiToken, setApiToken] = useState(cozeConfig?.token || '');
  const [apiBotId, setApiBotId] = useState(cozeConfig?.botId || '');
  const [apiBaseUrl, setApiBaseUrl] = useState(cozeConfig?.baseUrl || 'https://api.coze.cn/v3/chat');
  const [apiError, setApiError] = useState('');
  const [apiSaved, setApiSaved] = useState(false);

  useEffect(() => {
    loadParams();
    setNicknameInput(userNickname);
    setApiToken(cozeConfig?.token || '');
    setApiBotId(cozeConfig?.botId || '');
    setApiBaseUrl(cozeConfig?.baseUrl || 'https://api.coze.cn/v3/chat');
  }, [userNickname, cozeConfig]);

  const handleSaveApiConfig = () => {
    setApiError('');
    setApiSaved(false);
    if (!apiToken.trim()) { setApiError('请输入 Token'); return; }
    if (!apiBotId.trim()) { setApiError('请输入 Bot ID'); return; }
    saveConfig({
      token: apiToken.trim(),
      botId: apiBotId.trim(),
      baseUrl: apiBaseUrl.trim().replace(/\/$/, ''),
    });
    setApiSaved(true);
    setTimeout(() => setApiSaved(false), 2500);
  };

  useEffect(() => {
    loadParams();
    setNicknameInput(userNickname);
  }, [userNickname]);

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 20 }}>⚙️ 设置</h2>

      {/* 个人信息 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">👤 个人信息</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            className="input-field"
            value={nicknameInput}
            onChange={(e) => setNicknameInput(e.target.value)}
            placeholder="你的昵称"
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" onClick={() => setUserNickname(nicknameInput)}>
            保存
          </button>
        </div>
      </div>

      {/* Coze API 配置 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>🔑 Coze API 配置</span>
          <button
            className="btn btn-secondary"
            style={{ padding: '4px 12px', fontSize: 12 }}
            onClick={() => setShowApiEditor(!showApiEditor)}
          >
            {showApiEditor ? '收起' : cozeConfig ? '修改' : '配置'}
          </button>
        </div>
        {showApiEditor ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                API Token
              </label>
              <input
                className="input-field"
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="Coze API Token"
                style={{ fontFamily: 'monospace' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Bot ID
              </label>
              <input
                className="input-field"
                value={apiBotId}
                onChange={(e) => setApiBotId(e.target.value)}
                placeholder="Coze Bot ID"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                API 地址
              </label>
              <input
                className="input-field"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                placeholder="https://api.coze.cn/v3/chat"
              />
            </div>
            {apiError && (
              <div style={{ fontSize: 12, color: 'var(--accent-heart)', padding: '6px 10px', background: 'rgba(224,96,96,0.1)', borderRadius: 6 }}>
                ⚠️ {apiError}
              </div>
            )}
            {apiSaved && (
              <div style={{ fontSize: 12, color: 'var(--accent-leaf)', padding: '6px 10px', background: 'rgba(126,202,152,0.1)', borderRadius: 6 }}>
                ✅ 配置已保存
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={handleSaveApiConfig}>保存配置</button>
              {cozeConfig && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    if (confirm('确定要清除 API 配置吗？清除后需重新配置才能使用心元。')) {
                      clearConfig();
                      setShowApiEditor(true);
                    }
                  }}
                >
                  清除配置
                </button>
              )}
            </div>
          </div>
        ) : (
          <div>
            {cozeConfig ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', background: 'var(--bg-tertiary)', borderRadius: 6, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Token</span>
                  <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>
                    {cozeConfig.token.slice(0, 6)}…{cozeConfig.token.slice(-4)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', background: 'var(--bg-tertiary)', borderRadius: 6, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Bot ID</span>
                  <span style={{ fontWeight: 600 }}>{cozeConfig.botId}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', background: 'var(--bg-tertiary)', borderRadius: 6, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>API 地址</span>
                  <span style={{ fontWeight: 600 }}>{cozeConfig.baseUrl}</span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                尚未配置。点击"配置"添加你的 Coze API 凭据。
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI人格参数 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>🤖 AI人格参数</span>
          <button
            className="btn btn-secondary"
            style={{ padding: '4px 12px', fontSize: 12 }}
            onClick={() => setShowPersonaEditor(!showPersonaEditor)}
          >
            {showPersonaEditor ? '收起' : '调整'}
          </button>
        </div>
        {showPersonaEditor ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {Object.entries(params).map(([name, value]) => (
              <div key={name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13 }}>{name}</span>
                  <span style={{ fontSize: 13, color: 'var(--accent-warm)', fontWeight: 600 }}>
                    {Number(value).toFixed(1)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="0.1"
                    value={Number(value)}
                    onChange={async (e) => {
                      const newVal = parseFloat(e.target.value);
                      usePersonaStore.getState().updateParam(name, newVal);
                    }}
                    style={{ flex: 1, accentColor: 'var(--accent-warm)' }}
                  />
                </div>
              </div>
            ))}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              💡 调整AI的性格参数会影响心元对你的回应风格。这些参数也会根据你的互动自动进化。
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {Object.entries(params).slice(0, 6).map(([name, value]) => (
              <div key={name} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '8px 12px', background: 'var(--bg-tertiary)',
                borderRadius: 6, fontSize: 13,
              }}>
                <span style={{ color: 'var(--text-secondary)' }}>{name}</span>
                <span style={{ fontWeight: 600 }}>{Number(value).toFixed(1)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 隐私设置 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">🔒 隐私与安全</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { label: '搭子对话端到端加密', desc: '搭子间的消息仅存储在本地', value: true },
            { label: '隐私优先模式', desc: '情绪分析优先使用本地模型', value: true },
            { label: '使用数据匿名化', desc: '上报数据不包含个人标识', value: true },
          ].map((item) => (
            <div key={item.label} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 14px', background: 'var(--bg-tertiary)', borderRadius: 8,
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.desc}</div>
              </div>
              <div style={{
                width: 40, height: 22, borderRadius: 11,
                background: item.value ? 'var(--accent-leaf)' : 'var(--bg-hover)',
                position: 'relative', cursor: 'pointer',
              }}>
                <div style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute', top: 2,
                  left: item.value ? 20 : 2,
                  transition: 'left 0.2s',
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 家长监护 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">👨‍👩‍👧 家长监护</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
          面向未成年用户的安全与合规设计
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: '安全风险提醒', desc: '检测到持续情绪低落后向监护人发送脱敏通知' },
            { label: '使用时长限制', desc: '监护人可设置每日使用上限' },
            { label: '危机升级通知', desc: '触发红色危机时同步通知监护人' },
          ].map((item) => (
            <div key={item.label} style={{
              padding: '8px 14px', background: 'var(--bg-tertiary)', borderRadius: 6,
            }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{item.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.desc}</div>
            </div>
          ))}
          <button className="btn btn-secondary" style={{ marginTop: 4 }}>设置监护人</button>
        </div>
      </div>

      {/* 关于 */}
      <div className="card">
        <div className="card-header">ℹ️ 关于</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
          <div>心元 EMO-Mate v1.0.0</div>
          <div style={{ color: 'var(--text-muted)' }}>
            有温度的AI情感陪伴助手<br />
            不是给你答案，而是陪你找答案
          </div>
        </div>
      </div>
    </div>
  );
}
