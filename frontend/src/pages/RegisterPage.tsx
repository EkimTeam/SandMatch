import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';
import { obtainToken } from '../services/auth';
import { useAuth } from '../context/AuthContext';

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { refreshMe } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // простая валидация email по формату, если указан
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        setError('Некорректный email. Укажите адрес в формате name@example.com');
        return;
      }
    }

    // требования к паролю: минимум 8 символов, хотя бы одна маленькая, одна большая буква и одна цифра
    const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordPattern.test(password)) {
      setError('Пароль должен содержать минимум 8 символов, хотя бы одну строчную, одну заглавную букву и одну цифру.');
      return;
    }

    if (password !== password2) {
      setError('Пароли не совпадают. Повторите ввод.');
      return;
    }

    setLoading(true);
    try {
      await authApi.register({
        username,
        password,
        email: email || undefined,
        first_name: firstName || undefined,
        last_name: lastName || undefined,
      });
      // сразу логиним пользователя
      await obtainToken(username, password);
      await refreshMe();
      navigate('/tournaments', { replace: true });
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'Ошибка регистрации';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Регистрация</h1>
      <form onSubmit={onSubmit} className="bg-white p-6 rounded-lg border border-gray-200 space-y-4">
        {error && <div className="text-red-600 text-sm">{error}</div>}
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
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
            <span>Пароль</span>
            <button
              type="button"
              className="text-xs text-gray-500 border border-gray-300 rounded-full w-5 h-5 flex items-center justify-center"
              title="Минимум 8 символов, хотя бы одна строчная буква, одна заглавная буква и одна цифра"
            >
              ?
            </button>
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-16 focus:outline-none focus:ring-2 focus:ring-primary-200"
              placeholder="••••••••"
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute inset-y-0 right-2 px-2 text-xs text-gray-600 hover:text-gray-800"
            >
              {showPassword ? 'Скрыть' : 'Показать'}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ввести пароль еще раз</label>
          <input
            type={showPassword ? 'text' : 'password'}
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"
            placeholder="you@example.com"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Имя</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"
              placeholder="Имя"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Фамилия</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"
              placeholder="Фамилия"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2 rounded-lg disabled:opacity-60"
        >
          {loading ? 'Регистрируем…' : 'Зарегистрироваться'}
        </button>
      </form>
    </div>
  );
};
