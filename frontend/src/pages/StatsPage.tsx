import React, { useEffect, useState } from 'react';
import { ratingApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

type PlayerRow = {
  id: number;
  first_name: string;
  last_name: string;
  display_name: string;
  tournaments_count: number;
  matches_count: number;
  wins: number;
  losses: number;
  winrate: number;
  unique_partners: number;
  unique_opponents: number;
};

export const StatsPage: React.FC = () => {
  const { user } = useAuth();
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const res = await ratingApi.summaryStats({ from: fromDate || undefined, to: toDate || undefined });
      setData(res);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Не удалось загрузить статистику');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const Table: React.FC<{ title: string; rows: PlayerRow[] }> = ({ title, rows }) => (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 font-semibold">{title}</div>
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600">
              <th className="px-3 py-2 text-left">Фамилия</th>
              <th className="px-3 py-2 text-left">Имя</th>
              <th className="px-3 py-2 text-left">Отображаемое имя</th>
              <th className="px-3 py-2 text-right">Турниров</th>
              <th className="px-3 py-2 text-right">Матчей</th>
              <th className="px-3 py-2 text-right">Побед</th>
              <th className="px-3 py-2 text-right">Поражений</th>
              <th className="px-3 py-2 text-right">% побед</th>
              <th className="px-3 py-2 text-right">Уник. партнёров</th>
              <th className="px-3 py-2 text-right">Уник. противников</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{r.last_name}</td>
                <td className="px-3 py-2">{r.first_name}</td>
                <td className="px-3 py-2">{r.display_name}</td>
                <td className="px-3 py-2 text-right">{r.tournaments_count}</td>
                <td className="px-3 py-2 text-right">{r.matches_count}</td>
                <td className="px-3 py-2 text-right">{r.wins}</td>
                <td className="px-3 py-2 text-right">{r.losses}</td>
                <td className="px-3 py-2 text-right">{r.winrate}%</td>
                <td className="px-3 py-2 text-right">{r.unique_partners}</td>
                <td className="px-3 py-2 text-right">{r.unique_opponents}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (user?.role === 'REFEREE') {
    return (
      <div className="card">
        Общая статистика по турнирам недоступна для роли судьи. Используйте
        {' '}
        <span className="font-semibold">"Судейство"</span>
        {' '}для доступа к вашим турнирам и матчам.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold mt-0">Сводная статистика по турнирам проведенным на платформе BeachPlay.ru</h1>

      {/* Фильтр периода */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500">От</label>
          <input type="date" className="border rounded px-2 py-1" value={fromDate} onChange={e=>setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-gray-500">До</label>
          <input type="date" className="border rounded px-2 py-1" value={toDate} onChange={e=>setToDate(e.target.value)} />
        </div>
        <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={load}>Показать</button>
        <button className="px-3 py-1 bg-gray-100 rounded" onClick={()=>{ setFromDate(''); setToDate(''); load(); }}>За весь период</button>
      </div>

      {/* Общая статистика */}
      <div className="text-base font-semibold text-gray-700">Общая статистика</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-[96px]">
          <div className="text-sm text-gray-600">Всего игроков с матчами</div>
          <div className="text-3xl font-bold">{data?.overall?.players_with_matches ?? '-'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-[96px]">
          <div className="text-sm text-gray-600">Всего матчей</div>
          <div className="text-3xl font-bold">{data?.overall?.matches ?? '-'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-[96px]">
          <div className="text-sm text-gray-600">Среднее матчей на игрока</div>
          <div className="text-3xl font-bold">{data?.overall?.avg_matches_per_player ?? '-'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-[96px]">
          <div className="text-sm text-gray-600">Средний % побед</div>
          <div className="text-3xl font-bold">{data?.overall?.avg_winrate ?? '-'}</div>
        </div>
      </div>

      {/* По типам турниров */}
      <div className="text-base font-semibold text-gray-700">Статистика по типам турниров</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-[96px]">
          <div className="text-sm text-gray-600">Всего HARD турниров</div>
          <div className="text-3xl font-bold">{data?.by_tournament_types?.hard_tournaments ?? '-'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-[96px]">
          <div className="text-sm text-gray-600">Всего MEDIUM турниров</div>
          <div className="text-3xl font-bold">{data?.by_tournament_types?.medium_tournaments ?? '-'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-[96px]">
          <div className="text-sm text-gray-600">Всего турниров "Только тай-брейк"</div>
          <div className="text-3xl font-bold">{data?.by_tournament_types?.tiebreak_only_tournaments ?? '-'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-[96px]">
          <div className="text-sm text-gray-600">Всего турниров других типов</div>
          <div className="text-3xl font-bold">{data?.by_tournament_types?.other_tournaments ?? '-'}</div>
        </div>
      </div>

      {/* Распределение игроков по типам турниров */}
      <div className="text-base font-semibold text-gray-700">Распределение игроков по типам турниров</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-[96px]">
          <div className="text-sm text-gray-600">Игроки только в HARD турнирах</div>
          <div className="text-3xl font-bold">{data?.players_distribution_by_types?.only_hard ?? '-'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-[96px]">
          <div className="text-sm text-gray-600">Игроки только в MEDIUM турнирах</div>
          <div className="text-3xl font-bold">{data?.players_distribution_by_types?.only_medium ?? '-'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-[96px]">
          <div className="text-sm text-gray-600">Игроки в обоих типах турниров</div>
          <div className="text-3xl font-bold">{data?.players_distribution_by_types?.both ?? '-'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-[96px]">
          <div className="text-sm text-gray-600">Игроки в других типах турниров</div>
          <div className="text-3xl font-bold">{data?.players_distribution_by_types?.without_typed ?? '-'}</div>
        </div>
      </div>

      {/* Таблицы */}
      <Table title="Топ-20 игроков" rows={(data?.tables?.top20_by_winrate ?? [])} />
      <Table title="Самые успешные (минимум 10 матчей)" rows={(data?.tables?.top_successful_min10 ?? [])} />
      <Table title="Самые активные игроки" rows={(data?.tables?.top_active ?? [])} />
      <Table title="Игроки с наибольшим количеством партнёров" rows={(data?.tables?.top_partners ?? [])} />

      {loading && <div className="text-center text-gray-500">Загрузка…</div>}
      {error && <div className="text-center text-red-600">{error}</div>}
    </div>
  );
};
