import React, { useState, useEffect } from 'react';
import { profileApi, telegramApi, UserProfile, UpdateProfileData, ChangePasswordData, TelegramStatus, PlayerSearchResult, PlayerCandidate } from '../services/api';

// Уровни игры от слабого к сильному
const GAME_LEVELS = [
  { value: '', label: 'Не указан' },
  { value: 'beginner', label: 'Новичок' },
  { value: 'amateur', label: 'Любитель' },
  { value: 'intermediate', label: 'Средний' },
  { value: 'advanced', label: 'Продвинутый' },
  { value: 'expert', label: 'Эксперт' },
  { value: 'master', label: 'Мастер' },
  { value: 'pro', label: 'Профессионал' },
];

const ProfilePage: React.FC = () => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Форма редактирования
  const [formData, setFormData] = useState<UpdateProfileData>({});
  
  // Форма смены пароля
  const [passwordData, setPasswordData] = useState<ChangePasswordData>({
    old_password: '',
    new_password: '',
    new_password_confirm: '',
  });
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  
  // Telegram
  const [generatingCode, setGeneratingCode] = useState(false);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  
  // Player search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlayerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showPlayerSearch, setShowPlayerSearch] = useState(false);

  // Автокандидаты игрока по ФИО пользователя
  const [playerCandidates, setPlayerCandidates] = useState<PlayerCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  useEffect(() => {
    loadProfile();
    loadTelegramStatus();
    loadPlayerCandidates();
  }, []);

  // Дебаунсированный автопоиск при вводе
  useEffect(() => {
    if (!showPlayerSearch) return;
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(() => {
      handleSearchPlayers();
    }, 400);
    return () => clearTimeout(t);
  }, [searchQuery, showPlayerSearch]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const data = await profileApi.getProfile();
      setProfile(data);
      
      // Инициализируем форму
      setFormData({
        email: data.email,
        first_name: data.first_name,
        last_name: data.last_name,
        patronymic: data.player?.patronymic || '',
        birth_date: data.player?.birth_date || '',
        gender: data.player?.gender || undefined,
        phone: data.player?.phone || '',
        display_name: data.player?.display_name || '',
        city: data.player?.city || '',
        level: data.player?.level || '',
      });
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Ошибка загрузки профиля');
    } finally {
      setLoading(false);
    }
  };

  const loadPlayerCandidates = async () => {
    try {
      setLoadingCandidates(true);
      const { candidates } = await profileApi.getPlayerCandidates();
      setPlayerCandidates(candidates);
    } catch (err) {
      console.error('Ошибка загрузки кандидатов игрока:', err);
    } finally {
      setLoadingCandidates(false);
    }
  };

  const loadTelegramStatus = async () => {
    try {
      const status = await telegramApi.getStatus();
      setTelegramStatus(status);
      
      // Если есть pending код, показываем его
      if (status.pending_code) {
        setLinkCode(status.pending_code.code);
      }
    } catch (err) {
      console.error('Ошибка загрузки статуса Telegram:', err);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    // Не отправляем пустую дату рождения на сервер, чтобы избежать ошибки валидации
    const payload: UpdateProfileData = { ...formData };
    if (!payload.birth_date) {
      delete (payload as any).birth_date;
    }

    try {
      const updated = await profileApi.updateProfile(payload);
      setProfile(updated);
      setSuccess('Профиль успешно обновлён');
      
      // Перезагружаем кандидатов и статус Telegram после обновления профиля
      await loadPlayerCandidates();
      await loadTelegramStatus();
    } catch (err: any) {
      const data = err.response?.data;
      // Пытаемся вытащить понятное сообщение об ошибке
      const firstValue = data && (Object.values(data)[0] as any);
      const detail =
        (typeof data === 'string' && data) ||
        data?.detail ||
        (Array.isArray(firstValue) ? firstValue[0] : firstValue) ||
        'Ошибка сохранения профиля';
      setError(String(detail));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await profileApi.changePassword(passwordData);
      setSuccess('Пароль успешно изменён');
      setPasswordData({
        old_password: '',
        new_password: '',
        new_password_confirm: '',
      });
      setShowPasswordForm(false);
    } catch (err: any) {
      const errorData = err.response?.data;
      if (errorData?.old_password) {
        setError(errorData.old_password[0]);
      } else if (errorData?.new_password) {
        setError(errorData.new_password[0]);
      } else if (errorData?.new_password_confirm) {
        setError(errorData.new_password_confirm[0]);
      } else {
        setError(errorData?.detail || 'Ошибка смены пароля');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateTelegramCode = async () => {
    setGeneratingCode(true);
    setError(null);

    try {
      const codeData = await telegramApi.generateCode();
      setLinkCode(codeData.code);
      await loadTelegramStatus();
      setSuccess('Код сгенерирован! Отправь его боту');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка генерации кода');
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleUnlinkTelegram = async () => {
    if (!confirm('Вы уверены, что хотите отвязать Telegram?')) {
      return;
    }

    try {
      await telegramApi.unlink();
      await loadTelegramStatus();
      setSuccess('Telegram успешно отвязан');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка отвязки Telegram');
    }
  };

  const handleSearchPlayers = async () => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const { players } = await profileApi.searchPlayers(searchQuery);
      setSearchResults(players);
    } catch (err) {
      console.error('Ошибка поиска игроков:', err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleLinkPlayer = async (playerId: number) => {
    setSaving(true);
    setError(null);

    try {
      const updated = await profileApi.linkPlayer(playerId);
      setProfile(updated);
      setSuccess('Профиль успешно связан с игроком');
      // Пробрасываем player-поля в форму
      if (updated.player) {
        setFormData((prev) => ({
          ...prev,
          patronymic: updated.player?.patronymic || '',
          birth_date: updated.player?.birth_date || '',
          gender: (updated.player?.gender as any) || undefined,
          phone: updated.player?.phone || '',
          display_name: updated.player?.display_name || '',
          city: updated.player?.city || '',
          level: updated.player?.level || '',
        }));
      }
      setShowPlayerSearch(false);
      setSearchQuery('');
      setSearchResults([]);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Ошибка связывания с игроком');
    } finally {
      setSaving(false);
    }
  };

  const handleUnlinkPlayer = async () => {
    if (!confirm('Отвязать профиль игрока?')) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await profileApi.unlinkPlayer();
      setProfile(updated);
      setSuccess('Связь с игроком успешно удалена');
      // Очищаем Player-поля формы
      setFormData((prev) => ({
        ...prev,
        patronymic: '',
        birth_date: '',
        gender: undefined,
        phone: '',
        display_name: '',
        city: '',
        level: '',
      }));
      // После отвязки — показать новых кандидатов
      await loadPlayerCandidates();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Ошибка отвязки игрока');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-xl">Загрузка...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-xl text-red-600">Ошибка загрузки профиля</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Личный кабинет</h1>

      {/* Сообщения */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
          {success}
        </div>
      )}

      {/* Основная информация */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-semibold mb-4">Основная информация</h2>
        <form onSubmit={handleSaveProfile}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Username (read-only) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Логин
              </label>
              <input
                type="text"
                value={profile.username}
                disabled
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 cursor-not-allowed"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                name="email"
                value={formData.email || ''}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Имя */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Имя
              </label>
              <input
                type="text"
                name="first_name"
                value={formData.first_name || ''}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Фамилия */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Фамилия
              </label>
              <input
                type="text"
                name="last_name"
                value={formData.last_name || ''}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Поля игрока показываем только если есть связанный Player */}
            {profile.player && (
              <>
                {/* Отчество */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Отчество
                  </label>
                  <input
                    type="text"
                    name="patronymic"
                    value={formData.patronymic || ''}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  />
                </div>

            {/* Телефон */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Телефон
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone || ''}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Город */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Город
              </label>
              <input
                type="text"
                name="city"
                value={formData.city || ''}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Дата рождения */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Дата рождения
              </label>
              <input
                type="date"
                name="birth_date"
                value={formData.birth_date || ''}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Пол */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Пол
              </label>
              <select
                name="gender"
                value={formData.gender || ''}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Не указан</option>
                <option value="male">Мужской</option>
                <option value="female">Женский</option>
              </select>
            </div>

            {/* Отображаемое имя */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Отображаемое имя
              </label>
              <input
                type="text"
                name="display_name"
                value={formData.display_name || ''}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Уровень */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Уровень игры
              </label>
              <select
                name="level"
                value={formData.level || ''}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              >
                {GAME_LEVELS.map(level => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </select>
            </div>

                {/* Рейтинг (read-only) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Текущий рейтинг
                  </label>
                  <input
                    type="number"
                    value={profile.player.current_rating}
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 cursor-not-allowed"
                  />
                </div>
              </>
            )}
          </div>

          <div className="mt-6">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {saving ? 'Сохранение...' : 'Сохранить изменения'}
            </button>
          </div>
        </form>
      </div>

      {/* Связывание с игроком */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-semibold mb-4">Связь с профилем игрока</h2>
        
        {profile.player ? (
          <div>
            <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-4">
              <p className="text-green-800 font-medium mb-2">
                ✅ Профиль связан с игроком
              </p>
              <div className="text-sm text-gray-700">
                <p><strong>Имя:</strong> {profile.player.first_name} {profile.player.last_name}</p>
                {profile.player.patronymic && <p><strong>Отчество:</strong> {profile.player.patronymic}</p>}
                {profile.player.city && <p><strong>Город:</strong> {profile.player.city}</p>}
                <p><strong>Рейтинг:</strong> {profile.player.current_rating}</p>
                {profile.player.is_profi && (
                  <p className="text-blue-600 font-medium mt-2">🏆 Профессиональный игрок (BTR)</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-600 flex-1">
                Все изменения в профиле автоматически синхронизируются с профилем игрока.
              </p>
              <button
                onClick={handleUnlinkPlayer}
                disabled={saving}
                className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 disabled:bg-gray-400"
              >
                Отвязать профиль игрока
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 mb-4">
              <p className="text-yellow-800 font-medium">
                ⚠️ Профиль не связан с игроком
              </p>
              <p className="text-sm text-gray-600 mt-2">
                Свяжи свой аккаунт с профилем игрока, чтобы участвовать в турнирах и отслеживать свой рейтинг.
              </p>
            </div>
            
            {/* Автокандидаты по ФИО пользователя */}
            {loadingCandidates ? (
              <p className="text-sm text-gray-500 mb-4">Поиск подходящих игроков...</p>
            ) : playerCandidates.length > 0 ? (
              <div className="mb-6">
                <p className="text-sm text-gray-700 mb-2">
                  Мы нашли игроков с таким же ФИО. Если один из них — ты, нажми «Да, это я».
                </p>
                <div className="border border-gray-200 rounded-md overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <p className="text-sm font-medium text-gray-700">
                      Найдено кандидатов: {playerCandidates.length}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {playerCandidates.map((candidate) => (
                      <div
                        key={candidate.id}
                        className="px-4 py-3 flex justify-between items-center hover:bg-gray-50"
                      >
                        <div>
                          <p className="font-medium text-gray-900">
                            {candidate.last_name} {candidate.first_name}
                            {candidate.patronymic && ` ${candidate.patronymic}`}
                          </p>
                          <div className="text-sm text-gray-600 mt-1">
                            {candidate.city && <span className="mr-3">📍 {candidate.city}</span>}
                            <span className="mr-3">⭐ Рейтинг: {candidate.current_rating}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleLinkPlayer(candidate.id)}
                          disabled={saving}
                          className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:bg-gray-400"
                        >
                          Да, это я
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {!showPlayerSearch ? (
              <button
                onClick={() => setShowPlayerSearch(true)}
                className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700"
              >
                Найти и связать профиль игрока
              </button>
            ) : (
              <div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Поиск игрока по имени и фамилии
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearchPlayers()}
                      placeholder="Например: Иван Иванов"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleSearchPlayers}
                      disabled={searching || searchQuery.length < 2}
                      className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                    >
                      {searching ? 'Поиск...' : 'Найти'}
                    </button>
                    <button
                      onClick={() => {
                        setShowPlayerSearch(false);
                        setSearchQuery('');
                        setSearchResults([]);
                      }}
                      className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400"
                    >
                      Отмена
                    </button>
                  </div>
                </div>

                {searchResults.length > 0 && (
                  <div className="border border-gray-200 rounded-md">
                    <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                      <p className="text-sm font-medium text-gray-700">
                        Найдено игроков: {searchResults.length}
                      </p>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {searchResults.map((player) => (
                        <div
                          key={player.id}
                          className="px-4 py-3 border-b border-gray-100 hover:bg-gray-50 flex justify-between items-center"
                        >
                          <div>
                            <p className="font-medium text-gray-900">
                              {player.first_name} {player.last_name}
                              {player.patronymic && ` ${player.patronymic}`}
                            </p>
                            <div className="text-sm text-gray-600 mt-1">
                              {player.city && <span className="mr-3">📍 {player.city}</span>}
                              <span className="mr-3">⭐ Рейтинг: {player.current_rating}</span>
                              {player.level && <span>🎯 {player.level}</span>}
                            </div>
                            {player.is_profi && (
                              <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                🏆 BTR Профи
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => handleLinkPlayer(player.id)}
                            disabled={saving}
                            className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:bg-gray-400"
                          >
                            Связать
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {searchQuery.length >= 2 && searchResults.length === 0 && !searching && (
                  <div className="text-center py-8 text-gray-500">
                    Игроки не найдены. Попробуй изменить запрос.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Смена пароля */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-semibold mb-4">Безопасность</h2>
        
        {!showPasswordForm ? (
          <button
            onClick={() => setShowPasswordForm(true)}
            className="bg-gray-600 text-white px-6 py-2 rounded-md hover:bg-gray-700"
          >
            Изменить пароль
          </button>
        ) : (
          <form onSubmit={handleChangePassword}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Текущий пароль
                </label>
                <input
                  type="password"
                  value={passwordData.old_password}
                  onChange={(e) => setPasswordData({ ...passwordData, old_password: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Новый пароль
                </label>
                <input
                  type="password"
                  value={passwordData.new_password}
                  onChange={(e) => setPasswordData({ ...passwordData, new_password: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Подтвердите новый пароль
                </label>
                <input
                  type="password"
                  value={passwordData.new_password_confirm}
                  onChange={(e) => setPasswordData({ ...passwordData, new_password_confirm: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {saving ? 'Сохранение...' : 'Сменить пароль'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordForm(false);
                    setPasswordData({ old_password: '', new_password: '', new_password_confirm: '' });
                  }}
                  className="bg-gray-300 text-gray-700 px-6 py-2 rounded-md hover:bg-gray-400"
                >
                  Отмена
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* Telegram */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-2xl font-semibold mb-4">Telegram</h2>
        
        {telegramStatus?.is_linked ? (
          <div>
            <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-4">
              <p className="text-green-800 font-medium">
                ✅ Telegram подключен
              </p>
              {telegramStatus.telegram_user && (
                <p className="text-sm text-gray-600 mt-1">
                  @{telegramStatus.telegram_user.username || telegramStatus.telegram_user.first_name}
                </p>
              )}
            </div>
            <button
              onClick={handleUnlinkTelegram}
              className="bg-red-600 text-white px-6 py-2 rounded-md hover:bg-red-700"
            >
              Отвязать Telegram
            </button>
          </div>
        ) : (
          <div>
            <p className="text-gray-600 mb-4">
              Свяжи свой аккаунт с Telegram, чтобы получать уведомления о турнирах и управлять регистрациями через бота.
            </p>
            
            {linkCode ? (
              <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
                <p className="font-medium mb-2">Твой код для связывания:</p>
                <div className="bg-white border-2 border-blue-500 rounded-md p-4 text-center">
                  <span className="text-3xl font-mono font-bold text-blue-600">{linkCode}</span>
                </div>
                <p className="text-sm text-gray-600 mt-3">
                  1. Найди бота в Telegram<br />
                  2. Отправь команду: <code className="bg-gray-200 px-2 py-1 rounded">/link {linkCode}</code><br />
                  3. Код действителен 15 минут
                </p>
                {telegramStatus?.pending_code && (
                  <p className="text-sm text-gray-500 mt-2">
                    Осталось: {telegramStatus.pending_code.expires_in_minutes} мин
                  </p>
                )}
              </div>
            ) : (
              <button
                onClick={handleGenerateTelegramCode}
                disabled={generatingCode}
                className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
              >
                {generatingCode ? 'Генерация...' : 'Сгенерировать код'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfilePage;
