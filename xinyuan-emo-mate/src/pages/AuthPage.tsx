import React, { useState } from 'react';
import { useAuthStore } from '@/store/authStore';

type Mode = 'login' | 'register';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');

  const { login, register, isLoading, authError, clearError } = useAuthStore();

  const switchMode = () => {
    clearError();
    setLocalError('');
    setMode(mode === 'login' ? 'register' : 'login');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');

    // 用户名校验
    if (mode === 'register' && !username.trim()) {
      setLocalError('请输入用户名');
      return;
    }

    // 邮箱校验
    if (!email.trim()) {
      setLocalError('请输入邮箱');
      return;
    }
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email.trim())) {
      setLocalError('邮箱格式不正确（如: user@example.com）');
      return;
    }

    if (!password.trim()) {
      setLocalError('请输入密码');
      return;
    }

    if (mode === 'register' && password !== confirmPassword) {
      setLocalError('两次密码输入不一致');
      return;
    }

    if (password.length < 6) {
      setLocalError('密码至少需要6个字符');
      return;
    }

    if (mode === 'login') {
      await login(email.trim(), password);
    } else {
      await register(email.trim(), password, username.trim());
    }
  };

  const displayError = localError || authError;

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
        maxWidth: 400,
        padding: '0 24px',
      }}>
        {/* 标题 */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>💙</div>
          <h1 style={{
            fontSize: 26,
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: 4,
          }}>
            心元 EMO-Mate
          </h1>
          <p style={{
            fontSize: 14,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}>
            {mode === 'login' ? '登录你的账号，继续和心元聊天' : '注册账号，开始你的情感陪伴之旅'}
          </p>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {mode === 'register' && (
            <div>
              <label style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: 6,
              }}>
                用户名
              </label>
              <input
                className="input-field"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="你的昵称"
                autoFocus
              />
            </div>
          )}

          <div>
            <label style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: 6,
            }}>
              邮箱
            </label>
            <input
              className="input-field"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              autoFocus={mode === 'login'}
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
              密码
            </label>
            <input
              className="input-field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少6位字符"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: 6,
              }}>
                确认密码
              </label>
              <input
                className="input-field"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入密码"
              />
            </div>
          )}

          {/* 错误信息 */}
          {displayError && (
            <div style={{
              padding: '10px 14px',
              background: 'rgba(224, 96, 96, 0.1)',
              border: '1px solid rgba(224, 96, 96, 0.3)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--accent-heart)',
              fontSize: 13,
            }}>
              {displayError}
            </div>
          )}

          {/* 提交按钮 */}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={isLoading}
            style={{
              width: '100%',
              padding: '14px 0',
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 'var(--radius)',
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isLoading ? '处理中…' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        {/* 切换模式 */}
        <p style={{
          marginTop: 20,
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--text-muted)',
        }}>
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <span
            onClick={switchMode}
            style={{
              color: 'var(--accent-warm)',
              cursor: 'pointer',
              fontWeight: 600,
              marginLeft: 4,
            }}
          >
            {mode === 'login' ? '去注册' : '去登录'}
          </span>
        </p>
      </div>
    </div>
  );
}
