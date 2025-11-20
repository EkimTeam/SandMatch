import React, { useEffect, useState } from 'react';
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
  const [savingId, setSavingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const { results, total } = await adminApi.listUsers({ q: search, offset: (page - 1) * 10, limit: 10 });
      const mapped: Row[] = results.map(u => ({ ...u, pendingRole: u.role, dirty: false }));
      setRows(mapped);
      setTotalPages(Math.ceil((total || 0) / 10) || 1);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка загрузки пользователей');
    } finally {
      setLoading(false);
    }
  };

  // Load data when page changes
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

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
              onClick={() => {
                setSearch('');
                if (page === 1) {
                  load();
                } else {
                  setPage(1);
                }
              }}
            >
              Сброс
            </button>
          </form>
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
                <th className="px-3 py-2 text-left">Роль</th>
                <th className="px-3 py-2 text-center" style={{ width: 120 }}>Подтвердить</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-500">Загрузка...</td></tr>
              )}
              {!loading && !error && rows.map(row => (
                <tr key={row.id}>
                  <td className="px-3 py-2 align-middle">{row.full_name}</td>
                  <td className="px-3 py-2 align-middle">{row.username}</td>
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
                    <button
                      type="button"
                      className="px-3 py-1 text-sm bg-green-500 text-white rounded disabled:opacity-50"
                      disabled={!row.dirty || savingId === row.id}
                      onClick={() => openConfirm(row)}
                    >
                      ✓
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && !error && !rows.length && (
                <tr>
                  <td colSpan={4} className="text-center text-gray-500 py-6">
                    Пользователи не найдены
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm">
          <div>Стр. {page} из {totalPages}</div>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} className="px-2 py-1 border rounded disabled:opacity-50" onClick={() => setPage(p => Math.max(1, p - 1))}>Назад</button>
            <button disabled={page >= totalPages} className="px-2 py-1 border rounded disabled:opacity-50" onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Вперёд</button>
          </div>
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
                className="px-4 py-2 text-sm bg-red-600 text-white rounded"
                onClick={() => setConfirmRow(null)}
                disabled={savingId === confirmRow.id}
              >
                Нет
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded"
                onClick={applyRole}
                disabled={savingId === confirmRow.id}
              >
                Да
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
