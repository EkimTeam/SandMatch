import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { formatDate } from '../services/date';
import { Link } from 'react-router-dom';
import { NewTournamentModal } from '../components/NewTournamentModal';

interface TournamentOverviewItem {
  id: number;
  name: string;
  date: string;
  system: string;
  participant_mode: string;
  status: string;
  get_system_display: string;
  get_participant_mode_display: string;
}

interface SetFormat { id: number; name: string; }
interface Ruleset { id: number; name: string; }

export const TournamentListPage: React.FC = () => {
  const [activeTournaments, setActiveTournaments] = useState<TournamentOverviewItem[]>([]);
  const [historyTournaments, setHistoryTournaments] = useState<TournamentOverviewItem[]>([]);
  const [setFormats, setSetFormats] = useState<SetFormat[]>([]);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    loadOverview();
    loadDictionaries();
  }, []);

  const loadOverview = async () => {
    try {
      const resp = await fetch('/api/tournaments/overview/');
      const data = await resp.json();
      const byDateDesc = (a: TournamentOverviewItem, b: TournamentOverviewItem) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
      setActiveTournaments((data.active || []).slice().sort(byDateDesc));
      setHistoryTournaments((data.history || []).slice().sort(byDateDesc));
    } catch (e) {
      console.error('Ошибка загрузки турниров:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadDictionaries = async () => {
    try {
      const [fResp, rResp] = await Promise.all([
        fetch('/api/set-formats/'),
        fetch('/api/rulesets/'),
      ]);
      const fJson = await fResp.json();
      const rJson = await rResp.json();
      setSetFormats(fJson.set_formats || []);
      setRulesets(rJson.rulesets || []);
    } catch (e) {
      console.error('Ошибка загрузки справочников:', e);
    }
  };

  const handleCreateTournament = async (payload: any) => {
    try {
      const isRR = payload.system === 'round_robin';
      const url = isRR ? '/tournaments/new_round_robin/' : '/tournaments/new_knockout/';
      const { data } = await api.post(url, payload);
      if (!data.ok) throw new Error(data.error || 'Ошибка создания турнира');
      setShowModal(false);
      window.location.href = data.redirect;
    } catch (error: any) {
      alert(error.message);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Загрузка турниров...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center gap-3 flex-wrap mb-6">
        <h1 className="text-2xl font-bold m-0">Турниры</h1>
        <div className="flex items-center gap-2">
          <div className="flex border border-gray-300 rounded-lg overflow-hidden">
            <button
              className={`px-3 py-2 text-sm ${viewMode === 'grid' ? 'bg-gray-100' : 'bg-white'}`}
              onClick={() => setViewMode('grid')}
              title="Плитка"
            >
              Плитка
            </button>
            <button
              className={`px-3 py-2 text-sm ${viewMode === 'list' ? 'bg-gray-100' : 'bg-white'}`}
              onClick={() => setViewMode('list')}
              title="Список"
            >
              Список
            </button>
          </div>
          <button className="btn" onClick={() => setShowModal(true)}>Начать новый турнир</button>
        </div>
      </div>

      <h2 className="section-title">Активные</h2>
      {activeTournaments.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="cards">
            {activeTournaments.map(t => (
              <div key={t.id} className="card">
                <h3>{t.name}</h3>
                <div className="meta">{formatDate(t.date)} • {t.get_system_display} • {t.get_participant_mode_display}</div>
                
                <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <Link
                    to={t.system === 'round_robin' ? `/tournaments/${t.id}/round_robin` : `/tournaments/${t.id}/knockout`}
                    className="btn"
                  >
                    Открыть
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {activeTournaments.map(t => (
              <div key={t.id} className="card">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="m-0">{t.name}</h3>
                    <div className="meta">{formatDate(t.date)} • {t.get_system_display} • {t.get_participant_mode_display}</div>
                    
                  </div>
                  <Link to={t.system === 'round_robin' ? `/tournaments/${t.id}/round_robin` : `/tournaments/${t.id}/knockout`} className="btn">Открыть</Link>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="card">Пока нет активных турниров</div>
      )}

      <h2 className="section-title" style={{ marginTop: '20px' }}>Завершенные турниры</h2>
      {historyTournaments.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="cards">
            {historyTournaments.map(t => (
              <div key={t.id} className="card">
                <h3>{t.name}</h3>
                <div className="meta">{formatDate(t.date)} • {t.get_system_display} • {t.get_participant_mode_display}</div>
                <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <Link to={t.system === 'round_robin' ? `/tournaments/${t.id}/round_robin` : `/tournaments/${t.id}/knockout`} className="btn">Открыть</Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {historyTournaments.map(t => (
              <div key={t.id} className="card">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="m-0">{t.name}</h3>
                    <div className="meta">{formatDate(t.date)} • {t.get_system_display} • {t.get_participant_mode_display}</div>
                  </div>
                  <Link to={t.system === 'round_robin' ? `/tournaments/${t.id}/round_robin` : `/tournaments/${t.id}/knockout`} className="btn">Открыть</Link>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="card">История пока пуста</div>
      )}

      {showModal && (
        <NewTournamentModal
          setFormats={setFormats}
          rulesets={rulesets}
          onSubmit={handleCreateTournament}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
};
