import React, { useEffect, useState } from 'react';
import { playerApi, Player, ratingApi } from '../services/api';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const PlayersPage: React.FC = () => {
  const { user } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [briefs, setBriefs] = useState<Record<number, { current_rating: number; last_delta: number }>>({});
  const navigate = useNavigate();

  useEffect(() => {
    loadPlayers();
  }, []);

  const loadPlayers = async () => {
    try {
      const data = await playerApi.getList();
      setPlayers(data);
      if (data && data.length) {
        const ids = data.map(p => p.id);
        const br = await ratingApi.playerBriefs(ids);
        const map: Record<number, { current_rating: number; last_delta: number }> = {};
        (br.results || []).forEach((r: any) => { map[r.id] = { current_rating: r.current_rating, last_delta: r.last_delta }; });
        setBriefs(map);
      } else {
        setBriefs({});
      }
    } catch (error) {
      console.error('Ошибка загрузки игроков:', error);
    } finally {
      setLoading(false);
    }
  };

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
        <div className="card text-center py-8">Пока нет игроков</div>
      )}

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
