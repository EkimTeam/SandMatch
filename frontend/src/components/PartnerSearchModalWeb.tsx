import React, { useEffect, useState } from 'react';
import { tournamentRegistrationApi } from '../services/api';

interface Player {
  id: number;
  full_name: string;
  is_registered: boolean;
  rating_bp?: number | null;
}

interface PartnerSearchModalWebProps {
  tournamentId: number;
  onClose: () => void;
  onConfirm: (playerId: number, playerName: string) => void;
}

const PartnerSearchModalWeb: React.FC<PartnerSearchModalWebProps> = ({ tournamentId, onClose, onConfirm }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recentPartners, setRecentPartners] = useState<Player[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);

  useEffect(() => {
    // Загружаем последних напарников при открытии модалки
    const loadRecentPartners = async () => {
      try {
        setRecentLoading(true);
        const response = await tournamentRegistrationApi.getRecentPartners(tournamentId);
        setRecentPartners(response.players || []);
      } catch (err) {
        console.error('Ошибка загрузки частых напарников:', err);
        setRecentPartners([]);
      } finally {
        setRecentLoading(false);
      }
    };

    loadRecentPartners();
  }, [tournamentId]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      setLoading(true);
      setSearched(true);
      setSelectedPlayer(null);

      const response = await tournamentRegistrationApi.searchPlayers(tournamentId, searchQuery.trim());
      setPlayers(response.players || []);
    } catch (err) {
      console.error('Ошибка поиска напарника:', err);
      setPlayers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleSelect = (player: Player) => {
    if (player.is_registered) return;
    setSelectedPlayer(player);
  };

  const handleConfirm = async () => {
    if (!selectedPlayer) return;
    try {
      setSubmitting(true);
      await onConfirm(selectedPlayer.id, selectedPlayer.full_name);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">Поиск напарника</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">ФИО напарника</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Иванов Иван"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSearch}
                disabled={loading || !searchQuery.trim()}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '⏳' : '🔍 Найти'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">Введите фамилию и имя напарника</p>
          </div>

          {recentPartners.length > 0 && !searched && (
            <div className="mt-4 space-y-2">
              <h3 className="font-semibold text-gray-900 mb-1">Рекомендации по вашей истории:</h3>
              {recentLoading && (
                <div className="text-sm text-gray-500">Загрузка...</div>
              )}
              {!recentLoading &&
                recentPartners.map((player) => (
                  <button
                    type="button"
                    key={player.id}
                    onClick={() => handleSelect(player)}
                    className={`w-full text-left p-3 rounded-lg border mb-1 ${
                      player.is_registered
                        ? 'bg-gray-50 border-gray-300 cursor-not-allowed'
                        : 'bg-white border-gray-200 hover:bg-blue-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          {player.full_name}
                          {typeof player.rating_bp === 'number' && (
                            <span className="ml-2 text-xs text-gray-500">BP {player.rating_bp}</span>
                          )}
                        </div>
                        {player.is_registered && (
                          <div className="text-xs text-gray-500 mt-1">Уже зарегистрирован на турнир</div>
                        )}
                      </div>
                      {!player.is_registered && (
                        <span className="ml-3 px-3 py-1 text-xs rounded-full bg-green-100 text-green-700">
                          В пару
                        </span>
                      )}
                    </div>
                  </button>
                ))}
            </div>
          )}

          {searched && (
            <div className="space-y-2">
              {loading ? (
                <div className="text-center py-8 text-gray-500">Поиск...</div>
              ) : players.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-600 mb-2">Игроки не найдены</p>
                  <p className="text-sm text-gray-500">Попробуйте изменить запрос</p>
                </div>
              ) : (
                <>
                  <h3 className="font-semibold text-gray-900 mb-2">Найдено игроков: {players.length}</h3>
                  {players.map((player) => (
                    <button
                      type="button"
                      key={player.id}
                      onClick={() => handleSelect(player)}
                      className={`w-full text-left p-3 rounded-lg border mb-1 ${
                        player.is_registered
                          ? 'bg-gray-50 border-gray-300 cursor-not-allowed'
                          : 'bg-white border-gray-200 hover:bg-blue-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">
                            {player.full_name}
                            {typeof player.rating_bp === 'number' && (
                              <span className="ml-2 text-xs text-gray-500">BP {player.rating_bp}</span>
                            )}
                          </div>
                          {player.is_registered && (
                            <div className="text-xs text-gray-500 mt-1">Уже зарегистрирован на турнир</div>
                          )}
                        </div>
                        {!player.is_registered && (
                          <span className="ml-3 px-3 py-1 text-xs rounded-full bg-green-100 text-green-700">
                            В пару
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {!searched && recentPartners.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <p className="mb-2">Введите ФИО и нажмите "Найти"</p>
              <p className="text-sm">Будут показаны игроки, зарегистрированные в системе</p>
            </div>
          )}

          {selectedPlayer && (
            <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-100 text-sm text-gray-800">
              <p className="mb-2">Зарегистрироваться на турнир в паре с:</p>
              <p className="px-2 py-1 rounded bg-green-50 inline-block font-semibold text-gray-900">
                {selectedPlayer.full_name}
                {typeof selectedPlayer.rating_bp === 'number' && (
                  <span className="ml-2 text-xs text-gray-600">BP {selectedPlayer.rating_bp}</span>
                )}
              </p>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={!selectedPlayer || submitting}
              onClick={handleConfirm}
              className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {submitting ? 'Регистрация...' : 'Зарегистрироваться парой'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PartnerSearchModalWeb;
