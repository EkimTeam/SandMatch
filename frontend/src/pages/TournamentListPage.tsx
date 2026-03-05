import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { formatDate } from '../services/date';
import { Link } from 'react-router-dom';
import { NewTournamentModal } from '../components/NewTournamentModal';
import { TournamentFiltersModal, TournamentFilters } from '../components/TournamentFiltersModal';
import { useAuth } from '../context/AuthContext';

interface TournamentOverviewItem {
  id: number;
  name: string;
  date: string;
  system: string;
  participant_mode: string;
  status: string;
  get_system_display: string;
  get_participant_mode_display: string;
  organizer_name?: string;
  participants_count?: number;
  avg_rating_bp?: number | null;
  avg_rating_visible?: number | null;
  rating_visible?: string;
  planned_participants?: number | null;
  groups_count?: number;
  rating_coefficient?: number | null;
  prize_fund?: string | null;
  winner?: string | null;
}

interface SetFormat { id: number; name: string; }
interface Ruleset { id: number; name: string; }

export const TournamentListPage: React.FC = () => {
  const { user } = useAuth();
  const canCreateTournament = user && (user.role === 'ADMIN' || user.role === 'ORGANIZER');
  const isRefereeOnly = user?.role === 'REFEREE';
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyTotal, setHistoryTotal] = useState(0);
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

      const { data } = await api.get(`/tournaments/overview/?${params.toString()}`);
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
        api.get('/set-formats/'),
        api.get('/rulesets/'),
      ]);
      setSetFormats(fResp.data.set_formats || []);
      setRulesets(rResp.data.rulesets || []);
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

  const renderStatus = (status: string) => {
    if (status === 'created') return 'Регистрация';
    if (status === 'active') return 'Идёт';
    if (status === 'completed') return 'Завершён';
    return status;
  };

  const renderCardMetaExtra = (t: TournamentOverviewItem) => {
    const avgRaw = (typeof t.avg_rating_visible === 'number')
      ? t.avg_rating_visible
      : (typeof t.avg_rating_bp === 'number' ? t.avg_rating_bp : null);
    const avg = typeof avgRaw === 'number' ? Math.round(avgRaw) : null;
    const coef = typeof t.rating_coefficient === 'number' ? t.rating_coefficient.toFixed(1) : null;
    const prize = t.prize_fund ? t.prize_fund.trim() : null;
    
    // Для турниров в статусе "created" не показываем коэффициент и средний рейтинг
    const showRatingInfo = t.status !== 'created';
    
    return (
      <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 11, color: '#555', flexWrap: 'wrap' }}>
        <span>Статус: {renderStatus(t.status)}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {showRatingInfo && avg !== null && (
            <span
              style={{
                fontWeight: 600,
                color: '#111827',
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 9999,
                border: '1px solid #e5e7eb',
                background: '#f9fafb',
                whiteSpace: 'nowrap',
              }}
            >
              ср. рейтинг: {avg}
            </span>
          )}
          {showRatingInfo && coef !== null && (
            <span
              style={{
                fontWeight: 600,
                color: '#111827',
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 9999,
                border: '1px solid #e5e7eb',
                background: '#f9fafb',
                whiteSpace: 'nowrap',
              }}
            >
              COEF: {coef}
            </span>
          )}
          {prize && (
            <span
              style={{
                fontWeight: 600,
                color: '#111827',
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 9999,
                border: '1px solid #e5e7eb',
                background: '#f9fafb',
                whiteSpace: 'nowrap',
              }}
            >
              $={prize}
            </span>
          )}
        </div>
      </div>
    );
  };

  if (isRefereeOnly) {
    return (
      <div className="card">
        Этот список турниров недоступен для роли судьи. Пожалуйста, используйте раздел
        {' '}
        <span className="font-semibold">"Судейство"</span>
        {' '}для перехода к вашим турнирам.
      </div>
    );
  }

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
              className={`px-3 py-2 text-sm flex items-center justify-center gap-1 ${viewMode === 'grid' ? 'bg-gray-100' : 'bg-white'}`}
              onClick={() => setViewMode('grid')}
              title="Плитка"
            >
              <span className="inline md:hidden" aria-hidden="true">▦</span>
              <span className="hidden md:inline">Плитка</span>
            </button>
            <button
              className={`px-3 py-2 text-sm flex items-center justify-center gap-1 ${viewMode === 'list' ? 'bg-gray-100' : 'bg-white'}`}
              onClick={() => setViewMode('list')}
              title="Список"
            >
              <span className="inline md:hidden" aria-hidden="true">≡</span>
              <span className="hidden md:inline">Список</span>
            </button>
          </div>
          {canCreateTournament && (
            <button className="btn" onClick={() => setShowModal(true)}>Начать новый турнир</button>
          )}
        </div>
      </div>

      <h2 className="section-title">Активные</h2>
      {activeTournaments.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="cards">
            {activeTournaments.map(t => (
              <div key={t.id} className="card">
                <h3>{t.name}</h3>
                <div className="meta">
                  {formatDate(t.date)} • {t.get_system_display}
                  {' • '}
                  <span
                    aria-label={t.participant_mode === 'doubles' ? 'Парный турнир' : 'Индивидуальный турнир'}
                    title={t.participant_mode === 'doubles' ? 'Парный турнир' : 'Индивидуальный турнир'}
                  >
                    {t.participant_mode === 'doubles' ? '👥' : '👤'}
                  </span>
                  {' '}
                  <span style={{ fontSize: 13 }}>
                    {t.status === 'created'
                      ? `${typeof t.participants_count === 'number' ? t.participants_count : 0}/${typeof t.planned_participants === 'number' ? t.planned_participants : '-'}`
                      : (typeof t.participants_count === 'number' ? t.participants_count : '-')}
                    {((t.system === 'round_robin' || t.system === 'king') && typeof t.groups_count === 'number' && t.groups_count >= 1)
                      ? ` • групп: ${t.groups_count}`
                      : ''}
                  </span>
                  {t.organizer_name ? ` • Организатор: ${t.organizer_name}` : ''}
                </div>
                {renderCardMetaExtra(t)}
                
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
                    <div className="meta">
                      {formatDate(t.date)} • {t.get_system_display}
                      {' • '}
                      <span
                        aria-label={t.participant_mode === 'doubles' ? 'Парный турнир' : 'Индивидуальный турнир'}
                        title={t.participant_mode === 'doubles' ? 'Парный турнир' : 'Индивидуальный турнир'}
                      >
                        {t.participant_mode === 'doubles' ? '👥' : '👤'}
                      </span>
                      {' '}
                      <span style={{ fontSize: 13 }}>
                        {t.status === 'created'
                          ? `${typeof t.participants_count === 'number' ? t.participants_count : 0}/${typeof t.planned_participants === 'number' ? t.planned_participants : '-'}`
                          : (typeof t.participants_count === 'number' ? t.participants_count : '-')}
                        {((t.system === 'round_robin' || t.system === 'king') && typeof t.groups_count === 'number' && t.groups_count >= 1)
                          ? ` • групп: ${t.groups_count}`
                          : ''}
                      </span>
                      {t.organizer_name ? ` • Организатор: ${t.organizer_name}` : ''}
                    </div>
                    {renderCardMetaExtra(t)}
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
                  <div className="meta">
                    {formatDate(t.date)} • {t.get_system_display}
                    {' • '}
                    <span
                      aria-label={t.participant_mode === 'doubles' ? 'Парный турнир' : 'Индивидуальный турнир'}
                      title={t.participant_mode === 'doubles' ? 'Парный турнир' : 'Индивидуальный турнир'}
                    >
                      {t.participant_mode === 'doubles' ? '👥' : '👤'}
                    </span>
                    {' '}
                    <span style={{ fontSize: 13 }}>
                      {t.status === 'created'
                        ? `${typeof t.participants_count === 'number' ? t.participants_count : 0}/${typeof t.planned_participants === 'number' ? t.planned_participants : '-'}`
                        : (typeof t.participants_count === 'number' ? t.participants_count : '-')}
                      {((t.system === 'round_robin' || t.system === 'king') && typeof t.groups_count === 'number' && t.groups_count >= 1)
                        ? ` • групп: ${t.groups_count}`
                        : ''}
                    </span>
                    {t.organizer_name ? ` • Организатор: ${t.organizer_name}` : ''}
                  </div>
                  {renderCardMetaExtra(t)}
                  {t.winner && (
                    <div style={{ marginTop: 6, fontSize: 12, color: '#374151' }}>
                      🥇 Победитель: {t.winner}
                    </div>
                  )}
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
                      <div className="meta">
                        {formatDate(t.date)} • {t.get_system_display}
                        {' • '}
                        <span
                          aria-label={t.participant_mode === 'doubles' ? 'Парный турнир' : 'Индивидуальный турнир'}
                          title={t.participant_mode === 'doubles' ? 'Парный турнир' : 'Индивидуальный турнир'}
                        >
                          {t.participant_mode === 'doubles' ? '👥' : '👤'}
                        </span>
                        {' '}
                        <span style={{ fontSize: 13 }}>
                          {t.status === 'created'
                            ? `${typeof t.participants_count === 'number' ? t.participants_count : 0}/${typeof t.planned_participants === 'number' ? t.planned_participants : '-'}`
                            : (typeof t.participants_count === 'number' ? t.participants_count : '-')}
                          {((t.system === 'round_robin' || t.system === 'king') && typeof t.groups_count === 'number' && t.groups_count >= 1)
                            ? ` • групп: ${t.groups_count}`
                            : ''}
                        </span>
                        {t.organizer_name ? ` • Организатор: ${t.organizer_name}` : ''}
                      </div>
                      {renderCardMetaExtra(t)}
                      {t.winner && (
                        <div style={{ marginTop: 6, fontSize: 12, color: '#374151' }}>
                          🥇 Победитель: {t.winner}
                        </div>
                      )}
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
        <div className="card">
          {user
            ? 'История пока пуста'
            : 'Зарегистрируйтесь, чтобы видеть завершенные турниры'}
        </div>
      )}

      {canCreateTournament && showModal && (
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
