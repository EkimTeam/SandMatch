import React, { useEffect, useMemo, useState } from 'react';
import { Player, ratingApi } from '../services/api';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const PlayersPage: React.FC = () => {
  const { user } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [briefs, setBriefs] = useState<Record<number, { current_rating: number; last_delta: number }>>({});
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(24);
  const [q, setQ] = useState<string>('');
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const pageParam = parseInt(searchParams.get('page') || '1', 10);
    const pageSizeParam = parseInt(searchParams.get('page_size') || '24', 10);
    const qParam = searchParams.get('q') || '';
    setPage(Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1);
    setPageSize([24, 48, 72].includes(pageSizeParam) ? pageSizeParam : 24);
    setQ(qParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params: any = {};
    if (q) params.q = q;
    if (page && page > 1) params.page = String(page);
    if (pageSize !== 24) params.page_size = String(pageSize);
    setSearchParams(params, { replace: true });
  }, [q, page, pageSize, setSearchParams]);

  const canLoad = useMemo(() => user?.role !== 'REFEREE', [user?.role]);

  useEffect(() => {
    const loadPlayers = async () => {
      if (!canLoad) return;
      try {
        setLoading(true);
        const data = await ratingApi.leaderboard({ q, page, page_size: pageSize });
        const rows: any[] = data?.results || [];
        setTotalPages(data?.total_pages || 1);

        const mapped: Player[] = rows.map((r: any) => ({
          id: r.id,
          first_name: r.first_name || r.display_name,
          last_name: r.last_name,
          display_name: r.display_name,
          level: undefined as any,
          current_rating: r.current_rating,
        }));
        setPlayers(mapped);

        if (rows.length) {
          const ids = rows.map((r: any) => r.id);
          const br = await ratingApi.playerBriefs(ids);
          const map: Record<number, { current_rating: number; last_delta: number }> = {};
          (br.results || []).forEach((r: any) => {
            map[r.id] = { current_rating: r.current_rating, last_delta: r.last_delta };
          });
          setBriefs(map);
        } else {
          setBriefs({});
        }
      } catch (error) {
        console.error('Ошибка загрузки игроков:', error);
        setPlayers([]);
        setBriefs({});
        setTotalPages(1);
      } finally {
        setLoading(false);
      }
    };
    loadPlayers();
  }, [canLoad, page, pageSize, q]);

  if (user?.role === 'REFEREE') {
    return (
      <div className="card">
        Страница списка игроков недоступна для роли судьи. Используйте раздел
        {' '}
        <span className="font-semibold">"Судейство"</span>
        {' '}для работы с назначенными вам турнирами.
      </div>
    );
  }

  if (loading) {
    return <div className="text-center py-8">Загрузка игроков...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center gap-3 flex-wrap mb-6">
        <h1 className="text-2xl font-bold m-0">Игроки</h1>
        <button
          type="button"
          className="btn opacity-50 cursor-not-allowed pointer-events-none"
          disabled
          title="Доступ ограничен"
        >
          Добавить игрока
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQ(q.trim());
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
            placeholder="Поиск игрока"
          />
          <button type="submit" className="px-3 py-1 text-sm bg-blue-600 text-white rounded">
            Искать
          </button>
          <button
            type="button"
            className="px-3 py-1 text-sm bg-gray-100 rounded"
            onClick={() => {
              setQ('');
              setPage(1);
            }}
          >
            Сброс
          </button>
        </form>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Показывать:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              const newSize = parseInt(e.target.value, 10);
              setPageSize(newSize);
              setPage(1);
            }}
            className="px-2 py-1 border rounded bg-white text-sm"
          >
            <option value={24}>24</option>
            <option value={48}>48</option>
            <option value={72}>72</option>
          </select>
        </div>
      </div>

      {players.length > 0 ? (
        <div className="cards">
          {players.map((player) => {
            const b = briefs[player.id] || { current_rating: 0, last_delta: 0, rank: undefined as any };
            const deltaPos = b.last_delta > 0;
            const deltaNeg = b.last_delta < 0;
            const deltaColor = deltaPos ? 'text-green-600' : deltaNeg ? 'text-red-600' : 'text-gray-500';
            return (
              <button
                key={player.id}
                className="card text-left w-full"
                onClick={() => navigate(`/players/${player.id}`)}
              >
                <h3 className="text-lg font-semibold mb-1 flex items-baseline gap-2 flex-wrap">
                  <span>{player.last_name} {player.first_name}</span>
                  <span className="inline-flex items-baseline gap-1">
                    <span className="text-xl font-bold leading-none">{b.current_rating ?? 0}</span>
                    <span className="text-[10px] leading-none opacity-70">BP</span>
                  </span>
                  {typeof (b as any).rank === 'number' && (
                    <span className="text-xs text-gray-500"># {(b as any).rank}</span>
                  )}
                  <span className={`inline-flex items-center gap-1 ${deltaColor}`}>
                    {deltaPos && <span>▲</span>}
                    {deltaNeg && <span>▼</span>}
                    <span className="font-medium">{Math.round(Math.abs(b.last_delta || 0))}</span>
                  </span>
                </h3>
                <div className="meta">
                  {player.display_name || player.first_name}
                  {player.level && ` • ${player.level}`}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="card text-center py-8">{loading ? 'Загрузка игроков...' : (q ? 'Игроки не найдены' : 'Пока нет игроков')}</div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 text-sm flex-wrap">
        <div>Стр. {page} из {totalPages}</div>
        <div className="flex items-center gap-2 ml-auto">
          <button
            disabled={page <= 1}
            className="px-2 py-1 border rounded disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Назад
          </button>
          <button
            disabled={page >= totalPages}
            className="px-2 py-1 border rounded disabled:opacity-50"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Вперёд
          </button>
        </div>
      </div>

      {user?.role === 'ADMIN' && (
        <div className="mt-8 text-center">
          <Link to="/admin/roles" className="btn btn-outline-secondary">
            Роли пользователей
          </Link>
        </div>
      )}
    </div>
  );
};
