import React, { useState } from 'react';
import { authApi } from '../services/api';

export const PasswordResetRequestPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<{ uid?: string; token?: string } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    setDevToken(null);
    try {
      const res = await authApi.requestPasswordReset(email);
      setSuccess(res.detail || 'Если такой email существует, инструкции отправлены');
      if (res.uid && res.token) {
        setDevToken({ uid: res.uid, token: res.token });
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка запроса сброса пароля');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Восстановление пароля</h1>
      <form onSubmit={onSubmit} className="bg-white p-6 rounded-lg border border-gray-200 space-y-4">
        {error && <div className="text-red-600 text-sm">{error}</div>}
        {success && <div className="text-green-700 text-sm">{success}</div>}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"
            placeholder="you@example.com"
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2 rounded-lg disabled:opacity-60"
        >
          {loading ? 'Отправляем…' : 'Отправить ссылку для сброса'}
        </button>
        {devToken && (
          <div className="text-xs text-gray-600 border-t pt-3 mt-3">
            <div className="font-semibold mb-1">Dev-информация (в проде будет письмо):</div>
            <div>uid: <code>{devToken.uid}</code></div>
            <div>token: <code>{devToken.token}</code></div>
          </div>
        )}
      </form>
    </div>
  );
};
