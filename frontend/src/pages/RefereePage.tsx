import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { refereeApi, RefereeTournamentItem } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../services/date';

export const RefereePage: React.FC = () => {
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState<RefereeTournamentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const list = await refereeApi.myTournaments();
        setTournaments(list);
      } catch (e: any) {
        console.error('Failed to load referee tournaments', e);
        setError(e?.response?.data?.detail || 'Не удалось загрузить турниры для судейства');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (!user || user.role !== 'REFEREE') {
    return (
      <div className="card">
        Эта страница доступна только пользователям с ролью судьи (REFEREE).
      </div>
    );
  }

  if (loading) {
    return <div className="text-center py-8">Загрузка ваших турниров...</div>;
  }

  if (error) {
    return (
      <div className="card text-red-700">
        {error}
      </div>
    );
  }

  if (!tournaments.length) {
    return (
      <div className="card">
        Нет активных турниров для судейства.
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Мои турниры для судейства</h1>
      <div className="cards">
        {tournaments.map((t) => (
          <div key={t.id} className="card">
            <h3>{t.name}</h3>
            <div className="meta">
              {formatDate(t.date)} • {t.get_system_display} • {t.get_participant_mode_display}
              {t.organizer_name ? ` • Организатор: ${t.organizer_name}` : ''}
            </div>
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Link
                to={
                  t.system === 'round_robin'
                    ? `/tournaments/${t.id}/round_robin`
                    : t.system === 'king'
                      ? `/tournaments/${t.id}/king`
                      : `/tournaments/${t.id}/knockout`
                }
                className="btn"
              >
                Открыть
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
