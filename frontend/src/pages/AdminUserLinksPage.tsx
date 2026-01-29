import React, { useEffect, useState } from 'react';
import { adminApi, AdminUserItem, AdminUserLinks } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { ForbiddenPage } from './ForbiddenPage';

interface Row extends AdminUserItem {}

const ROLES: Array<{ value: AdminUserItem['role']; label: string }> = [
  { value: 'ADMIN', label: 'ADMIN' },
  { value: 'ORGANIZER', label: 'ORGANIZER' },
  { value: 'REFEREE', label: 'REFEREE' },
  { value: 'REGISTERED', label: 'REGISTERED' },
];

const AdminUserLinksPageInner: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [filterBP, setFilterBP] = useState(false);
  const [filterBTR, setFilterBTR] = useState(false);
  const [filterTelegram, setFilterTelegram] = useState(false);

  const [selectedRow, setSelectedRow] = useState<Row | null>(null);
  const [linksDraft, setLinksDraft] = useState<AdminUserLinks | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [savingLinks, setSavingLinks] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const { results, total } = await adminApi.listUsers({
        q: search,
        offset: (page - 1) * pageSize,
        limit: pageSize,
        role: roleFilter || undefined,
        filter_bp: filterBP || undefined,
        filter_btr: filterBTR || undefined,
        filter_telegram: filterTelegram || undefined,
      });
      setRows(results);
      setTotalPages(Math.ceil((total || 0) / pageSize) || 1);
      if (selectedRow && !results.find(r => r.id === selectedRow.id)) {
        setSelectedRow(null);
        setLinksDraft(null);
        setLinksError(null);
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка загрузки пользователей');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, roleFilter, filterBP, filterBTR, filterTelegram]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (page === 1) {
      load();
    } else {
      setPage(1);
    }
  };

  const handleReset = () => {
    setSearch('');
    setRoleFilter('');
    setFilterBP(false);
    setFilterBTR(false);
    setFilterTelegram(false);
    if (page === 1) {
      load();
    } else {
      setPage(1);
    }
  };

  const loadLinks = async (row: Row) => {
    setSelectedRow(row);
    setLinksDraft(null);
    setLinksError(null);
    setLoadingLinks(true);
    try {
      const data = await adminApi.getUserLinks(row.id);
      setLinksDraft(JSON.parse(JSON.stringify(data)));
    } catch (e: any) {
      setLinksError(e?.response?.data?.detail || e?.message || 'Ошибка загрузки связей');
    } finally {
      setLoadingLinks(false);
    }
  };

  const updateDraft = (updater: (draft: AdminUserLinks) => void) => {
    setLinksDraft(prev => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      updater(copy);
      return copy;
    });
  };

  const handleSaveLinks = async () => {
    if (!selectedRow || !linksDraft) return;
    setSavingLinks(true);
    setLinksError(null);
    try {
      const payload: any = {};
      if (linksDraft.user) payload.user = linksDraft.user;
      if (linksDraft.profile !== undefined) payload.profile = linksDraft.profile;
      if (linksDraft.player !== undefined) payload.player = linksDraft.player;
      if (linksDraft.telegram_user !== undefined) payload.telegram_user = linksDraft.telegram_user;

      const updated = await adminApi.updateUserLinks(selectedRow.id, payload);
      setLinksDraft(JSON.parse(JSON.stringify(updated)));
    } catch (e: any) {
      setLinksError(e?.response?.data?.detail || e?.message || 'Не удалось сохранить');
    } finally {
      setSavingLinks(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Инструмент связей User / Player / Telegram</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
            <div className="font-semibold">Пользователи</div>
            <form className="flex items-center gap-2" onSubmit={handleSearchSubmit}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
                placeholder="Поиск"
              />
              <button type="submit" className="px-3 py-1 text-sm bg-blue-600 text-white rounded" disabled={loading}>
                Искать
              </button>
              <button type="button" className="px-3 py-1 text-sm bg-gray-100 rounded" onClick={handleReset}>
                Сброс
              </button>
            </form>
          </div>

          <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Роль:</label>
              <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="border rounded px-2 py-1 text-sm">
                <option value="">Все</option>
                {ROLES.map(r => (
                  <option key={r.value} value={r.value || ''}>{r.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-sm cursor-pointer">
                <input type="checkbox" checked={filterBP} onChange={e => setFilterBP(e.target.checked)} />
                <span>BP</span>
              </label>
              <label className="flex items-center gap-1 text-sm cursor-pointer">
                <input type="checkbox" checked={filterBTR} onChange={e => setFilterBTR(e.target.checked)} />
                <span>BTR</span>
              </label>
              <label className="flex items-center gap-1 text-sm cursor-pointer">
                <input type="checkbox" checked={filterTelegram} onChange={e => setFilterTelegram(e.target.checked)} />
                <span>TG</span>
              </label>
            </div>
          </div>

          {error && <div className="p-4 text-red-600 bg-red-50">{error}</div>}

          <div className="overflow-auto" style={{ maxHeight: 400 }}>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600">
                  <th className="px-3 py-2 text-left">ФИО</th>
                  <th className="px-3 py-2 text-left">Логин</th>
                  <th className="px-3 py-2 text-center" style={{ width: 90 }}>Связи</th>
                  <th className="px-3 py-2 text-center" style={{ width: 80 }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-500">Загрузка...</td></tr>}
                {!loading && !error && rows.map(row => (
                  <tr key={row.id} className={selectedRow?.id === row.id ? 'bg-blue-50' : ''}>
                    <td className="px-3 py-2">{row.full_name}</td>
                    <td className="px-3 py-2">{row.username}</td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <span className={row.has_bp_player ? 'text-blue-600 font-semibold' : 'text-gray-300'}>BP</span>
                        <span className={row.has_btr_player ? 'text-green-600 font-semibold' : 'text-gray-300'}>BTR</span>
                        <span className={row.has_telegram ? 'text-blue-500 font-semibold' : row.has_telegram_profile ? 'text-yellow-500 font-semibold' : 'text-gray-300'}>TG</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button type="button" className="px-3 py-1 text-xs bg-blue-600 text-white rounded" onClick={() => loadLinks(row)}>
                        Открыть
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && !error && !rows.length && <tr><td colSpan={4} className="text-center text-gray-500 py-6">Не найдено</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span>Стр. {page} из {totalPages}</span>
              <span className="text-gray-400">|</span>
              <label className="flex items-center gap-2">
                <span>Строк:</span>
                <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className="border rounded px-2 py-1">
                  <option value="20">20</option>
                  <option value="40">40</option>
                  <option value="60">60</option>
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} className="px-2 py-1 border rounded disabled:opacity-50" onClick={() => setPage(p => Math.max(1, p - 1))}>Назад</button>
              <button disabled={page >= totalPages} className="px-2 py-1 border rounded disabled:opacity-50" onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Вперёд</button>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 font-semibold">
            {selectedRow ? `Редактирование связей: ${selectedRow.full_name} (${selectedRow.username})` : 'Выберите пользователя'}
          </div>

          {!selectedRow && (
            <div className="p-6 text-center text-gray-500">
              Выберите пользователя из списка слева для просмотра и редактирования связей
            </div>
          )}

          {selectedRow && loadingLinks && (
            <div className="p-6 text-center text-gray-500">Загрузка...</div>
          )}

          {selectedRow && !loadingLinks && linksError && (
            <div className="p-4 text-red-600 bg-red-50">{linksError}</div>
          )}

          {selectedRow && !loadingLinks && linksDraft && (
            <div className="p-4 space-y-4 overflow-auto" style={{ maxHeight: 600 }}>
              <div className="space-y-2">
                <div className="font-semibold text-sm">User</div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs">
                    <span className="block mb-1">Username</span>
                    <input
                      type="text"
                      className="border rounded px-2 py-1 text-sm w-full"
                      value={linksDraft.user.username}
                      onChange={e => updateDraft(d => { d.user.username = e.target.value; })}
                    />
                  </label>
                  <label className="text-xs">
                    <span className="block mb-1">Email</span>
                    <input
                      type="text"
                      className="border rounded px-2 py-1 text-sm w-full"
                      value={linksDraft.user.email || ''}
                      onChange={e => updateDraft(d => { d.user.email = e.target.value || null; })}
                    />
                  </label>
                  <label className="text-xs">
                    <span className="block mb-1">Имя</span>
                    <input
                      type="text"
                      className="border rounded px-2 py-1 text-sm w-full"
                      value={linksDraft.user.first_name}
                      onChange={e => updateDraft(d => { d.user.first_name = e.target.value; })}
                    />
                  </label>
                  <label className="text-xs">
                    <span className="block mb-1">Фамилия</span>
                    <input
                      type="text"
                      className="border rounded px-2 py-1 text-sm w-full"
                      value={linksDraft.user.last_name}
                      onChange={e => updateDraft(d => { d.user.last_name = e.target.value; })}
                    />
                  </label>
                  <label className="text-xs flex items-center gap-2 col-span-2">
                    <input
                      type="checkbox"
                      checked={linksDraft.user.is_active}
                      onChange={e => updateDraft(d => { d.user.is_active = e.target.checked; })}
                    />
                    <span>Активен (is_active)</span>
                  </label>
                </div>
              </div>

              {linksDraft.profile && (
                <div className="space-y-2">
                  <div className="font-semibold text-sm">Profile</div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs">
                      <span className="block mb-1">Роль</span>
                      <select
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.profile.role || ''}
                        onChange={e => updateDraft(d => { if (d.profile) d.profile.role = (e.target.value || null) as any; })}
                      >
                        <option value="">Нет роли</option>
                        {ROLES.map(r => <option key={r.value} value={r.value || ''}>{r.label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs">
                      <span className="block mb-1">Player ID</span>
                      <input
                        type="number"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.profile.player_id || ''}
                        onChange={e => updateDraft(d => { if (d.profile) d.profile.player_id = e.target.value ? Number(e.target.value) : null; })}
                      />
                    </label>
                  </div>
                </div>
              )}

              {linksDraft.player && (
                <div className="space-y-2">
                  <div className="font-semibold text-sm">Player (ID: {linksDraft.player.id})</div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs">
                      <span className="block mb-1">Имя</span>
                      <input
                        type="text"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.player.first_name}
                        onChange={e => updateDraft(d => { if (d.player) d.player.first_name = e.target.value; })}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="block mb-1">Фамилия</span>
                      <input
                        type="text"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.player.last_name}
                        onChange={e => updateDraft(d => { if (d.player) d.player.last_name = e.target.value; })}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="block mb-1">Отчество</span>
                      <input
                        type="text"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.player.patronymic || ''}
                        onChange={e => updateDraft(d => { if (d.player) d.player.patronymic = e.target.value || null; })}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="block mb-1">Дата рождения</span>
                      <input
                        type="date"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.player.birth_date || ''}
                        onChange={e => updateDraft(d => { if (d.player) d.player.birth_date = e.target.value || null; })}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="block mb-1">Пол</span>
                      <select
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.player.gender || ''}
                        onChange={e => updateDraft(d => { if (d.player) d.player.gender = (e.target.value || null) as any; })}
                      >
                        <option value="">Не указан</option>
                        <option value="male">Мужчина</option>
                        <option value="female">Женщина</option>
                      </select>
                    </label>
                    <label className="text-xs">
                      <span className="block mb-1">Телефон</span>
                      <input
                        type="text"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.player.phone || ''}
                        onChange={e => updateDraft(d => { if (d.player) d.player.phone = e.target.value || null; })}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="block mb-1">Отображаемое имя</span>
                      <input
                        type="text"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.player.display_name}
                        onChange={e => updateDraft(d => { if (d.player) d.player.display_name = e.target.value; })}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="block mb-1">Город</span>
                      <input
                        type="text"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.player.city}
                        onChange={e => updateDraft(d => { if (d.player) d.player.city = e.target.value; })}
                      />
                    </label>
                    <label className="text-xs flex items-center gap-2 col-span-2">
                      <input
                        type="checkbox"
                        checked={linksDraft.player.is_profi}
                        onChange={e => updateDraft(d => { if (d.player) d.player.is_profi = e.target.checked; })}
                      />
                      <span>Профессиональный игрок (BTR)</span>
                    </label>
                  </div>
                </div>
              )}

              {linksDraft.telegram_user && (
                <div className="space-y-2">
                  <div className="font-semibold text-sm">Telegram User (ID: {linksDraft.telegram_user.id})</div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs">
                      <span className="block mb-1">Telegram ID</span>
                      <input
                        type="number"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.telegram_user.telegram_id || ''}
                        onChange={e => updateDraft(d => { if (d.telegram_user) d.telegram_user.telegram_id = e.target.value ? Number(e.target.value) : null; })}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="block mb-1">Username</span>
                      <input
                        type="text"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.telegram_user.username || ''}
                        onChange={e => updateDraft(d => { if (d.telegram_user) d.telegram_user.username = e.target.value || null; })}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="block mb-1">Имя</span>
                      <input
                        type="text"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.telegram_user.first_name}
                        onChange={e => updateDraft(d => { if (d.telegram_user) d.telegram_user.first_name = e.target.value; })}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="block mb-1">Фамилия</span>
                      <input
                        type="text"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.telegram_user.last_name || ''}
                        onChange={e => updateDraft(d => { if (d.telegram_user) d.telegram_user.last_name = e.target.value || null; })}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="block mb-1">Player ID</span>
                      <input
                        type="number"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.telegram_user.player_id || ''}
                        onChange={e => updateDraft(d => { if (d.telegram_user) d.telegram_user.player_id = e.target.value ? Number(e.target.value) : null; })}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="block mb-1">Язык</span>
                      <input
                        type="text"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={linksDraft.telegram_user.language_code}
                        onChange={e => updateDraft(d => { if (d.telegram_user) d.telegram_user.language_code = e.target.value; })}
                      />
                    </label>
                    <label className="text-xs flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={linksDraft.telegram_user.is_blocked}
                        onChange={e => updateDraft(d => { if (d.telegram_user) d.telegram_user.is_blocked = e.target.checked; })}
                      />
                      <span>Заблокирован</span>
                    </label>
                    <label className="text-xs flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={linksDraft.telegram_user.notifications_enabled}
                        onChange={e => updateDraft(d => { if (d.telegram_user) d.telegram_user.notifications_enabled = e.target.checked; })}
                      />
                      <span>Уведомления</span>
                    </label>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t">
                <button
                  type="button"
                  className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
                  onClick={handleSaveLinks}
                  disabled={savingLinks}
                >
                  {savingLinks ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const AdminUserLinksPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  if (!isAdmin) {
    return <ForbiddenPage />;
  }

  return <AdminUserLinksPageInner />;
};
