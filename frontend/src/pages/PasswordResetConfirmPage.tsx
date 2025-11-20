import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../services/api';

export const PasswordResetConfirmPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [uid, setUid] = useState<string>(searchParams.get('uid') || '');
  const [token, setToken] = useState<string>(searchParams.get('token') || '');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (password !== password2) {
      setError('Пароли не совпадают');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.resetPasswordConfirm({ uid, token, new_password: password });
      setSuccess(res.detail || 'Пароль успешно изменён. Сейчас вы будете перенаправлены на страницу входа.');
      setTimeout(() => navigate('/login'), 2000);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'Ошибка при смене пароля';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Установка нового пароля</h1>
      <form onSubmit={onSubmit} className="bg-white p-6 rounded-lg border border-gray-200 space-y-4">
        {error && (
          <div className="text-red-700 text-sm bg-red-50 border border-red-200 px-3 py-2 rounded">
            <div className="font-medium mb-1">Не удалось изменить пароль</div>
            <div>{error}</div>
            {error.toLowerCase().includes('токен') || error.toLowerCase().includes('ссылк') ? (
              <div className="mt-2 text-xs text-red-600">
                Ссылка для сброса могла устареть или уже быть использованной. Попробуйте запросить
                восстановление пароля ещё раз на странице
                {' '}
                <button
                  type="button"
                  className="underline text-red-700"
                  onClick={() => navigate('/reset-password')}
                >
                  "Восстановление пароля".
                </button>
              </div>
            ) : null}
          </div>
        )}
        {success && (
          <div className="text-green-700 text-sm bg-green-50 border border-green-200 px-3 py-2 rounded">
            {success}
            <div className="mt-1 text-xs text-green-700">
              Если вас не перенаправило автоматически, вы можете
              {' '}
              <button
                type="button"
                className="underline"
                onClick={() => navigate('/login')}
              >
                перейти на страницу входа
              </button>.
            </div>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">UID</label>
          <input
            type="text"
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Token</label>
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Новый пароль</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Подтверждение пароля</label>
          <input
            type="password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2 rounded-lg disabled:opacity-60"
        >
          {loading ? 'Сохраняем…' : 'Сохранить пароль'}
        </button>
      </form>
    </div>
  );
};
