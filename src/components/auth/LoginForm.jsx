import React, { useState } from 'react';
import { Eye, EyeOff, User, Lock, Train } from 'lucide-react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import { useAuthStore } from '../../store/authStore';

export default function LoginForm({ onSuccess }) {
  const { login } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }
    setIsLoading(true);
    try {
      const formattedUsername = username.trim().toLowerCase();
      // Auto-append dummy domain if user didn't type an email, since Supabase requires emails
      const loginEmail = formattedUsername.includes('@') ? formattedUsername : `${formattedUsername}@metro.local`;
      
      await login(loginEmail, password);
      onSuccess?.();
    } catch (err) {
      const msg = err?.message ?? 'Login failed. Please check your credentials.';
      setError(msg.includes('Invalid login') ? 'Invalid username or password.' : msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <div className="login-logo-icon" style={{ background: 'transparent', padding: 0 }}>
            <img src="/kmrl_logo.png" alt="KMRL Logo" style={{ width: '40px', height: '40px', objectFit: 'contain' }} />
          </div>
          <div>
            <div className="login-logo-title">Metro HK Portal</div>
            <div className="login-logo-sub">Housekeeping Inventory & Consumables</div>
          </div>
        </div>

        <p className="login-form-title">Sign in to your account</p>

        {error && (
          <Alert variant="danger" className="mb-4" style={{ marginBottom: 'var(--space-4)' }}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Username */}
          <div className="form-group">
            <label className="form-label form-label-required" htmlFor="login-username">
              Username
            </label>
            <div style={{ position: 'relative' }}>
              <User
                size={16}
                style={{
                  position: 'absolute', left: 12, top: '50%',
                  transform: 'translateY(-50%)', color: 'var(--color-gray-400)',
                  pointerEvents: 'none',
                }}
              />
              <input
                id="login-username"
                type="text"
                className="form-control"
                style={{ paddingLeft: 36 }}
                placeholder="e.g. sc_alva"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>
          </div>

          {/* Password */}
          <div className="form-group">
            <label className="form-label form-label-required" htmlFor="login-password">
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <Lock
                size={16}
                style={{
                  position: 'absolute', left: 12, top: '50%',
                  transform: 'translateY(-50%)', color: 'var(--color-gray-400)',
                  pointerEvents: 'none',
                }}
              />
              <input
                id="login-password"
                type={showPass ? 'text' : 'password'}
                className="form-control"
                style={{ paddingLeft: 36, paddingRight: 40 }}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPass((s) => !s)}
                style={{
                  position: 'absolute', right: 10, top: '50%',
                  transform: 'translateY(-50%)', background: 'none',
                  border: 'none', cursor: 'pointer', color: 'var(--color-gray-400)',
                  display: 'flex', padding: 4,
                }}
                aria-label={showPass ? 'Hide password' : 'Show password'}
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={isLoading}
            style={{ width: '100%', marginTop: 'var(--space-2)' }}
          >
            {isLoading ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>

        <p style={{
          textAlign: 'center', marginTop: 'var(--space-6)',
          fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-400)',
        }}>
          Contact your system administrator if you need access.
        </p>
      </div>
    </div>
  );
}
