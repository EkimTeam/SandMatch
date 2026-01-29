import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, AdminUserItem } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { ForbiddenPage } from './ForbiddenPage';

const ROLES: Array<{ value: AdminUserItem['role']; label: string }> = [
  { value: 'ADMIN', label: 'ADMIN' },
  { value: 'ORGANIZER', label: 'ORGANIZER' },
  { value: 'REFEREE', label: 'REFEREE' },
  { value: 'REGISTERED', label: 'REGISTERED' },
];

interface Row extends AdminUserItem {
  pendingRole: AdminUserItem['role'];
  dirty: boolean;
}

const UserRolesPageInner: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [confirmRow, setConfirmRow] = useState<Row | null>(null);
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [filterBP, setFilterBP] = useState(false);
  const [filterBTR, setFilterBTR] = useState(false);
  const [filterTelegram, setFilterTelegram] = useState(false);

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
      
      const mapped: Row[] = results.map(u => ({ ...u, pendingRole: u.role, dirty: false }));
      setRows(mapped);
      setTotalPages(Math.ceil((total || 0) / pageSize) || 1);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка загрузки пользователей');
    } finally {
      setLoading(false);
    }
  };

  const handleUnlinkTelegram = async (row: Row) => {
    if (!row.has_telegram || unlinkingId === row.id) return;
    if (!window.confirm('Действительно удалить связь этого пользователя с телеграмм-аккаунтом?')) {
      return;
    }
    setUnlinkingId(row.id);
    try {
      await adminApi.unlinkTelegram(row.id);
      setRows(prev =>
        prev.map(r =>
          r.id === row.id
            ? { ...r, has_telegram: false }
            : r
        )
      );
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Не удалось отвязать Telegram');
    } finally {
      setUnlinkingId(null);
    }
  };

  // Load data when page, pageSize or filters change
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, roleFilter, filterBP, filterBTR, filterTelegram]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Reset to page 1 and trigger a reload
    if (page === 1) {
      load();
    } else {
      setPage(1);
    }
  };

  const handleChangeRole = (id: number, newRole: Row['role']) => {
    setRows(prev =>
      prev.map(r => (r.id === id ? { ...r, pendingRole: newRole, dirty: newRole !== r.role } : r))
    );
  };

  const openConfirm = (row: Row) => {
    if (!row.dirty) return;
    setConfirmRow(row);
  };

  const applyRole = async () => {
    if (!confirmRow) return;
    const row = confirmRow;
    setSavingId(row.id);
    try {
      await adminApi.setUserRole(row.id, row.pendingRole || 'REGISTERED');
      setRows(prev =>
        prev.map(r =>
          r.id === row.id ? { ...r, role: row.pendingRole, dirty: false } : r
        )
      );
      setConfirmRow(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Не удалось сменить роль пользователя');
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteRow) return;
    const row = deleteRow;
    setDeletingId(row.id);
    try {
      await adminApi.deleteUser(row.id);
      setRows(prev => prev.filter(r => r.id !== row.id));
      setDeleteRow(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Не удалось удалить пользователя');
    } finally {
      setDeletingId(null);
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Управление ролями пользователей</h1>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
          <div className="font-semibold">Список пользователей</div>
          <form className="flex items-center gap-2" onSubmit={handleSearchSubmit}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
              placeholder="Поиск по ФИО или логину"
            />
            <button type="submit" className="px-3 py-1 text-sm bg-blue-600 text-white rounded" disabled={loading}>
              Искать
            </button>
            <button
              type="button"
              className="px-3 py-1 text-sm bg-gray-100 rounded"
              onClick={handleReset}
            >
              Сброс
            </button>
          </form>
        </div>

        {/* Фильтры */}
        <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Роль:</label>
            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="">Все</option>
              {ROLES.map(r => (
                <option key={r.value} value={r.value || ''}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium">Связи:</label>
            <label className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={filterBP}
                onChange={e => setFilterBP(e.target.checked)}
              />
              Игрок BP
            </label>
            <label className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={filterBTR}
                onChange={e => setFilterBTR(e.target.checked)}
              />
              Игрок BTR
            </label>
            <label className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={filterTelegram}
                onChange={e => setFilterTelegram(e.target.checked)}
              />
              Telegram
            </label>
          </div>
        </div>

        {error && (
          <div className="p-4 text-red-600 bg-red-50">{error}</div>
        )}
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="px-3 py-2 text-left">ФИО</th>
                <th className="px-3 py-2 text-left">Логин</th>
                <th className="px-3 py-2 text-center" style={{ width: 100 }}>Связи</th>
                <th className="px-3 py-2 text-left">Роль</th>
                <th className="px-3 py-2 text-center" style={{ width: 140 }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">Загрузка...</td></tr>
              )}
              {!loading && !error && rows.map(row => (
                <tr key={row.id}>
                  <td className="px-3 py-2 align-middle">{row.full_name}</td>
                  <td className="px-3 py-2 align-middle">{row.username}</td>
                  <td className="px-3 py-2 align-middle text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span title="Игрок BP" className={row.has_bp_player ? 'text-blue-600 font-semibold' : 'text-gray-300'}>
                        BP
                      </span>
                      <span title="Игрок BTR" className={row.has_btr_player ? 'text-green-600 font-semibold' : 'text-gray-300'}>
                        BTR
                      </span>
                      <span
                        title="Telegram"
                        className={
                          row.has_telegram
                            ? 'text-blue-500 font-semibold'
                            : row.has_telegram_profile
                            ? 'text-yellow-500 font-semibold'
                            : 'text-gray-300'
                        }
                      >
                        TG
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <select
                      className="border rounded px-2 py-1 text-sm w-full"
                      value={row.pendingRole || ''}
                      onChange={e => handleChangeRole(row.id, e.target.value as Row['role'])}
                    >
                      <option value="">(нет роли)</option>
                      {ROLES.map(r => (
                        <option key={r.value} value={r.value || ''}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 align-middle text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        className="px-3 py-1 text-sm bg-green-500 text-white rounded disabled:opacity-50"
                        disabled={!row.dirty || savingId === row.id}
                        onClick={() => openConfirm(row)}
                        title="Подтвердить изменение роли"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1 text-sm bg-red-500 text-white rounded disabled:opacity-50"
                        disabled={deletingId === row.id}
                        onClick={() => setDeleteRow(row)}
                        title="Удалить пользователя"
                      >
                        ✕
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1 text-sm bg-red-500 text-white rounded disabled:opacity-50"
                        disabled={!row.has_telegram || unlinkingId === row.id}
                        onClick={() => handleUnlinkTelegram(row)}
                        title="Принудительно отвязать Telegram"
                      >
                        TG
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && !error && !rows.length && (
                <tr>
                  <td colSpan={5} className="text-center text-gray-500 py-6">
                    Пользователи не найдены
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span>Стр. {page} из {totalPages}</span>
            <span className="text-gray-400">|</span>
            <label className="flex items-center gap-2">
              <span>Строк:</span>
              <select
                value={pageSize}
                onChange={e => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="border rounded px-2 py-1"
              >
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

        <div className="px-4 py-3 border-t border-gray-200 text-xs text-gray-700 space-y-1">
          <div className="font-semibold">Условные обозначения:</div>
          <div>
            <span className="font-mono font-semibold text-blue-600 mr-1">BP</span>
            – есть связанный игрок BeachPlay (нет связи – значок серый).
          </div>
          <div>
            <span className="font-mono font-semibold text-green-600 mr-1">BTR</span>
            – есть связанный игрок BeachTennisRussia (нет связи – значок серый).
          </div>
          <div>
            <span className="font-mono font-semibold text-blue-500 mr-1">TG</span>
            – есть активная связь с Telegram-аккаунтом.
          </div>
          <div>
            <span className="font-mono font-semibold text-yellow-500 mr-1">TG</span>
            – пользователь заходил в Telegram-бот, но связь с аккаунтом не настроена.
          </div>
          <div>
            <span className="font-mono font-semibold text-gray-300 mr-1">TG</span>
            – нет данных о профиле в Telegram-боте.
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200">
          <Link
            to="/admin/user-links"
            className="inline-block px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            🔗 Инструмент связей User / Player / Telegram
          </Link>
        </div>
      </div>

      {confirmRow && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">Подтверждение изменения роли</h2>
            <p className="mb-6">
              Вы действительно хотите для <span className="font-semibold">{confirmRow.full_name || confirmRow.username} ({confirmRow.username})</span>
              {' '}сменить роль с <span className="font-semibold">{confirmRow.role || '(нет роли)'}</span> на <span className="font-semibold">{confirmRow.pendingRole || '(нет роли)'}</span>?
            </p>
            <div className="flex justify-end gap-4">
              <button
                type="button"
                className="px-4 py-2 text-sm bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                onClick={() => setConfirmRow(null)}
                disabled={savingId === confirmRow.id}
              >
                Отмена
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                onClick={applyRole}
                disabled={savingId === confirmRow.id}
              >
                {savingId === confirmRow.id ? 'Сохранение...' : 'Подтвердить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteRow && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4 text-red-600">⚠️ Подтверждение удаления</h2>
            <p className="mb-4">
              Вы действительно хотите <span className="font-semibold text-red-600">безвозвратно удалить</span> пользователя{' '}
              <span className="font-semibold">{deleteRow.full_name || deleteRow.username} ({deleteRow.username})</span>?
            </p>
            <p className="mb-6 text-sm text-gray-600">
              Это действие удалит пользователя и все связанные с ним данные из системы. Отменить это действие будет невозможно.
            </p>
            <div className="flex justify-end gap-4">
              <button
                type="button"
                className="px-4 py-2 text-sm bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                onClick={() => setDeleteRow(null)}
                disabled={deletingId === deleteRow.id}
              >
                Отмена
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                onClick={handleDeleteUser}
                disabled={deletingId === deleteRow.id}
              >
                {deletingId === deleteRow.id ? 'Удаление...' : 'Удалить безвозвратно'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="mt-2 text-muted" style={{ fontSize: '0.9em' }}>
          Загрузка...
        </div>
      )}
    </div>
  );
};

export const UserRolesPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  if (!isAdmin) {
    return <ForbiddenPage />;
  }

  return <UserRolesPageInner />;
};
