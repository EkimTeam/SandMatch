import React, { useState, useEffect } from 'react';
import api from '../services/api';

interface RatingPlayer {
  id: number;
  display_name: string;
  full_name: string;
  current_rating: number;
  matches_count: number;
  tournaments_count: number;
  last5: Array<{
    match_id: number;
    won: boolean;
    tooltip: string;
  }>;
  highlight_few: boolean;
}

interface RatingHistoryPoint {
  tournament_id: number;
  tournament_name: string;
  tournament_date: string;
  rating_before: number;
  rating_after: number;
  total_change: number;
  matches_count: number;
}

export const RatingPage: React.FC = () => {
  const [players, setPlayers] = useState<RatingPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [minMatches, setMinMatches] = useState(0);
  const [minTournaments, setMinTournaments] = useState(0);
  
  // График
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [comparePlayerId, setComparePlayerId] = useState<number | null>(null);
  const [history, setHistory] = useState<RatingHistoryPoint[]>([]);
  const [compareHistory, setCompareHistory] = useState<RatingHistoryPoint[]>([]);
  const [showDelta, setShowDelta] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    loadLeaderboard();
  }, [search, minMatches, minTournaments]);

  useEffect(() => {
    if (selectedPlayerId) {
      loadHistory(selectedPlayerId, comparePlayerId);
    } else {
      setHistory([]);
      setCompareHistory([]);
    }
  }, [selectedPlayerId, comparePlayerId, dateFrom, dateTo]);

  const loadLeaderboard = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (minMatches > 0) params.append('min_matches', minMatches.toString());
      if (minTournaments > 0) params.append('min_tournaments', minTournaments.toString());
      
      const response = await api.get(`/api/players/ratings/?${params.toString()}`);
      const results = response.data.results || [];
      console.log('Загружено игроков:', results.length);
      setPlayers(results);
    } catch (error: any) {
      console.error('Ошибка загрузки рейтинга:', error);
      if (error.response) {
        console.error('Ответ сервера:', error.response.data);
        console.error('Статус:', error.response.status);
      }
      setPlayers([]);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async (playerId: number, compareId: number | null = null) => {
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append('from', dateFrom);
      if (dateTo) params.append('to', dateTo);
      if (compareId) params.append('compare_with', compareId.toString());
      
      const response = await api.get(`/api/players/${playerId}/rating_history/?${params.toString()}`);
      setHistory(response.data.history || []);
      setCompareHistory(response.data.compare || []);
    } catch (error: any) {
      console.error('Ошибка загрузки истории:', error);
      if (error.response) {
        console.error('Ответ сервера:', error.response.data);
      }
      setHistory([]);
      setCompareHistory([]);
    }
  };

  const handlePlayerClick = (playerId: number) => {
    if (selectedPlayerId === playerId) {
      setSelectedPlayerId(null);
    } else {
      setSelectedPlayerId(playerId);
    }
  };

  const handleCompareSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setComparePlayerId(val ? parseInt(val) : null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">Рейтинг игроков</h1>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
        >
          {showHelp ? 'Скрыть справку' : 'Как рассчитывается рейтинг?'}
        </button>
      </div>

      {showHelp && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm">
          <h3 className="font-semibold mb-2">Система расчета рейтинга</h3>
          <ul className="space-y-1 list-disc list-inside text-gray-700">
            <li>Рейтинг основан на модифицированной системе Эло (K-фактор = 32)</li>
            <li>Рейтинг команды = среднее арифметическое рейтингов игроков</li>
            <li>Изменения накапливаются в течение турнира и применяются после его завершения</li>
            <li>Модификаторы формата: только тай-брейк (0.3), один сет (1.0), 2+ сетов (1.0 + (N-1)×0.1 + разница×0.1)</li>
            <li>Стартовый рейтинг: HARD-специалисты (1100), MEDIUM-специалисты (900), остальные (1000)</li>
          </ul>
        </div>
      )}

      {/* Фильтры */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Поиск</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Имя игрока..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Мин. матчей</label>
            <input
              type="number"
              value={minMatches}
              onChange={(e) => setMinMatches(parseInt(e.target.value) || 0)}
              min="0"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Мин. турниров</label>
            <input
              type="number"
              value={minTournaments}
              onChange={(e) => setMinTournaments(parseInt(e.target.value) || 0)}
              min="0"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* Таблица лидеров */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Загрузка...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Место</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Игрок</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-700">Рейтинг</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-700">Матчи</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-700">Турниры</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-700">Последние 5 игр</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {players.map((player, idx) => (
                  <tr
                    key={player.id}
                    onClick={() => handlePlayerClick(player.id)}
                    className={`cursor-pointer hover:bg-gray-50 ${
                      player.highlight_few ? 'bg-yellow-50' : ''
                    } ${selectedPlayerId === player.id ? 'bg-blue-50' : ''}`}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium">{player.display_name}</div>
                      <div className="text-xs text-gray-500">{player.full_name}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold">{player.current_rating}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600">{player.matches_count}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600">{player.tournaments_count}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center gap-1">
                        {player.last5.map((match, i) => (
                          <div
                            key={i}
                            className={`w-3 h-3 rounded-full ${
                              match.won ? 'bg-green-500' : 'bg-red-500'
                            }`}
                            title={match.tooltip}
                          />
                        ))}
                        {player.last5.length < 5 && (
                          <div className="w-3 h-3 rounded-full bg-gray-300" title="Нет данных" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* График истории рейтинга */}
      {selectedPlayerId && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold mb-4">
            История рейтинга: {players.find(p => p.id === selectedPlayerId)?.display_name}
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">Дата от</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Дата до</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Сравнить с</label>
              <select
                value={comparePlayerId || ''}
                onChange={handleCompareSelect}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">Не выбрано</option>
                {players.filter(p => p.id !== selectedPlayerId).map(p => (
                  <option key={p.id} value={p.id}>{p.display_name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showDelta}
                onChange={(e) => setShowDelta(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">Показывать изменения рейтинга</span>
            </label>
          </div>

          {history.length > 0 ? (
            <div className="h-64 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
              <div className="text-center text-gray-500">
                <p className="mb-2">График будет отображаться здесь</p>
                <p className="text-xs">Точки: {history.length}</p>
                {showDelta && (
                  <div className="mt-4 text-left text-xs space-y-1">
                    {history.map((point, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{point.tournament_name}</span>
                        <span className={point.total_change >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {point.total_change > 0 ? '+' : ''}{point.total_change}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50 text-gray-500">
              Нет данных для отображения
            </div>
          )}
        </div>
      )}
    </div>
  );
};
