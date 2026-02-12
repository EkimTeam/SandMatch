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
  score?: number;
};

export const StatsPage: React.FC = () => {
  const { user } = useAuth();
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any | null>(null);

  const load = async (opts?: { from?: string | null; to?: string | null }) => {
    try {
      setLoading(true);
      const hasFrom = opts && Object.prototype.hasOwnProperty.call(opts, 'from');
      const hasTo = opts && Object.prototype.hasOwnProperty.call(opts, 'to');
      const effectiveFrom = hasFrom ? (opts!.from || undefined) : (fromDate || undefined);
      const effectiveTo = hasTo ? (opts!.to || undefined) : (toDate || undefined);
      const res = await ratingApi.summaryStats({ from: effectiveFrom, to: effectiveTo });
      setData(res);
      // Обновляем поля дат по фактически использованному периоду
      if (res?.period) {
        if (res.period.from) setFromDate(res.period.from);
        if (res.period.to) setToDate(res.period.to);
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Не удалось загрузить статистику');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // По умолчанию: период за год до текущей даты
    const today = new Date();
    const to = today.toISOString().slice(0, 10);
    const fromDateObj = new Date(today);
    fromDateObj.setFullYear(fromDateObj.getFullYear() - 1);
    const from = fromDateObj.toISOString().slice(0, 10);
    setFromDate(from);
    setToDate(to);
    load({ from, to });
  }, []);

  const Table: React.FC<{ title: string; rows: PlayerRow[]; withScore?: boolean }> = ({ title, rows, withScore }) => {
    const [showScoreTip, setShowScoreTip] = useState(false);

    return (
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 font-semibold">{title}</div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="px-2 py-2 text-right w-8">#</th>
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
                {withScore && (
                  <th className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span>Оценка</span>
                      <span
                        className="relative inline-block"
                        data-export-exclude="true"
                        onMouseEnter={() => setShowScoreTip(true)}
                        onMouseLeave={() => setShowScoreTip(false)}
                      >
                        <button
                          type="button"
                          className="w-4 h-4 rounded-full border border-gray-400 text-[10px] leading-3 flex items-center justify-center text-gray-600 bg-white"
                          onClick={() => setShowScoreTip(v => !v)}
                        >
                          ?
                        </button>
                        {showScoreTip && (
                          <div
                            className="absolute top-full right-0 mt-1 z-20 bg-white border border-gray-300 rounded shadow text-xs text-gray-800 p-2"
                            style={{ minWidth: '18rem', maxWidth: '24rem' }}
                          >
                            Оценка учитывает и процент побед, и количество матчей:
                            <br />
                            <span>
                              score = winrate × (1 - e
                              <sup>-matches/20</sup>
                              )
                            </span>
                            <br />
                            где <code>winrate</code> — % побед,
                            <br />
                            <code>matches</code> — число матчей.
                          </div>
                        )}
                      </span>
                    </div>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.id}>
                  <td className="px-2 py-2 text-right text-gray-500">{idx + 1}</td>
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
                  {withScore && (
                    <td className="px-3 py-2 text-right">{typeof r.score === 'number' ? r.score.toFixed(2) : '-'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

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
        <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={() => load()}>Показать</button>
        <button
          className="px-3 py-1 bg-gray-100 rounded"
          onClick={() => {
            const today = new Date().toISOString().slice(0, 10);
            setFromDate('');
            setToDate(today);
            // from не задаём, чтобы backend сам подставил минимальную дату,
            // а to задаём как текущую дату
            load({ from: undefined, to: today });
          }}
        >
          За весь период
        </button>
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
          <div className="text-sm text-gray-600">Всего ПроАм турниров</div>
          <div className="text-3xl font-bold">{data?.by_tournament_types?.proam_tournaments ?? '-'}</div>
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
      <Table title="Топ-20 игроков" rows={(data?.tables?.top20_by_winrate ?? [])} withScore />
      <Table title="Самые успешные (минимум 10 матчей)" rows={(data?.tables?.top_successful_min10 ?? [])} />
      <Table title="Самые активные игроки" rows={(data?.tables?.top_active ?? [])} />
      <Table title="Игроки с наибольшим количеством партнёров" rows={(data?.tables?.top_partners ?? [])} />

      {loading && <div className="text-center text-gray-500">Загрузка…</div>}
      {error && <div className="text-center text-red-600">{error}</div>}
    </div>
  );
};
