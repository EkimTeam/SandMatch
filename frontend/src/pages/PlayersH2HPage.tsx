import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { playerApi, ratingApi, Player } from '../services/api';

export const PlayersH2HPage: React.FC = () => {
  const { id1, id2 } = useParams();
  const aId = Number(id1);
  const bId = Number(id2);
  const navigate = useNavigate();

  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [sortField, setSortField] = useState<'date' | 'delta'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState<number>(1);
  const pageSize = 25;


  const idToName = useMemo(() => {
    const map = new Map<number, string>();
    players.forEach(p => map.set(p.id, `${p.last_name} ${p.first_name}`.trim()));
    return map;
  }, [players]);

  const teamToLabel = (ids: (number|null)[]) => {
    const filtered = (ids || []).filter(Boolean) as number[];
    if (filtered.length === 0) return '';
    return filtered.map(pid => idToName.get(pid) || `#${pid}`).join(' + ');
  };

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const list = await playerApi.getList();
        setPlayers(list);
        if (!isNaN(aId) && !isNaN(bId) && aId > 0 && bId > 0 && aId !== bId) {
          const data = await ratingApi.h2h(aId, bId);
          setRows(data.matches || []);
        } else {
          setRows([]);
        }
      } catch (e: any) {
        setError(e?.response?.data?.error || 'Не удалось загрузить H2H');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [aId, bId]);


  const aName = idToName.get(aId) || (aId ? `#${aId}` : '—');
  const bName = idToName.get(bId) || (bId ? `#${bId}` : '—');

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((r1, r2) => {
      if (sortField === 'date') {
        const t1 = r1.tournament_date ? new Date(r1.tournament_date).getTime() : 0;
        const t2 = r2.tournament_date ? new Date(r2.tournament_date).getTime() : 0;
        return sortDir === 'asc' ? t1 - t2 : t2 - t1;
      } else {
        const d1 = r1.delta_for_a || 0;
        const d2 = r2.delta_for_a || 0;
        return sortDir === 'asc' ? d1 - d2 : d2 - d1;
      }
    });
    return copy;
  }, [rows, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page]);

  if (loading) return <div className="text-center py-8">Загрузка…</div>;
  if (error) return <div className="text-center py-8 text-red-600">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">{aName} vs {bName}</h1>
      </div>

      {/* Таблица матчей */}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 font-semibold">Все матчи {aName} vs {bName}</div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={()=>{ setPage(1); setSortField('date'); setSortDir(d=> (sortField==='date' && d==='desc') ? 'asc' : 'desc'); }}>Дата {sortField==='date' ? (sortDir==='desc' ? '↓' : '↑') : ''}</th>
                <th className="px-3 py-2 text-left">Турнир</th>
                <th className="px-3 py-2 text-left">Пара 1</th>
                <th className="px-3 py-2 text-left">Счёт</th>
                <th className="px-3 py-2 text-left">Пара 2</th>
                <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={()=>{ setPage(1); setSortField('delta'); setSortDir(d=> (sortField==='delta' && d==='desc') ? 'asc' : 'desc'); }}>Δ (для A) {sortField==='delta' ? (sortDir==='desc' ? '↓' : '↑') : ''}</th>
                <th className="px-3 py-2 text-right">Средний рейтинг пары 1 (до)</th>
                <th className="px-3 py-2 text-right">Средний рейтинг пары 2 (до)</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r, i) => {
                const deltaPos = (r.delta_for_a || 0) > 0;
                const deltaNeg = (r.delta_for_a || 0) < 0;
                const deltaColor = deltaPos ? 'text-green-600' : deltaNeg ? 'text-red-600' : 'text-gray-500';
                return (
                <tr key={i}>
                  <td className="px-3 py-2">{r.tournament_date ? new Date(r.tournament_date).toLocaleDateString('ru-RU') : ''}</td>
                  <td className="px-3 py-2 text-blue-600 hover:underline cursor-pointer" onClick={()=>navigate(`/tournaments/${r.tournament_id}`)}>{r.tournament_name}</td>
                  <td className="px-3 py-2">{teamToLabel(r.team1)}</td>
                  <td className="px-3 py-2">{r.score}</td>
                  <td className="px-3 py-2">{teamToLabel(r.team2)}</td>
                  <td className={`px-3 py-2 text-right ${deltaColor}`}>
                    <span className="inline-flex items-center gap-1">
                      {deltaPos && <span>▲</span>}
                      {deltaNeg && <span>▼</span>}
                      <span>{Math.round(Math.abs(r.delta_for_a || 0))}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{r.team1_avg_before != null ? Math.round(r.team1_avg_before) : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.team2_avg_before != null ? Math.round(r.team2_avg_before) : '—'}</td>
                </tr>
              );})}
              {sorted.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">Нет матчей</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Пагинация */}
        {sorted.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm">
          <div>Стр. {page} из {totalPages}</div>
          <div className="flex items-center gap-2">
            <button disabled={page<=1} className="px-2 py-1 border rounded disabled:opacity-50" onClick={()=>setPage(p=>Math.max(1, p-1))}>Назад</button>
            <button disabled={page>=totalPages} className="px-2 py-1 border rounded disabled:opacity-50" onClick={()=>setPage(p=>Math.min(totalPages, p+1))}>Вперёд</button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
};
