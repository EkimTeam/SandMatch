import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { playerApi, ratingApi, btrApi, Player } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend, ResponsiveContainer, LabelList } from 'recharts';

export const PlayerCardPage: React.FC = () => {
  const { id } = useParams();
  const playerId = Number(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [player, setPlayer] = useState<Player | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [matchDeltas, setMatchDeltas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<{ current_rating: number; last_delta: number; rank?: number } | null>(null);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [asDelta, setAsDelta] = useState<boolean>(false);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<Player[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [relations, setRelations] = useState<{ opponents: number[]; partners: Array<{ id: number; count: number }> }>({ opponents: [], partners: [] });
  const [playersList, setPlayersList] = useState<Player[]>([]);
  const [topWins, setTopWins] = useState<any[]>([]);
  const [btrInfo, setBtrInfo] = useState<{ btr_player_id: number | null; categories: Record<string, any> } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        // Получим игрока из списка (упростим до поиска по id)
        const list = await playerApi.getList();
        const p = list.find(x => x.id === playerId) || null;
        setPlayer(p);
        // Для анонимных пользователей не дергаем защищённые rating-* ручки, только публичный brief
        const br = await ratingApi.playerBriefs([playerId]);
        const one = (br.results || [])[0];
        setBrief(one ? { current_rating: one.current_rating, last_delta: one.last_delta, rank: one.rank } : null);

        // Загружаем BTR информацию по ID BP игрока
        try {
          const btr = await btrApi.playerByBpId(playerId);
          setBtrInfo(btr);
        } catch {
          setBtrInfo(null);
        }

        if (!user) {
          const list2 = await playerApi.getList();
          setPlayersList(list2);
          setHistory([]);
          setMatchDeltas([]);
          setRelations({ opponents: [], partners: [] });
          setTopWins([]);
          setError('Подробная история рейтинга доступна только авторизованным пользователям.');
          setLoading(false);
          return;
        }

        const h = await ratingApi.playerHistory(playerId);
        setHistory(h.history || []);
        const md = await ratingApi.playerMatchDeltas(playerId);
        setMatchDeltas(md.matches || []);
        const rel = await ratingApi.playerRelations(playerId);
        setRelations({ opponents: rel.opponents || [], partners: rel.partners || [] });
        const wins = await ratingApi.playerTopWins(playerId);
        setTopWins(wins.wins || []);
        const list2 = await playerApi.getList();
        setPlayersList(list2);
      } catch (e: any) {
        const status = e?.response?.status;
        // Для анонимных пользователей подсветим, что нужна авторизация
        if (!user && status === 401) {
          setError('Подробная история рейтинга доступна только авторизованным пользователям.');
        } else if (!user && status === 403) {
          setError('Доступ к подробной истории рейтинга запрещен.');
        } else {
          // Для авторизованных пользователей не показываем спец-сообщение про авторизацию,
          // а только общую ошибку, если она есть.
          const msg = e?.response?.data?.error || e?.message;
          if (msg) {
            setError(msg);
          }
        }
      } finally {
        setLoading(false);
      }
    };
    if (!isNaN(playerId)) {
      load();
    }
  }, [playerId, user]);

  const filteredHistory = useMemo(() => {
    const inRange = (d: string) => {
      if (!fromDate && !toDate) return true;
      const t = new Date(d).getTime();
      if (fromDate && t < new Date(fromDate).getTime()) return false;
      if (toDate && t > new Date(toDate).getTime()) return false;
      return true;
    };
    return (history || []).filter((r) => r.tournament_date && inRange(r.tournament_date));
  }, [history, fromDate, toDate]);

  // Данные графика: точки по датам турниров
  const chartData = useMemo(() => {
    return (filteredHistory || []).map(r => ({
      date: r.tournament_date,
      value: asDelta ? r.total_change : r.rating_after,
      delta: r.total_change,
    })).filter(p => !!p.date);
  }, [filteredHistory, asDelta]);

  const DeltaLabel: React.FC<any> = ({ x, y, value }) => {
    if (typeof value !== 'number' || x == null || y == null) return null;
    const color = value > 0 ? '#16a34a' : value < 0 ? '#ef4444' : '#6b7280';
    const text = `${value >= 0 ? '+' : ''}${Number(value).toFixed(1)}`;
    return (
      <g>
        <text x={x} y={y - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill={color}>
          {text}
        </text>
      </g>
    );
  };

  const formatDateDMY = (val: any) => {
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yy = String(d.getFullYear()).slice(-2);
      return `${dd}.${mm}.${yy}`;
    } catch {
      return String(val);
    }
  };

  const renderDelta = (v: any) => {
    const val = Number(v) || 0;
    const color = val > 0 ? 'text-green-600' : val < 0 ? 'text-red-600' : 'text-gray-600';
    const arrow = val > 0 ? '▲' : val < 0 ? '▼' : '•';
    const sign = val > 0 ? '+' : '';
    return <span className={`font-semibold ${color}`}>{arrow} {sign}{Math.round(val)}</span>;
  };

  const systemLabel = (s: string) => s === 'round_robin' ? 'круговой' : s === 'knockout' ? 'олимпийка' : s === 'king' ? 'кинг' : s || '';
  const modeLabel = (m: string) => m === 'singles' ? 'индивидуальный' : m === 'doubles' ? 'парный' : m || '';

  // Ось Y — ручной domain/ticks с шагом 50
  const yAxis = useMemo(() => {
    const vals = chartData.map(p => p.value).filter((v) => typeof v === 'number') as number[];
    if (vals.length === 0) return { domain: [0, 1000] as [number, number], ticks: [0, 200, 400, 600, 800, 1000] };
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) { min -= 50; max += 50; }
    const floor50 = (v: number) => Math.floor(v / 50) * 50;
    const ceil50 = (v: number) => Math.ceil(v / 50) * 50;
    const start = floor50(min);
    const end = ceil50(max);
    const ticks: number[] = [];
    for (let t = start; t <= end; t += 50) ticks.push(t);
    return { domain: [start, end] as [number, number], ticks };
  }, [chartData]);

  const stats = useMemo(() => {
    const arr = filteredHistory;
    if (!arr.length) return { current: 0, max: 0, min: 0, count: 0, totalDelta: 0 };
    const values = arr.map(r => r.rating_after);
    const current = arr[arr.length - 1].rating_after;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const count = arr.length;
    const totalDelta = arr.reduce((s, r) => s + (r.total_change || 0), 0);
    return { current, max, min, count, totalDelta };
  }, [filteredHistory]);

  const topTournaments = useMemo(() => {
    return [...filteredHistory]
      .sort((a, b) => (b.total_change || 0) - (a.total_change || 0))
      .slice(0, 5);
  }, [filteredHistory]);

  // topWins теперь приходит с backend через ratingApi.playerTopWins


  const playerFullName = useMemo(() => player ? `${player.last_name} ${player.first_name}` : `Игрок #${playerId}`, [player, playerId]);

  const flipScore = (score: string) => {
    try {
      if (!score) return score;
      return score.replace(/(\d+):(\d+)/g, (_: any, a: string, b: string) => `${b}:${a}`);
    } catch {
      return score;
    }
  };

  // Группируем матчи по турнирам и считаем суммарную дельту; сортируем по дате турнира (новые первыми)
  const tournamentsPlayed = useMemo(() => {
    const map: Record<string, any> = {};
    for (const m of matchDeltas) {
      const tid = m.tournament_id;
      if (!tid) continue;
      if (!map[tid]) {
        map[tid] = {
          tournament_id: tid,
          tournament_name: m.tournament_name,
          tournament_date: m.tournament_date || '',
          tournament_system: m.tournament_system || '',
          participant_mode: m.participant_mode || '',
          total_delta: 0,
          matches: [] as any[],
        };
      }
      map[tid].total_delta += Number(m.delta || 0);
      const team1: Array<number|null> = Array.isArray(m.team1) ? m.team1 : [];
      const team2: Array<number|null> = Array.isArray(m.team2) ? m.team2 : [];
      const playerInTeam1 = team1.includes(playerId);
      const leftName = playerInTeam1 ? (m.partner ? `${playerFullName} + ${m.partner}` : playerFullName) : (m.partner ? `${playerFullName} + ${m.partner}` : playerFullName);
      const rightName = (() => {
        const base = m.opponent || '';
        const oppCount = (playerInTeam1 ? team2 : team1).filter((x: any) => !!x).length;
        if (oppCount > 1) return base.replace(' vs ', ' + ');
        return base;
      })();
      const score = playerInTeam1 ? (m.score || '') : flipScore(m.score || '');
      const left_rating = playerInTeam1 ? (m.team1_avg_before ?? null) : (m.team2_avg_before ?? null);
      const right_rating = playerInTeam1 ? (m.team2_avg_before ?? null) : (m.team1_avg_before ?? null);
      map[tid].matches.push({
        match_id: m.match_id,
        left: leftName,
        right: rightName,
        score,
        delta: Number(m.delta || 0),
        finished_at: m.finished_at || '',
        left_rating,
        right_rating,
      });
    }
    // Отсортируем матчи внутри каждого турнира по finished_at, затем по match_id (по возрастанию)
    Object.values(map).forEach((t: any) => {
      t.matches.sort((a: any, b: any) => {
        const ta = a.finished_at ? new Date(a.finished_at).getTime() : 0;
        const tb = b.finished_at ? new Date(b.finished_at).getTime() : 0;
        if (ta !== tb) return ta - tb;
        return (a.match_id || 0) - (b.match_id || 0);
      });
    });
    let list = Object.values(map);
    list.sort((a: any, b: any) => new Date(b.tournament_date || 0).getTime() - new Date(a.tournament_date || 0).getTime());
    return list as Array<{
      tournament_id: number;
      tournament_name: string;
      tournament_date: string;
      tournament_system: string;
      participant_mode: string;
      total_delta: number;
      matches: Array<{ match_id: number; left: string; right: string; score: string; delta: number; finished_at?: string; left_rating?: number | null; right_rating?: number | null }>;
    }>;
  }, [matchDeltas, playerFullName, playerId]);

  const [tpVisible, setTpVisible] = useState(5);
  const shownTournaments = useMemo(() => tournamentsPlayed.slice(0, tpVisible), [tournamentsPlayed, tpVisible]);
  const canLoadMoreTP = tpVisible < tournamentsPlayed.length;

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    const list = await playerApi.search(q);
    if (list && list.length) navigate(`/players/${list[0].id}`);
  };

  // Дебаунс для подсказок
  useEffect(() => {
    const q = search.trim();
    if (!q) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      try {
        const list = await playerApi.search(q);
        setSuggestions(list.slice(0, 8));
        setShowSuggest(true);
      } catch {
        setSuggestions([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [search]);
  
  if (loading) return <div className="text-center py-8">Загрузка…</div>;

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
          {error}
        </div>
      )}
      {/* Заголовок */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold">{player ? `${player.last_name} ${player.first_name}` : `Игрок #${playerId}`}</h1>
          {brief && (
            <div className="flex items-baseline gap-2 text-gray-700 flex-wrap">
              {typeof brief.rank === 'number' && (
                <span className="text-sm text-gray-500"># {brief.rank}</span>
              )}
              <span className="inline-flex items-baseline gap-1">
                <span className="text-xl font-bold leading-none">{brief.current_rating ?? 0}</span>
                <span className="text-[10px] leading-none opacity-70">BP</span>
              </span>
              {btrInfo && btrInfo.btr_player_id && Object.keys(btrInfo.categories).length > 0 && (
                <>
                  <span className="text-gray-400">•</span>
                  <span 
                    className="inline-flex items-baseline gap-2 cursor-pointer hover:opacity-80"
                    onClick={() => navigate(`/btr/players/${btrInfo.btr_player_id}`)}
                    title="Перейти к BTR профилю"
                  >
                    {Object.entries(btrInfo.categories).map(([catCode, catData]) => {
                      const shortLabel = catCode === 'men_double' ? 'M' : 
                                        catCode === 'men_mixed' ? 'MX' : 
                                        catCode === 'junior_male' ? 'MU' :
                                        catCode === 'women_double' ? 'W' :
                                        catCode === 'women_mixed' ? 'WX' :
                                        catCode === 'junior_female' ? 'WU' : catCode;
                      return (
                        <span key={catCode} className="inline-flex items-baseline gap-1">
                          <span className="text-xl font-bold leading-none">{Math.round(catData.current_rating)}</span>
                          <span className="text-[10px] leading-none opacity-70">BTR {shortLabel}</span>
                          {catData.rank && (
                            <span className="text-[10px] leading-none opacity-70">(#{catData.rank})</span>
                          )}
                        </span>
                      );
                    })}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="relative group">
          <button className="opacity-50 cursor-not-allowed pointer-events-none inline-flex items-center justify-center w-8 h-8 rounded border" title="Редактировать игрока">✎</button>
          <div className="absolute z-10 hidden group-hover:block right-0 mt-1 bg-white border border-gray-200 rounded shadow p-2 text-xs">Редактировать игрока</div>
        </div>
      </div>

      {/* Поиск сравнения временно отключён */}

      {/* График */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
          <div className="font-semibold">BP-Рейтинг. История по турнирам</div>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span>От</span>
              <input type="date" className="border rounded px-2 py-1" value={fromDate} onChange={e=>setFromDate(e.target.value)} />
            </label>
            <label className="flex items-center gap-2">
              <span>До</span>
              <input type="date" className="border rounded px-2 py-1" value={toDate} onChange={e=>setToDate(e.target.value)} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={asDelta} onChange={e=>setAsDelta(e.target.checked)} />
              <span>Дельта</span>
            </label>
          </div>
        </div>
        <div className="p-4" style={{height: 360}}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 12, right: 24, left: 0, bottom: 72 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={formatDateDMY} angle={-45} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 12 }} domain={yAxis.domain} ticks={yAxis.ticks} />
              <ReTooltip formatter={(val: any) => (typeof val === 'number' ? Math.round(val) : val)} />
              <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: 8 }} />
              <Line type="monotone" dataKey="value" name={`Рейтинг BP ${player ? `${player.last_name} ${player.first_name}` : ''}${asDelta ? ' (Δ)' : ''}`} stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }}>
                {!asDelta && (
                  <LabelList dataKey="delta" content={<DeltaLabel />} />
                )}
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Статистика под графиком */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-600">Текущий рейтинг</div>
          <div className="text-2xl font-bold">{Math.round(stats.current)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-600">Макс. рейтинг</div>
          <div className="text-2xl font-bold">{Math.round(stats.max)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-600">Мин. рейтинг</div>
          <div className="text-2xl font-bold">{Math.round(stats.min)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-600">Всего турниров</div>
          <div className="text-2xl font-bold">{stats.count}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-600">Общее изменение</div>
          <div className="text-2xl font-bold">{Math.round(stats.totalDelta)}</div>
        </div>
      </div>

      {/* Топ-5 турниров по изменению рейтинга */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 font-semibold">Топ-5 турниров по изменению рейтинга</div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="px-3 py-2 text-left">Турнир</th>
                <th className="px-3 py-2 text-left">Дата</th>
                <th className="px-3 py-2 text-right">Δ</th>
                <th className="px-3 py-2 text-right">Матчей</th>
              </tr>
            </thead>
            <tbody>
              {topTournaments.map((r, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-blue-600 hover:underline cursor-pointer" onClick={()=>navigate(`/tournaments/${r.tournament_id}`)}>{r.tournament__name}</td>
                  <td className="px-3 py-2">{new Date(r.tournament_date).toLocaleDateString('ru-RU')}</td>
                  <td className="px-3 py-2 text-right">{renderDelta(r.total_change)}</td>
                  <td className="px-3 py-2 text-right">{r.matches_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Топ-5 побед */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 font-semibold">Топ-5 побед</div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="px-3 py-2 text-left">Турнир</th>
                <th className="px-3 py-2 text-left">Дата</th>
                <th className="px-3 py-2 text-right">Δ (матч)</th>
                <th className="px-3 py-2 text-left">Противники</th>
                <th className="px-3 py-2 text-left">Напарник</th>
              </tr>
            </thead>
            <tbody>
              {topWins.map((m, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-blue-600 hover:underline cursor-pointer" onClick={()=>navigate(`/tournaments/${m.tournament_id}`)}>{m.tournament_name}</td>
                  <td className="px-3 py-2">{m.tournament_date ? new Date(m.tournament_date).toLocaleDateString('ru-RU') : ''}</td>
                  <td className="px-3 py-2 text-right">{renderDelta(m.delta)}</td>
                  <td className="px-3 py-2">{(m.opponent || '').replace(' vs ', ' + ')}</td>
                  <td className="px-3 py-2">{m.partner}</td>
                </tr>
              ))}
              {topWins.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">Нет данных</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Уникальные противники */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-200 font-semibold">Количество уникальных противников: {relations.opponents.length}</div>
        <details className="p-4">
          <summary className="cursor-pointer select-none text-sm text-gray-600">Показать список</summary>
          <ul className="mt-2 list-disc pl-6">
            {[...relations.opponents].sort((a,b)=>{
              const an = (playersList.find(p=>p.id===a)?.last_name || '') + ' ' + (playersList.find(p=>p.id===a)?.first_name || '');
              const bn = (playersList.find(p=>p.id===b)?.last_name || '') + ' ' + (playersList.find(p=>p.id===b)?.first_name || '');
              return an.localeCompare(bn, 'ru');
            }).map((oppId) => (
              <li key={oppId} className="py-0.5">
                {(playersList.find(p=>p.id===oppId)?.last_name || `#${oppId}`)} {(playersList.find(p=>p.id===oppId)?.first_name || '')} — <button className="text-blue-600 hover:underline" onClick={()=>navigate(`/players/h2h/${playerId}/${oppId}`)}>история игр</button>
              </li>
            ))}
          </ul>
        </details>
      </div>

      {/* Уникальные напарники */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-200 font-semibold">Количество уникальных напарников: {relations.partners.length}</div>
        <details className="p-4">
          <summary className="cursor-pointer select-none text-sm text-gray-600">Показать список</summary>
          <ul className="mt-2 list-disc pl-6">
            {[...relations.partners].sort((a,b)=>{
              const an = (playersList.find(p=>p.id===a.id)?.last_name || '') + ' ' + (playersList.find(p=>p.id===a.id)?.first_name || '');
              const bn = (playersList.find(p=>p.id===b.id)?.last_name || '') + ' ' + (playersList.find(p=>p.id===b.id)?.first_name || '');
              return an.localeCompare(bn, 'ru');
            }).map(({id,count}) => (
              <li key={id} className="py-0.5">{(playersList.find(p=>p.id===id)?.last_name || `#${id}`)} {(playersList.find(p=>p.id===id)?.first_name || '')} — {count} совместных матчей</li>
            ))}
          </ul>
        </details>
      </div>

      {/* Сыгранные турниры */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 font-semibold">Сыгранные турниры</div>
        <div className="divide-y">
          {shownTournaments.map((t) => (
            <details key={t.tournament_id} className="p-4">
              <summary className="cursor-pointer select-none flex items-center justify-between gap-3">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-blue-600 hover:underline cursor-pointer" onClick={() => navigate(`/tournaments/${t.tournament_id}`)}>{t.tournament_name}</span>
                  <span className="text-sm text-gray-600">{t.tournament_date ? new Date(t.tournament_date).toLocaleDateString('ru-RU') : ''}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">Тип: {systemLabel(t.tournament_system)}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">Формат: {modeLabel(t.participant_mode)}</span>
                  <span className="text-xs text-gray-500">▶ нажмите, чтобы раскрыть</span>
                </div>
                <div>
                  {renderDelta(t.total_delta)}
                </div>
              </summary>
              <div className="mt-3 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-600">
                      <th className="px-3 py-2 text-left">Участник 1</th>
                      <th className="px-3 py-2 text-center">Счёт</th>
                      <th className="px-3 py-2 text-left">Участник 2</th>
                      <th className="px-3 py-2 text-right">Δ (матч)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.matches.map((m) => (
                      <tr key={m.match_id}>
                        <td className="px-3 py-2">{m.left} {typeof m.left_rating === 'number' ? (<span className="text-xs text-gray-600">— {Math.round(m.left_rating)} <span className="opacity-70">BP</span></span>) : null}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">{m.score}</td>
                        <td className="px-3 py-2">{m.right} {typeof m.right_rating === 'number' ? (<span className="text-xs text-gray-600">— {Math.round(m.right_rating)} <span className="opacity-70">BP</span></span>) : null}</td>
                        <td className="px-3 py-2 text-right">{renderDelta(m.delta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
          {shownTournaments.length === 0 && (
            <div className="p-4 text-center text-gray-500">Нет данных</div>
          )}
        </div>
        {canLoadMoreTP && (
          <div className="p-3 border-t border-gray-200 text-center">
            <button className="inline-flex items-center px-3 py-1.5 border rounded hover:bg-gray-50" onClick={() => setTpVisible(v => v + 5)}>Загрузить ещё</button>
          </div>
        )}
      </div>
    </div>
  );
};
