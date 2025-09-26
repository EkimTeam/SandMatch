import React, { useEffect, useState } from 'react';
import { playerApi, Player } from '../services/api';

export const PlayersPage: React.FC = () => {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPlayers();
  }, []);

  const loadPlayers = async () => {
    try {
      const data = await playerApi.getList();
      setPlayers(data);
    } catch (error) {
      console.error('Ошибка загрузки игроков:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Загрузка игроков...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center gap-3 flex-wrap mb-6">
        <h1 className="text-2xl font-bold m-0">Игроки</h1>
        <a href="/sm-admin/apps/players/player/add/" className="btn">
          Добавить игрока
        </a>
      </div>

      {players.length > 0 ? (
        <div className="cards">
          {players.map((player) => (
            <div key={player.id} className="card">
              <h3 className="text-lg font-semibold mb-1">
                {player.last_name} {player.first_name}
              </h3>
              <div className="meta">
                {player.display_name || player.first_name}
                {player.level && ` • ${player.level}`}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card text-center py-8">Пока нет игроков</div>
      )}
    </div>
  );
};
