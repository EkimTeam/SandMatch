import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ratingApi } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend, ResponsiveContainer } from 'recharts';

interface LeaderboardRow {
  id: number;
  first_name?: string;
  display_name: string;
  last_name: string;
  current_rating: number;
  tournaments_count: number;
  matches_count: number;
  winrate?: number;
  rank?: number;
  last5: Array<{
    match_id: number;
    tournament_id: number;
    result: 'W' | 'L' | 'U';
    opponent?: string;
    partner?: string;
    score?: string;
    tournament_name?: string;
    tournament_date?: string; // ISO
  }>;
}

export const RatingPage: React.FC = () => {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [q, setQ] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // История по игрокам для графика
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [comparePlayerId, setComparePlayerId] = useState<number | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<any[] | null>(null);
  const [compareHistory, setCompareHistory] = useState<any[] | null>(null);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [asDelta, setAsDelta] = useState<boolean>(false);

  // Инициализация из URL
  useEffect(() => {
    const pageParam = parseInt(searchParams.get('page') || '1', 10);
    const qParam = searchParams.get('q') || '';
    setPage(Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1);
    setQ(qParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await ratingApi.leaderboard({ q, page, page_size: 20 });
        setRows(data.results || []);
        setTotalPages(data.total_pages || 1);
        // Выберем по умолчанию первого игрока для графика
        if (!selectedPlayerId && (data.results || []).length > 0) {
          setSelectedPlayerId((data.results || [])[0].id);
        }
      } catch (e: any) {
        setError(e?.response?.data?.error || 'Не удалось загрузить рейтинг');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [q, page]);

  // Сохраняем параметры в URL
  useEffect(() => {
    const params: any = {};
    if (q) params.q = q;
    if (page && page > 1) params.page = String(page);
    setSearchParams(params, { replace: true });
  }, [q, page, setSearchParams]);

  // Загрузка истории выбранного игрока
  useEffect(() => {
    const run = async () => {
      if (!selectedPlayerId) { setSelectedHistory(null); return; }
      try {
        const data = await ratingApi.playerHistory(selectedPlayerId);
        setSelectedHistory(data.history || []);
      } catch {
        setSelectedHistory([]);
      }
    };
    run();
  }, [selectedPlayerId]);

  // Загрузка истории второго игрока
  useEffect(() => {
    const run = async () => {
      if (!comparePlayerId) { setCompareHistory(null); return; }
      try {
        const data = await ratingApi.playerHistory(comparePlayerId);
        setCompareHistory(data.history || []);
      } catch {
        setCompareHistory([]);
      }
    };
    run();
  }, [comparePlayerId]);

  const chartData = useMemo(() => {
    const parse = (arr: any[] | null) => (arr || []).map((r) => ({
      date: r.tournament_date || r.tournament_id,
      value: asDelta ? (r.total_change || 0) : (r.rating_after || 0),
    }));
    // фильтр по датам
    const inRange = (d: string) => {
      if (!fromDate && !toDate) return true;
      const t = new Date(d).getTime();
      if (fromDate && t < new Date(fromDate).getTime()) return false;
      if (toDate && t > new Date(toDate).getTime()) return false;
      return true;
    };
    const a = parse(selectedHistory).filter((x) => inRange(x.date));
    const b = parse(compareHistory).filter((x) => inRange(x.date));
    // Нормализуем ось X (по дате)
    const allDates = Array.from(new Set([...a.map(x=>x.date), ...b.map(x=>x.date)])).sort();
    return allDates.map((d) => ({
      date: d,
      A: a.find(x => x.date === d)?.value ?? null,
      B: b.find(x => x.date === d)?.value ?? null,
    }));
  }, [selectedHistory, compareHistory, fromDate, toDate, asDelta]);

  // Статистика для оси Y: домен кратный 100 и тики с шагом 50
  const yAxis = useMemo(() => {
    const vals: number[] = [];
    for (const p of chartData) {
      if (typeof p.A === 'number') vals.push(p.A as number);
      if (typeof p.B === 'number') vals.push(p.B as number);
    }
    if (vals.length === 0) {
      return { domain: [0, 1000] as [number, number], ticks: [0, 200, 400, 600, 800, 1000] as number[] };
    }
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) { min -= 50; max += 50; }
    // Приведём к кратности 100
    const floor100 = (v: number) => Math.floor(v / 100) * 100;
    const ceil100 = (v: number) => Math.ceil(v / 100) * 100;
    const start = floor100(min);
    const end = ceil100(max);
    // Генерируем тики с шагом 50
    const ticks: number[] = [];
    for (let t = start; t <= end; t += 50) ticks.push(t);
    return { domain: [start, end] as [number, number], ticks };
  }, [chartData]);

  const selectedName = useMemo(() => {
    if (!selectedPlayerId) return '';
    const r = rows.find(x => x.id === selectedPlayerId);
    return r ? `${r.display_name} ${r.last_name}`.trim() : `Игрок ${selectedPlayerId}`;
  }, [rows, selectedPlayerId]);
  const compareName = useMemo(() => {
    if (!comparePlayerId) return '';
    const r = rows.find(x => x.id === comparePlayerId);
    return r ? `${r.display_name} ${r.last_name}`.trim() : `Игрок ${comparePlayerId}`;
  }, [rows, comparePlayerId]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">BeachPlay-Рейтинг (BP-Рейтинг)</h1>
          <div className="relative group">
            <button className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded bg-blue-600 text-white text-[11px] font-semibold" aria-label="Методика">i</button>
            <div className="absolute z-10 hidden group-hover:block bg-white border border-gray-200 rounded shadow p-3 text-sm w-80">
              Основан на модифицированной формуле Эло. Учитывается сила соперника и формат матча. Изменения применяются после завершения турнира. Короткие форматы имеют меньший вес.
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
          <div className="font-semibold">Таблица лидеров</div>
          <form className="flex items-center gap-2" onSubmit={(e)=>{ e.preventDefault(); setPage(1); setQ(q.trim()); }}>
            <input value={q} onChange={e=>setQ(e.target.value)} className="border rounded px-2 py-1 text-sm" placeholder="Поиск игрока" />
            <button type="submit" className="px-3 py-1 text-sm bg-blue-600 text-white rounded">Искать</button>
            <button type="button" className="px-3 py-1 text-sm bg-gray-100 rounded" onClick={()=>{ setQ(''); setPage(1); }}>Сброс</button>
          </form>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Игрок</th>
                <th className="px-3 py-2 text-right">Рейтинг</th>
                <th className="px-3 py-2 text-right">Турниров</th>
                <th className="px-3 py-2 text-right">Матчей</th>
                <th className="px-3 py-2 text-right">% побед</th>
                <th className="px-3 py-2 text-left">Последние 5 игр</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">Загрузка...</td></tr>
              )}
              {error && !loading && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-red-600">{error}</td></tr>
              )}
              {!loading && !error && rows.map((r, idx) => {
                const needsHighlight = r.tournaments_count < 5 || r.matches_count < 10;
                const placeTop = rows.length > 2 && (idx >= rows.length - 2);
                return (
                  <tr key={r.id} className={needsHighlight ? 'bg-yellow-50 cursor-pointer' : 'cursor-pointer'}
                      onClick={() => { setSelectedPlayerId(r.id); navigate(`/players/${r.id}`); }}>
                    <td className="px-3 py-2 align-middle text-gray-500">{r.rank ?? (idx + 1 + (page-1)*20)}</td>
                    <td className="px-3 py-2 align-middle">{r.last_name} {r.first_name || r.display_name}</td>
                    <td className="px-3 py-2 align-middle text-right font-semibold">{Math.round(r.current_rating)}</td>
                    <td className="px-3 py-2 align-middle text-right">{r.tournaments_count}</td>
                    <td className="px-3 py-2 align-middle text-right">{r.matches_count}</td>
                    <td className="px-3 py-2 align-middle text-right">{r.winrate ?? 0}%</td>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center gap-1 py-1">
                        {r.last5.map((m, i) => (
                          <LastBadge key={i} item={m} placement={placeTop ? 'top' : 'bottom'} />
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && !error && rows.length <= 2 && (
                <tr>
                  <td colSpan={7} className="py-6" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* пагинация */}
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm">
          <div>Стр. {page} из {totalPages}</div>
          <div className="flex items-center gap-2">
            <button disabled={page<=1} className="px-2 py-1 border rounded disabled:opacity-50" onClick={()=>setPage(p=>Math.max(1, p-1))}>Назад</button>
            <button disabled={page>=totalPages} className="px-2 py-1 border rounded disabled:opacity-50" onClick={()=>setPage(p=>Math.min(totalPages, p+1))}>Вперёд</button>
          </div>
        </div>
      </div>

      {/* График истории рейтинга */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
          <div className="font-semibold">История по турнирам</div>
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
            <label className="flex items-center gap-2">
              <span>Сравнить (ID)</span>
              <input type="number" className="border rounded px-2 py-1 w-24" value={comparePlayerId ?? ''} onChange={e=>setComparePlayerId(e.target.value ? Number(e.target.value) : null)} />
            </label>
          </div>
        </div>
        <div className="p-4" style={{height: 360}}>
          {selectedPlayerId ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} domain={yAxis.domain} ticks={yAxis.ticks} />
                <ReTooltip formatter={(val: any) => (typeof val === 'number' ? Math.round(val) : val)} />
                <Legend />
                <Line type="monotone" dataKey="A" name={`Рейтинг ${selectedName}${asDelta ? ' (Δ)' : ''}`} stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                {comparePlayerId && (
                  <Line type="monotone" dataKey="B" name={`Рейтинг ${compareName}${asDelta ? ' (Δ)' : ''}`} stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                )}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center text-gray-500">Выберите игрока из таблицы, чтобы увидеть график</div>
          )}
        </div>
      </div>
    </div>
  );
};

const LastBadge: React.FC<{ item: { match_id: number; tournament_id: number; result: 'W'|'L'|'U'; opponent?: string; partner?: string; score?: string; tournament_name?: string; tournament_date?: string }, placement?: 'top'|'bottom' }> = ({ item, placement = 'bottom' }) => {
  const color = item.result === 'W' ? 'bg-green-500' : item.result === 'L' ? 'bg-red-500' : 'bg-gray-400';
  const text = item.result === 'W' ? 'Победа' : item.result === 'L' ? 'Поражение' : 'Матч без результата';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const fmtDate = (d?: string) => {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yy = dt.getFullYear();
    return `${dd}.${mm}.${yy}`;
  };
  const shortName = (s?: string) => {
    if (!s) return '';
    return s.length > 15 ? `${s.slice(0, 15)}…` : s;
  };
  useEffect(() => {
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (!open) return;
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}
         onMouseEnter={() => setOpen(true)}
         onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={text}
        aria-expanded={open}
        className={`w-3.5 h-3.5 rounded-full ${color} shadow focus:outline-none focus:ring-2 focus:ring-blue-400`}
        onClick={() => setOpen(v => !v)}
      />
      {open && (
        <div className={`absolute z-10 ${placement === 'top' ? 'bottom-full mb-2' : 'mt-2'} right-0 w-64 max-w-[80vw] bg-white border border-gray-200 rounded shadow p-2 text-xs`}>
          <div className="font-medium mb-1">{text}</div>
          {(item.tournament_date || item.tournament_name) && (
            <div className="text-gray-600">
              {fmtDate(item.tournament_date)} {shortName(item.tournament_name)}
            </div>
          )}
          {item.opponent && (
            <div><span className="text-gray-500">Против:</span> {item.opponent}</div>
          )}
          {item.partner && (
            <div><span className="text-gray-500">Напарник:</span> {item.partner}</div>
          )}
          {item.score && (
            <div><span className="text-gray-500">Счёт:</span> {item.score}</div>
          )}
        </div>
      )}
    </div>
  );
};
