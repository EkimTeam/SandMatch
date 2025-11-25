import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { btrApi, BtrPlayerDetail } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend, ResponsiveContainer } from 'recharts';

// Маппинг категорий BTR
const BTR_CATEGORY_MAP: Record<string, { label: string; color: string }> = {
  'men_double': { label: 'Мужчины. Парный', color: '#3b82f6' },
  'men_mixed': { label: 'Мужчины. Смешанный', color: '#8b5cf6' },
  'women_double': { label: 'Женщины. Парный', color: '#ec4899' },
  'women_mixed': { label: 'Женщины. Смешанный', color: '#f59e0b' },
  'junior_male': { label: 'Юноши', color: '#10b981' },
  'junior_female': { label: 'Девушки', color: '#06b6d4' },
};

export const BTRPlayerCardPage: React.FC = () => {
  const { id } = useParams();
  const playerId = Number(id);
  const navigate = useNavigate();
  const [playerData, setPlayerData] = useState<BtrPlayerDetail | null>(null);
  const [history, setHistory] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Фильтры дат
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  
  // Состояние для включения/выключения графиков
  const [visibleLines, setVisibleLines] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Загружаем детальную информацию об игроке
        const detail = await btrApi.playerDetail(playerId);
        setPlayerData(detail);
        
        // Загружаем историю рейтинга
        const hist = await btrApi.playerHistory(playerId);
        setHistory(hist.history_by_category || {});
        
        // Инициализируем видимость всех линий
        const initialVisible: Record<string, boolean> = {};
        Object.keys(detail.categories).forEach(cat => {
          initialVisible[`${cat}_rating`] = true;
          initialVisible[`${cat}_rank`] = false; // Позиция по умолчанию выключена
        });
        setVisibleLines(initialVisible);
      } catch (e: any) {
        setError(e?.response?.data?.error || 'Не удалось загрузить данные игрока');
      } finally {
        setLoading(false);
      }
    };
    
    if (!isNaN(playerId)) {
      load();
    }
  }, [playerId]);

  // Подготовка данных для графика с учётом фильтров
  const chartData = useMemo(() => {
    if (!history || Object.keys(history).length === 0) return [];
    
    // Функция проверки попадания даты в диапазон
    const inRange = (dateStr: string) => {
      if (!fromDate && !toDate) return true;
      const t = new Date(dateStr).getTime();
      if (fromDate && t < new Date(fromDate).getTime()) return false;
      if (toDate && t > new Date(toDate).getTime()) return false;
      return true;
    };
    
    // Собираем все даты из всех категорий с учётом фильтра
    const allDates = new Set<string>();
    Object.values(history).forEach(catHistory => {
      catHistory.forEach(item => {
        if (inRange(item.date)) {
          allDates.add(item.date);
        }
      });
    });
    
    // Сортируем даты
    const sortedDates = Array.from(allDates).sort();
    
    // Формируем данные для графика
    return sortedDates.map(date => {
      const point: any = { date: new Date(date).toLocaleDateString('ru-RU') };
      
      Object.entries(history).forEach(([category, catHistory]) => {
        const item = catHistory.find(h => h.date === date);
        if (item) {
          point[`${category}_rating`] = item.rating;
          point[`${category}_rank`] = item.rank;
        }
      });
      
      return point;
    });
  }, [history, fromDate, toDate]);

  const toggleLine = (key: string) => {
    setVisibleLines(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="text-center text-gray-500">Загрузка...</div>
      </div>
    );
  }

  if (error || !playerData) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="text-center text-red-600">{error || 'Игрок не найден'}</div>
        <div className="text-center mt-4">
          <button onClick={() => navigate('/rating?type=btr')} className="text-blue-600 hover:underline">
            ← Вернуться к рейтингу
          </button>
        </div>
      </div>
    );
  }

  const { player, categories, stats } = playerData;
  const availableCategories = Object.keys(categories);
  const birthYear = player.birth_date ? new Date(player.birth_date).getFullYear() : null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Навигация */}
      <div className="mb-6">
        <button onClick={() => navigate('/rating?type=btr')} className="text-blue-600 hover:underline">
          ← Вернуться к рейтингу BTR
        </button>
      </div>

      {/* Персональная информация */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h1 className="text-2xl font-bold mb-4">
          {player.last_name} {player.first_name} {player.middle_name}
        </h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          {player.city && (
            <div>
              <span className="text-gray-600">Город:</span>{' '}
              <span className="font-medium">{player.city}</span>
            </div>
          )}
          {birthYear && (
            <div>
              <span className="text-gray-600">Год рождения:</span>{' '}
              <span className="font-medium">{birthYear}</span>
            </div>
          )}
          <div>
            <span className="text-gray-600">РНИ:</span>{' '}
            <span className="font-medium">{player.rni}</span>
          </div>
        </div>

        {/* Текущие рейтинги по категориям */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {availableCategories.map(catCode => {
            const cat = categories[catCode];
            const catInfo = BTR_CATEGORY_MAP[catCode];
            return (
              <div key={catCode} className="border border-gray-200 rounded p-4">
                <div className="text-xs text-gray-500 mb-1">{catInfo?.label}</div>
                <div className="text-2xl font-bold" style={{ color: catInfo?.color }}>
                  {Math.round(cat.current_rating)}
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  Позиция: {cat.rank || '—'}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Обновлено: {new Date(cat.rating_date).toLocaleDateString('ru-RU')}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Интерактивный график */}
      {chartData.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">История рейтинга</h2>
          
          {/* Фильтры дат */}
          <div className="mb-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">От:</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">До:</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>
            {(fromDate || toDate) && (
              <button
                onClick={() => { setFromDate(''); setToDate(''); }}
                className="text-sm text-blue-600 hover:underline"
              >
                Сбросить
              </button>
            )}
          </div>
          
          {/* Легенда с переключателями */}
          <div className="mb-4 flex flex-wrap gap-4">
            {availableCategories.map(catCode => {
              const catInfo = BTR_CATEGORY_MAP[catCode];
              return (
                <div key={catCode} className="space-y-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleLines[`${catCode}_rating`] || false}
                      onChange={() => toggleLine(`${catCode}_rating`)}
                      className="rounded"
                    />
                    <span style={{ color: catInfo?.color }} className="font-medium text-sm">
                      {catInfo?.label} (рейтинг)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer ml-6">
                    <input
                      type="checkbox"
                      checked={visibleLines[`${catCode}_rank`] || false}
                      onChange={() => toggleLine(`${catCode}_rank`)}
                      className="rounded"
                    />
                    <span style={{ color: catInfo?.color }} className="text-xs text-gray-600">
                      {catInfo?.label} (позиция)
                    </span>
                  </label>
                </div>
              );
            })}
          </div>

          {/* График */}
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" label={{ value: 'Рейтинг', angle: -90, position: 'insideLeft' }} />
              <YAxis yAxisId="right" orientation="right" reversed label={{ value: 'Позиция', angle: 90, position: 'insideRight' }} />
              <ReTooltip />
              <Legend />
              
              {/* Линии рейтинга */}
              {availableCategories.map(catCode => {
                const catInfo = BTR_CATEGORY_MAP[catCode];
                return visibleLines[`${catCode}_rating`] && (
                  <Line
                    key={`${catCode}_rating`}
                    yAxisId="left"
                    type="monotone"
                    dataKey={`${catCode}_rating`}
                    stroke={catInfo?.color}
                    strokeWidth={2}
                    name={`${catInfo?.label} (рейтинг)`}
                    dot={{ r: 4 }}
                    connectNulls
                  />
                );
              })}
              
              {/* Линии позиции */}
              {availableCategories.map(catCode => {
                const catInfo = BTR_CATEGORY_MAP[catCode];
                return visibleLines[`${catCode}_rank`] && (
                  <Line
                    key={`${catCode}_rank`}
                    yAxisId="right"
                    type="monotone"
                    dataKey={`${catCode}_rank`}
                    stroke={catInfo?.color}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    name={`${catInfo?.label} (позиция)`}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Статистика по категориям */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-xl font-bold mb-4">Статистика</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {availableCategories.map(catCode => {
            const catInfo = BTR_CATEGORY_MAP[catCode];
            const catStats = stats[catCode];
            return (
              <div key={catCode} className="border border-gray-200 rounded p-4">
                <div className="text-sm font-medium mb-3" style={{ color: catInfo?.color }}>
                  {catInfo?.label}
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Макс. рейтинг:</span>
                    <span className="font-medium">{Math.round(catStats.max_rating)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Мин. рейтинг:</span>
                    <span className="font-medium">{Math.round(catStats.min_rating)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Всего турниров:</span>
                    <span className="font-medium">{catStats.total_tournaments}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
