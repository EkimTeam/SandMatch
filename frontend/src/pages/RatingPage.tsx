import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ratingApi } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend, ResponsiveContainer } from 'recharts';

interface LeaderboardRow {
  id: number;
  display_name: string;
  last_name: string;
  current_rating: number;
  tournaments_count: number;
  matches_count: number;
  last5: Array<{ match_id: number; tournament_id: number; result: 'W' | 'L' | 'U' }>;
}

export const RatingPage: React.FC = () => {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Фильтры таблицы
  const [fHard, setFHard] = useState<boolean>(false);
  const [FMedium, setFMedium] = useState<boolean>(false);
  const [fTBO, setFTBO] = useState<boolean>(false);
  // История по игрокам для графика
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [comparePlayerId, setComparePlayerId] = useState<number | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<any[] | null>(null);
  const [compareHistory, setCompareHistory] = useState<any[] | null>(null);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [asDelta, setAsDelta] = useState<boolean>(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await ratingApi.leaderboard({ hard: fHard, medium: FMedium, tiebreak_only: fTBO });
        setRows(data.results || []);
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
  }, [fHard, FMedium, fTBO]);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Рейтинг</h1>
        <p className="text-gray-600 text-sm max-w-3xl">
          Система основана на модифицированной формуле Эло: учитывается сила соперников и формат матча.
          Изменения рейтинга применяются после завершения турнира. Короткие форматы (например, только тай-брейк)
          имеют меньший вес, полноценные матчи — больший. Стартовые рейтинги назначаются автоматически и могут быть
          переопределены администратором при пересчёте.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
          <div className="font-semibold">Таблица лидеров</div>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={fHard} onChange={e=>setFHard(e.target.checked)} />
              <span>HARD</span>
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={FMedium} onChange={e=>setFMedium(e.target.checked)} />
              <span>MEDIUM</span>
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={fTBO} onChange={e=>setFTBO(e.target.checked)} />
              <span>Только тайбрейк</span>
            </label>
            <div className="text-xs text-gray-500">Клик по строке — показать график</div>
          </div>
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
                <th className="px-3 py-2 text-left">Последние 5</th>
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
                return (
                  <tr key={r.id} className={needsHighlight ? 'bg-yellow-50 cursor-pointer' : 'cursor-pointer'}
                      onClick={() => setSelectedPlayerId(r.id)}>
                    <td className="px-3 py-2 align-middle text-gray-500">{idx + 1}</td>
                    <td className="px-3 py-2 align-middle">{r.display_name} {r.last_name}</td>
                    <td className="px-3 py-2 align-middle text-right font-semibold">{Math.round(r.current_rating)}</td>
                    <td className="px-3 py-2 align-middle text-right">{r.tournaments_count}</td>
                    <td className="px-3 py-2 align-middle text-right">{r.matches_count}</td>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center gap-1">
                        {r.last5.map((m, i) => (
                          <LastBadge key={i} item={m} />
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
                <YAxis tick={{ fontSize: 12 }} domain={['dataMin - 10', 'dataMax + 10']} />
                <ReTooltip formatter={(val: any) => (typeof val === 'number' ? Math.round(val) : val)} />
                <Legend />
                <Line type="monotone" dataKey="A" name={`Игрок ${selectedPlayerId}${asDelta ? ' (Δ)' : ''}`} stroke="#2563eb" strokeWidth={2} dot={false} />
                {comparePlayerId && (
                  <Line type="monotone" dataKey="B" name={`Игрок ${comparePlayerId}${asDelta ? ' (Δ)' : ''}`} stroke="#16a34a" strokeWidth={2} dot={false} />
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

const LastBadge: React.FC<{ item: { match_id: number; tournament_id: number; result: 'W'|'L'|'U' } }> = ({ item }) => {
  const color = item.result === 'W' ? 'bg-green-500' : item.result === 'L' ? 'bg-red-500' : 'bg-gray-400';
  const text = item.result === 'W' ? 'Победа' : item.result === 'L' ? 'Поражение' : 'Матч без результата';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
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
        <div className="absolute z-10 mt-2 left-0 w-64 max-w-[80vw] bg-white border border-gray-200 rounded shadow p-2 text-xs">
          <div className="font-medium mb-1">{text}</div>
          <div>Матч #{item.match_id}</div>
          <div>Турнир #{item.tournament_id}</div>
        </div>
      )}
    </div>
  );
};
