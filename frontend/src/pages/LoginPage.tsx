import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { obtainToken } from '../services/auth';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation() as any;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = location.state?.from?.pathname || '/tournaments';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await obtainToken(username, password);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Вход</h1>
      <form onSubmit={onSubmit} className="bg-white p-6 rounded-lg border border-gray-200 space-y-4">
        {error && (
          <div className="text-red-600 text-sm">{error}</div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Логин</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"
            placeholder="username"
            autoComplete="username"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Пароль</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2 rounded-lg disabled:opacity-60"
        >
          {loading ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </div>
  );
};
