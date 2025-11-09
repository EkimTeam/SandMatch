import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { formatDate } from '../services/date';
import { Link } from 'react-router-dom';
import { NewTournamentModal } from '../components/NewTournamentModal';
import { TournamentFiltersModal, TournamentFilters } from '../components/TournamentFiltersModal';

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
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filters, setFilters] = useState<TournamentFilters>({
    name: '',
    system: '',
    participant_mode: '',
    date_from: '',
    date_to: '',
  });

  useEffect(() => {
    loadOverview();
    loadDictionaries();
  }, [filters]);

  const loadOverview = async (offset: number = 0, append: boolean = false) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      
      const params = new URLSearchParams({
        history_offset: offset.toString(),
        history_limit: '20',
      });
      
      // Добавляем фильтры
      if (filters.name) params.append('name', filters.name);
      if (filters.system) params.append('system', filters.system);
      if (filters.participant_mode) params.append('participant_mode', filters.participant_mode);
      if (filters.date_from) params.append('date_from', filters.date_from);
      if (filters.date_to) params.append('date_to', filters.date_to);
      
      const resp = await fetch(`/api/tournaments/overview/?${params.toString()}`);
      const data = await resp.json();
      const byDateDesc = (a: TournamentOverviewItem, b: TournamentOverviewItem) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
      
      setActiveTournaments((data.active || []).slice().sort(byDateDesc));
      
      if (append) {
        setHistoryTournaments(prev => [...prev, ...(data.history || [])]);
      } else {
        setHistoryTournaments((data.history || []).slice().sort(byDateDesc));
      }
      
      setHistoryHasMore(data.history_has_more || false);
      setHistoryTotal(data.history_total || 0);
      setHistoryOffset(data.history_offset || 0);
    } catch (e) {
      console.error('Ошибка загрузки турниров:', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
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
      let url = '/tournaments/new_knockout/'; // default
      if (payload.system === 'round_robin') {
        url = '/tournaments/new_round_robin/';
      } else if (payload.system === 'king') {
        url = '/tournaments/new_king/';
      } else if (payload.system === 'knockout') {
        url = '/tournaments/new_knockout/';
      }
      const { data } = await api.post(url, payload);
      if (!data.ok) throw new Error(data.error || 'Ошибка создания турнира');
      setShowModal(false);
      window.location.href = data.redirect;
    } catch (error: any) {
      alert(error.message);
    }
  };

  const handleApplyFilters = (newFilters: TournamentFilters) => {
    setFilters(newFilters);
    setHistoryOffset(0);
    setHistoryTournaments([]); // Очищаем предыдущие результаты
    loadOverview(0, false);
  };

  const handleLoadMore = () => {
    const newOffset = historyOffset + 20;
    setHistoryOffset(newOffset);
    loadOverview(newOffset, true);
  };

  if (loading) {
    return <div className="text-center py-8">Загрузка турниров...</div>;
  }

  const hasActiveFilters = filters.name || filters.system || filters.participant_mode || filters.date_from || filters.date_to;

  return (
    <div>
      <div className="flex justify-between items-center gap-3 flex-wrap mb-6">
        <h1 className="text-2xl font-bold m-0">Турниры</h1>
        <div className="flex items-center gap-2">
          <button 
            className="btn" 
            onClick={() => setShowFiltersModal(true)}
            style={{ 
              background: hasActiveFilters ? '#007bff' : undefined,
              borderColor: hasActiveFilters ? '#007bff' : undefined,
              color: hasActiveFilters ? '#fff' : undefined
            }}
          >
            {hasActiveFilters ? '🔍 Фильтры активны' : '🔍 Фильтры'}
          </button>
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
        ) : (
          <div className="flex flex-col gap-3">
            {activeTournaments.map(t => (
              <div key={t.id} className="card">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="m-0">{t.name}</h3>
                    <div className="meta">{formatDate(t.date)} • {t.get_system_display} • {t.get_participant_mode_display}</div>
                    
                  </div>
                  <Link
                    to={
                      t.system === 'round_robin'
                        ? `/tournaments/${t.id}/round_robin`
                        : t.system === 'king'
                          ? `/tournaments/${t.id}/king`
                          : `/tournaments/${t.id}/knockout`
                    }
                    className="btn"
                  >Открыть</Link>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="card">Пока нет активных турниров</div>
      )}

      <h2 className="section-title" style={{ marginTop: '20px' }}>
        Завершенные турниры
        {historyTotal > 0 && (
          <span style={{ fontSize: '14px', fontWeight: 'normal', marginLeft: '8px', color: '#666' }}>
            (показано {historyTournaments.length} из {historyTotal})
          </span>
        )}
      </h2>
      {historyTournaments.length > 0 ? (
        <>
          {viewMode === 'grid' ? (
            <div className="cards">
              {historyTournaments.map(t => (
                <div key={t.id} className="card">
                  <h3>{t.name}</h3>
                  <div className="meta">{formatDate(t.date)} • {t.get_system_display} • {t.get_participant_mode_display}</div>
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
                    >Открыть</Link>
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
          )}
          
          {historyHasMore && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
              <button 
                className="btn" 
                onClick={handleLoadMore}
                disabled={loadingMore}
                style={{ minWidth: '200px' }}
              >
                {loadingMore ? 'Загрузка...' : 'Загрузить еще'}
              </button>
            </div>
          )}
        </>
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

      {showFiltersModal && (
        <TournamentFiltersModal
          initialFilters={filters}
          onApply={handleApplyFilters}
          onClose={() => setShowFiltersModal(false)}
        />
      )}
    </div>
  );
};
