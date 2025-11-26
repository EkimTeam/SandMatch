import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ratingApi, btrApi, BtrLeaderboardItem } from '../services/api';
import { useAuth } from '../context/AuthContext';
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

interface BtrCategoryData {
  label: string;
  results: BtrLeaderboardItem[];
  latest_date: string;
  total: number;
}

// Маппинг категорий BTR
const BTR_CATEGORY_MAP: Record<string, { code: string; label: string; shortLabel: string }> = {
  'M': { code: 'men_double', label: 'Мужчины. Парный разряд', shortLabel: 'M' },
  'MX': { code: 'men_mixed', label: 'Мужчины. Смешанный разряд', shortLabel: 'MX' },
  'MU': { code: 'junior_male', label: 'Юноши', shortLabel: 'MU' },
  'W': { code: 'women_double', label: 'Женщины. Парный разряд', shortLabel: 'W' },
  'WX': { code: 'women_mixed', label: 'Женщины. Смешанный разряд', shortLabel: 'WX' },
  'WU': { code: 'junior_female', label: 'Девушки', shortLabel: 'WU' },
};

// Компонент для отображения таблицы BTR категории
const BtrCategoryTable: React.FC<{
  loading: boolean;
  error: string | null;
  q: string;
  btrCategories: Record<string, BtrCategoryData>;
  selectedBtrCategory: string;
  page: number;
  pageSize: number;
  navigate: any;
}> = ({ loading, error, q, btrCategories, selectedBtrCategory, page, pageSize, navigate }) => {
  // Получаем данные выбранной категории
  const categoryCode = BTR_CATEGORY_MAP[selectedBtrCategory]?.code;
  const categoryData = categoryCode ? btrCategories[categoryCode] : null;
  const categoryLabel = BTR_CATEGORY_MAP[selectedBtrCategory]?.label || '';
  
  // Проверяем, является ли категория юниорской (MU или WU)
  const isJuniorCategory = selectedBtrCategory === 'MU' || selectedBtrCategory === 'WU';
  
  // Пагинация
  const startIdx = (page - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const pageResults = categoryData?.results.slice(startIdx, endIdx) || [];
  
  return (
    <div>
      {loading && (
        <div className="py-6 text-center text-gray-500">Загрузка...</div>
      )}
      {error && !loading && (
        <div className="py-6 text-center text-red-600">{error}</div>
      )}
      {!loading && !error && categoryData && (
        <div>
          <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700">{categoryLabel}</span>
              <span className="text-gray-500">
                Дата обн.: {categoryData.latest_date ? new Date(categoryData.latest_date).toLocaleDateString('ru-RU') : '—'} • Всего: {categoryData.total}
              </span>
            </div>
          </div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Игрок</th>
                <th className="px-3 py-2 text-left">РНИ</th>
                {isJuniorCategory && <th className="px-3 py-2 text-left">Год рождения</th>}
                <th className="px-3 py-2 text-left">Город</th>
                <th className="px-3 py-2 text-right">Рейтинг</th>
                <th className="px-3 py-2 text-right">Сыграно турниров за 52 нед</th>
                <th className="px-3 py-2 text-right">Учтено турниров</th>
              </tr>
            </thead>
            <tbody>
              {pageResults.length === 0 ? (
                <tr>
                  <td colSpan={isJuniorCategory ? 8 : 7} className="px-3 py-6 text-center text-gray-500">
                    {q ? 'Игроки не найдены' : 'Нет данных'}
                  </td>
                </tr>
              ) : (
                pageResults.map((r: BtrLeaderboardItem) => {
                  // Извлекаем год рождения из даты
                  const birthYear = r.birth_date ? new Date(r.birth_date).getFullYear() : null;
                  
                  return (
                    <tr 
                      key={r.id} 
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => navigate(`/btr/players/${r.id}`)}
                    >
                      <td className="px-3 py-2 align-middle text-gray-500">{r.rank}</td>
                      <td className="px-3 py-2 align-middle">
                        {r.last_name} {r.first_name} {r.middle_name}
                      </td>
                      <td className="px-3 py-2 align-middle text-gray-600">{r.rni}</td>
                      {isJuniorCategory && (
                        <td className="px-3 py-2 align-middle text-gray-600">
                          {birthYear || '—'}
                        </td>
                      )}
                      <td className="px-3 py-2 align-middle text-gray-600">{r.city || '—'}</td>
                      <td className="px-3 py-2 align-middle text-right font-semibold">
                        {Math.round(r.current_rating)}
                      </td>
                      <td className="px-3 py-2 align-middle text-right text-gray-600">
                        {r.tournaments_52_weeks}
                      </td>
                      <td className="px-3 py-2 align-middle text-right text-gray-600">
                        {r.tournaments_counted}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && !categoryData && (
        <div className="py-6 text-center text-gray-500">Нет данных по рейтингу BTR</div>
      )}
    </div>
  );
};

export const RatingPage: React.FC = () => {
  const { user } = useAuth();
  const [ratingType, setRatingType] = useState<'bp' | 'btr'>('bp'); // Переключатель BP/BTR
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [btrCategories, setBtrCategories] = useState<Record<string, BtrCategoryData>>({});
  const [selectedBtrCategory, setSelectedBtrCategory] = useState<string>('M'); // Выбранная категория BTR
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
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
    const pageSizeParam = parseInt(searchParams.get('page_size') || '20', 10);
    const qParam = searchParams.get('q') || '';
    const typeParam = searchParams.get('type') as 'bp' | 'btr' || 'bp';
    const categoryParam = searchParams.get('category') || 'M';
    setPage(Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1);
    setPageSize([20, 40, 60].includes(pageSizeParam) ? pageSizeParam : 20);
    setQ(qParam);
    setRatingType(typeParam);
    setSelectedBtrCategory(categoryParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        
        if (ratingType === 'bp') {
          // Загрузка BP рейтинга
          const data = await ratingApi.leaderboard({ q, page, page_size: pageSize });
          setRows(data.results || []);
          setTotalPages(data.total_pages || 1);
          // Выберем по умолчанию первого игрока для графика
          if (!selectedPlayerId && (data.results || []).length > 0) {
            setSelectedPlayerId((data.results || [])[0].id);
          }
        } else {
          // Загрузка BTR рейтинга (все категории)
          const data = await btrApi.leaderboard({ q });
          setBtrCategories(data.categories || {});
          // Вычисляем пагинацию для выбранной категории
          const categoryCode = BTR_CATEGORY_MAP[selectedBtrCategory]?.code;
          const categoryData = categoryCode ? data.categories[categoryCode] : null;
          const total = categoryData?.total || 0;
          setTotalPages(Math.ceil(total / pageSize) || 1);
        }
      } catch (e: any) {
        setError(e?.response?.data?.error || 'Не удалось загрузить рейтинг');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [q, page, pageSize, ratingType, selectedBtrCategory]);

  // Сохраняем параметры в URL
  useEffect(() => {
    const params: any = {};
    if (q) params.q = q;
    if (page && page > 1) params.page = String(page);
    if (pageSize !== 20) params.page_size = String(pageSize);
    if (ratingType !== 'bp') params.type = ratingType;
    if (ratingType === 'btr' && selectedBtrCategory !== 'M') params.category = selectedBtrCategory;
    setSearchParams(params, { replace: true });
  }, [q, page, pageSize, ratingType, selectedBtrCategory, setSearchParams]);

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

  if (user?.role === 'REFEREE') {
    return (
      <div className="card">
        Общий рейтинг игроков недоступен для роли судьи. Перейдите в раздел
        {' '}
        <span className="font-semibold">"Судейство"</span>
        {' '}для работы с назначенными вам турнирами.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-2xl font-bold">
            {ratingType === 'bp' ? 'BeachPlay-Рейтинг (BP-Рейтинг)' : 'BTR-Рейтинг (BeachTennisRussia)'}
          </h1>
          <div className="relative group">
            <button className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded bg-blue-600 text-white text-[11px] font-semibold" aria-label="Методика">i</button>
            <div className="absolute z-10 hidden group-hover:block bg-white border border-gray-200 rounded shadow p-3 text-sm w-80">
              {ratingType === 'bp' 
                ? 'Основан на модифицированной формуле Эло. Учитывается сила соперника и формат матча. Изменения применяются после завершения турнира. Короткие форматы имеют меньший вес.'
                : 'Официальный рейтинг Федерации пляжного тенниса России. Данные обновляются ежемесячно с сайта btrussia.com.'}
            </div>
          </div>
          {ratingType === 'bp' && <span className="text-xs text-gray-500">(рейтинг работает и рассчитывается в тестовом режиме)</span>}
        </div>
        
        {/* Переключатель BP / BTR */}
        <div className="flex gap-2 border-b border-gray-200">
          <button
            onClick={() => { setRatingType('bp'); setPage(1); }}
            className={`px-4 py-2 font-medium transition-colors ${
              ratingType === 'bp'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            BP-Рейтинг
          </button>
          <button
            onClick={() => { setRatingType('btr'); setPage(1); }}
            className={`px-4 py-2 font-medium transition-colors ${
              ratingType === 'btr'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            BTR-Рейтинг
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="font-semibold">Классификация</div>
            {ratingType === 'btr' && (
              <div className="flex gap-1">
                {Object.keys(BTR_CATEGORY_MAP).map((key) => (
                  <button
                    key={key}
                    onClick={() => { setSelectedBtrCategory(key); setPage(1); }}
                    className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                      selectedBtrCategory === key
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {BTR_CATEGORY_MAP[key].shortLabel}
                  </button>
                ))}
              </div>
            )}
          </div>
          <form className="flex items-center gap-2" onSubmit={(e)=>{ e.preventDefault(); setPage(1); setQ(q.trim()); }}>
            <input value={q} onChange={e=>setQ(e.target.value)} className="border rounded px-2 py-1 text-sm" placeholder="Поиск игрока" />
            <button type="submit" className="px-3 py-1 text-sm bg-blue-600 text-white rounded">Искать</button>
            <button type="button" className="px-3 py-1 text-sm bg-gray-100 rounded" onClick={()=>{ setQ(''); setPage(1); }}>Сброс</button>
          </form>
        </div>
        <div className="overflow-auto">
          {ratingType === 'bp' ? (
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
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">Загрузка...</td></tr>
                )}
                {error && !loading && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-red-600">{error}</td></tr>
                )}
                {!loading && !error && rows.map((r, idx) => {
                const needsHighlight = r.tournaments_count < 5 || r.matches_count < 10;
                const placeTop = rows.length > 2 && (idx >= rows.length - 2);
                return (
                  <tr key={r.id} className={needsHighlight ? 'bg-yellow-50 cursor-pointer' : 'cursor-pointer'}
                      onClick={() => { setSelectedPlayerId(r.id); navigate(`/players/${r.id}`); }}>
                    <td className="px-3 py-2 align-middle text-gray-500">
                      <span>{r.rank ?? (idx + 1 + (page-1)*20)}</span>
                      {needsHighlight && <span className="align-super text-xs ml-0.5">*</span>}
                    </td>
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
          ) : (
            <BtrCategoryTable
              loading={loading}
              error={error}
              q={q}
              btrCategories={btrCategories}
              selectedBtrCategory={selectedBtrCategory}
              page={page}
              pageSize={pageSize}
              navigate={navigate}
            />
          )}
        </div>
        {/* пагинация */}
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between gap-3 text-sm flex-wrap">
          <div className="flex items-center gap-3">
            <div>Стр. {page} из {totalPages}</div>
            <div className="flex items-center gap-2">
              <label htmlFor="pageSize" className="text-gray-600">Показывать:</label>
              <select
                id="pageSize"
                value={pageSize}
                onChange={(e) => {
                  const newSize = parseInt(e.target.value, 10);
                  setPageSize(newSize);
                  setPage(1); // Сбрасываем на первую страницу
                }}
                className="px-2 py-1 border rounded bg-white text-sm"
              >
                <option value="20">20</option>
                <option value="40">40</option>
                <option value="60">60</option>
              </select>
            </div>
          </div>
          {ratingType === 'bp' && (
            <div className="text-gray-500 text-xs">* игроки, которые сыграли меньше 10 матчей или 5 турниров</div>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button disabled={page<=1} className="px-2 py-1 border rounded disabled:opacity-50" onClick={()=>setPage(p=>Math.max(1, p-1))}>Назад</button>
            <button disabled={page>=totalPages} className="px-2 py-1 border rounded disabled:opacity-50" onClick={()=>setPage(p=>Math.min(totalPages, p+1))}>Вперёд</button>
          </div>
        </div>
      </div>

      {/* Формула расчета рейтинга BP */}
      {ratingType === 'bp' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mt-6">
          <details className="group">
            <summary className="px-4 py-3 cursor-pointer select-none flex items-center justify-between hover:bg-gray-50 transition-colors">
              <span className="font-medium text-gray-900">ƒ(x) Формула расчета рейтинга BP</span>
              <svg className="w-5 h-5 text-gray-500 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="px-4 py-4 border-t border-gray-200 text-sm space-y-4">
              {/* Основная формула */}
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Основная формула (система Elo)</h4>
                <div className="bg-gray-50 p-3 rounded border border-gray-200 font-mono text-xs overflow-x-auto">
                  <div>Δ = K × FMT × (Actual − Expected) × COEF</div>
                </div>
                <p className="mt-2 text-gray-600">
                  Где <strong>Δ</strong> — изменение рейтинга игрока после матча
                </p>
              </div>

              {/* Параметры */}
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Параметры формулы</h4>
                <ul className="space-y-2 text-gray-700">
                  <li>
                    <strong>K = 32</strong> — коэффициент изменчивости (K-фактор)
                  </li>
                  <li>
                    <strong>FMT</strong> — форматный множитель, зависящий от результата по сетам:
                    <ul className="ml-6 mt-1 space-y-1 text-sm">
                      <li>• Один тай-брейк: <code className="bg-gray-100 px-1 rounded">FMT = 0.3</code></li>
                      <li>• Один полный сет: <code className="bg-gray-100 px-1 rounded">FMT = 1.0</code></li>
                      <li>• Несколько сетов: <code className="bg-gray-100 px-1 rounded">FMT = 1.0 + 0.1 × |diff|</code>
                        <div className="text-gray-500 ml-4 mt-0.5">где diff — разница выигранных сетов</div>
                        <div className="text-gray-500 ml-4 mt-0.5">Примеры: 2:0 → 1.2, 3:0 → 1.3, 2:1 → 1.1, 3:1 → 1.2, 1:1 → 1.0</div>
                      </li>
                    </ul>
                  </li>
                  <li>
                    <strong>Actual</strong> — фактический результат:
                    <ul className="ml-6 mt-1 space-y-1 text-sm">
                      <li>• Победа: <code className="bg-gray-100 px-1 rounded">1.0</code></li>
                      <li>• Поражение: <code className="bg-gray-100 px-1 rounded">0.0</code></li>
                    </ul>
                  </li>
                  <li>
                    <strong>Expected</strong> — ожидаемый результат (вероятность победы):
                    <div className="bg-gray-50 p-2 mt-1 rounded border border-gray-200 font-mono text-xs">
                      Expected = 1 / (1 + 10<sup>((R<sub>opp</sub> − R<sub>team</sub>) / 400)</sup>)
                    </div>
                    <div className="text-gray-500 ml-4 mt-1 text-sm">
                      где R<sub>team</sub> — средний рейтинг вашей команды, R<sub>opp</sub> — средний рейтинг команды соперников
                    </div>
                  </li>
                  <li>
                    <strong>COEF</strong> — коэффициент турнира:
                    <div className="text-gray-500 ml-4 mt-1 text-sm">
                      Автоматически рассчитывается при фиксации участников на основе среднего рейтинга и количества участников.
                      Позволяет увеличить влияние крупных престижных турниров и уменьшить влияние небольших тренировочных турниров.
                    </div>
                  </li>
                </ul>
              </div>

              {/* Расчет коэффициента турнира */}
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Расчет коэффициента турнира (COEF)</h4>
                <p className="text-gray-600 text-sm mb-2">
                  Коэффициент автоматически рассчитывается при фиксации участников турнира по таблице:
                </p>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs border border-gray-300">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-gray-300 px-2 py-1 text-left">Средний рейтинг</th>
                        <th className="border border-gray-300 px-2 py-1 text-center">≤8</th>
                        <th className="border border-gray-300 px-2 py-1 text-center">9-12</th>
                        <th className="border border-gray-300 px-2 py-1 text-center">12-16</th>
                        <th className="border border-gray-300 px-2 py-1 text-center">17-24</th>
                        <th className="border border-gray-300 px-2 py-1 text-center">&gt;24</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border border-gray-300 px-2 py-1 font-medium">≤800</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">0.6</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">0.7</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">0.8</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">0.9</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.0</td>
                      </tr>
                      <tr className="bg-gray-50">
                        <td className="border border-gray-300 px-2 py-1 font-medium">801-950</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">0.7</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">0.8</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">0.9</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.0</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.1</td>
                      </tr>
                      <tr>
                        <td className="border border-gray-300 px-2 py-1 font-medium">951-1050</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">0.8</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">0.9</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.0</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.1</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.2</td>
                      </tr>
                      <tr className="bg-gray-50">
                        <td className="border border-gray-300 px-2 py-1 font-medium">1051-1200</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">0.9</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.0</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.1</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.2</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.3</td>
                      </tr>
                      <tr>
                        <td className="border border-gray-300 px-2 py-1 font-medium">&gt;1200</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.0</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.1</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.2</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.3</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">1.4</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 text-sm text-gray-700">
                  <strong>Бонус за призовой фонд:</strong> +0.2 к коэффициенту, если в турнире указан призовой фонд
                </div>
                <div className="mt-2 space-y-1 text-xs text-gray-600">
                  <div><strong>Пример 1:</strong> 10 участников, средний рейтинг 900 → COEF = 0.8</div>
                  <div><strong>Пример 2:</strong> 18 участников, средний рейтинг 1100 → COEF = 1.2</div>
                  <div><strong>Пример 3:</strong> 30 участников, средний рейтинг 1300, призовой фонд → COEF = 1.4 + 0.2 = 1.6</div>
                </div>
              </div>

              {/* Рейтинг команды */}
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Рейтинг команды</h4>
                <div className="bg-gray-50 p-3 rounded border border-gray-200">
                  <div className="font-mono text-xs mb-2">R<sub>team</sub> = (R<sub>player1</sub> + R<sub>player2</sub>) / 2</div>
                  <p className="text-gray-600 text-xs">
                    Для одиночных матчей используется рейтинг игрока как средний рейтинг команды
                  </p>
                </div>
              </div>

              {/* Примеры */}
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Примеры расчета</h4>
                
                {/* Пример 1 */}
                <div className="bg-blue-50 p-3 rounded border border-blue-200 mb-3">
                  <div className="font-medium text-blue-900 mb-2">Пример 1: Победа равных команд (счет 2:0)</div>
                  <div className="text-sm text-gray-700 space-y-1">
                    <div>• Ваша команда: 1200 + 1200 = <strong>R<sub>team</sub> = 1200</strong></div>
                    <div>• Команда соперников: 1180 + 1220 = <strong>R<sub>opp</sub> = 1200</strong></div>
                    <div>• Формат: 2 сета со счетом 2:0 → diff = 2 → <strong>FMT = 1.0 + 0.1×2 = 1.2</strong></div>
                    <div>• Expected = 1 / (1 + 10<sup>0</sup>) = <strong>0.5</strong></div>
                    <div>• Коэффициент турнира: <strong>COEF = 1.0</strong></div>
                    <div>• Δ = 32 × 1.2 × (1.0 − 0.5) × 1.0 = <strong>+19</strong></div>
                    <div className="mt-2 font-medium text-blue-900">Результат: каждый игрок получает +19 рейтинга</div>
                  </div>
                </div>

                {/* Пример 2 */}
                <div className="bg-green-50 p-3 rounded border border-green-200 mb-3">
                  <div className="font-medium text-green-900 mb-2">Пример 2: Победа над сильными соперниками</div>
                  <div className="text-sm text-gray-700 space-y-1">
                    <div>• Ваша команда: 1100 + 1100 = <strong>R<sub>team</sub> = 1100</strong></div>
                    <div>• Команда соперников: 1400 + 1400 = <strong>R<sub>opp</sub> = 1400</strong></div>
                    <div>• Формат: 1 полный сет → <strong>FMT = 1.0</strong></div>
                    <div>• Expected = 1 / (1 + 10<sup>(300/400)</sup>) ≈ <strong>0.15</strong></div>
                    <div>• Коэффициент турнира: <strong>COEF = 1.0</strong></div>
                    <div>• Δ = 32 × 1.0 × (1.0 − 0.15) × 1.0 = <strong>+27</strong></div>
                    <div className="mt-2 font-medium text-green-900">Результат: каждый игрок получает +27 рейтинга (победа над сильными дает больше очков)</div>
                  </div>
                </div>

                {/* Пример 3 */}
                <div className="bg-red-50 p-3 rounded border border-red-200 mb-3">
                  <div className="font-medium text-red-900 mb-2">Пример 3: Поражение от слабых соперников</div>
                  <div className="text-sm text-gray-700 space-y-1">
                    <div>• Ваша команда: 1500 + 1500 = <strong>R<sub>team</sub> = 1500</strong></div>
                    <div>• Команда соперников: 1200 + 1200 = <strong>R<sub>opp</sub> = 1200</strong></div>
                    <div>• Формат: 1 полный сет → <strong>FMT = 1.0</strong></div>
                    <div>• Expected = 1 / (1 + 10<sup>(−300/400)</sup>) ≈ <strong>0.85</strong></div>
                    <div>• Коэффициент турнира: <strong>COEF = 1.0</strong></div>
                    <div>• Δ = 32 × 1.0 × (0.0 − 0.85) × 1.0 = <strong>−27</strong></div>
                    <div className="mt-2 font-medium text-red-900">Результат: каждый игрок теряет −27 рейтинга (поражение от слабых стоит дорого)</div>
                  </div>
                </div>

                {/* Пример 4 */}
                <div className="bg-yellow-50 p-3 rounded border border-yellow-200 mb-3">
                  <div className="font-medium text-yellow-900 mb-2">Пример 4: Тай-брейк</div>
                  <div className="text-sm text-gray-700 space-y-1">
                    <div>• Ваша команда: 1300 + 1300 = <strong>R<sub>team</sub> = 1300</strong></div>
                    <div>• Команда соперников: 1300 + 1300 = <strong>R<sub>opp</sub> = 1300</strong></div>
                    <div>• Формат: только тай-брейк → <strong>FMT = 0.3</strong></div>
                    <div>• Expected = <strong>0.5</strong></div>
                    <div>• Коэффициент турнира: <strong>COEF = 1.0</strong></div>
                    <div>• Δ = 32 × 0.3 × (1.0 − 0.5) × 1.0 = <strong>+5</strong></div>
                    <div className="mt-2 font-medium text-yellow-900">Результат: каждый игрок получает +5 рейтинга (короткие матчи дают меньше очков)</div>
                  </div>
                </div>

                {/* Пример 5 */}
                <div className="bg-purple-50 p-3 rounded border border-purple-200">
                  <div className="font-medium text-purple-900 mb-2">Пример 5: Турнир с повышенным коэффициентом (счет 2:1)</div>
                  <div className="text-sm text-gray-700 space-y-1">
                    <div>• Ваша команда: 1200 + 1200 = <strong>R<sub>team</sub> = 1200</strong></div>
                    <div>• Команда соперников: 1200 + 1200 = <strong>R<sub>opp</sub> = 1200</strong></div>
                    <div>• Формат: 3 сета со счетом 2:1 → diff = 1 → <strong>FMT = 1.0 + 0.1×1 = 1.1</strong></div>
                    <div>• Expected = <strong>0.5</strong></div>
                    <div>• Коэффициент турнира: <strong>COEF = 1.5</strong> (важный турнир)</div>
                    <div>• Δ = 32 × 1.1 × (1.0 − 0.5) × 1.5 = <strong>+26</strong></div>
                    <div className="mt-2 font-medium text-purple-900">Результат: каждый игрок получает +26 рейтинга (турниры с COEF &gt; 1.0 дают больше очков)</div>
                  </div>
                </div>
              </div>

              {/* Важные замечания */}
              <div className="bg-gray-50 p-3 rounded border border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-2">Важные замечания</h4>
                <ul className="space-y-1 text-gray-700 text-sm">
                  <li>• Минимальный рейтинг игрока: <strong>1</strong></li>
                  <li>• Стартовый рейтинг новых игроков: <strong>1000</strong></li>
                  <li>• Рейтинг обновляется после завершения турнира (не после каждого матча)</li>
                  <li>• Все изменения рейтинга за турнир суммируются и применяются одновременно</li>
                  <li>• Игроки с менее чем 5 турнирами или 10 матчами отмечены * (рейтинг может быть нестабильным)</li>
                </ul>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* График убран по требованию. Оставляем только таблицу лидеров */}
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
