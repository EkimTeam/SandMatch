/**
 * Модальное окно для поиска напарника
 */
import { useState, useEffect } from 'react'
import { miniAppAPI } from '../../api/miniApp'
import { hapticFeedback } from '../../utils/telegram'

interface Player {
  id: number
  full_name: string
  is_registered: boolean
  rating_bp?: number | null
}

interface PartnerSearchModalProps {
  tournamentId: number
  onClose: () => void
  onSelect: (playerId: number, playerName: string) => void
}

const PartnerSearchModal = ({ tournamentId, onClose, onSelect }: PartnerSearchModalProps) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null)
  const [recentPartners, setRecentPartners] = useState<Player[]>([])
  const [recentLoading, setRecentLoading] = useState(false)

  useEffect(() => {
    // Загружаем рекомендации по истории напарников
    const loadRecentPartners = async () => {
      try {
        setRecentLoading(true)
        // Используем API мини-аппа для получения рекомендаций
        const response = await fetch(`/api/mini-app/tournaments/${tournamentId}/recent_partners/`, {
          headers: {
            'X-Telegram-Init-Data': (window as any).Telegram?.WebApp?.initData || ''
          }
        })
        if (response.ok) {
          const data = await response.json()
          setRecentPartners(data.players || [])
        }
      } catch (err) {
        console.error('Ошибка загрузки рекомендаций:', err)
        setRecentPartners([])
      } finally {
        setRecentLoading(false)
      }
    }

    loadRecentPartners()
  }, [tournamentId])

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      return
    }

    try {
      setLoading(true)
      setSearched(true)
      setSelectedPlayer(null)
      hapticFeedback.light()
      
      // Вызываем API для поиска игроков
      const response = await miniAppAPI.searchPlayers(tournamentId, searchQuery.trim())
      
      setPlayers(response.players || [])
    } catch (err: any) {
      console.error('Ошибка поиска:', err)
      setPlayers([])
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (player: Player) => {
    if (player.is_registered) return
    hapticFeedback.medium()
    setSelectedPlayer(player)
  }

  const handleConfirm = () => {
    if (!selectedPlayer) return
    hapticFeedback.success()
    onSelect(selectedPlayer.id, selectedPlayer.full_name)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Заголовок */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">Поиск напарника</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* Контент */}
        <div className="p-6">
          {/* Поле поиска */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              ФИО напарника
            </label>
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
                onClick={handleSearch}
                disabled={loading || !searchQuery.trim()}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '⏳' : '🔍 Найти'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Введите фамилию и имя напарника
            </p>
          </div>

          {/* Рекомендации по истории */}
          {recentPartners.length > 0 && !searched && (
            <div className="mb-4 space-y-2">
              <h3 className="font-semibold text-gray-900 mb-2">Рекомендации по вашей истории:</h3>
              {recentLoading && (
                <div className="text-sm text-gray-500">Загрузка...</div>
              )}
              {!recentLoading &&
                recentPartners.map((player) => (
                  <button
                    key={player.id}
                    onClick={() => handleSelect(player)}
                    disabled={player.is_registered}
                    className={`w-full text-left p-3 rounded-lg border ${
                      player.is_registered
                        ? 'bg-gray-50 border-gray-300 cursor-not-allowed'
                        : selectedPlayer?.id === player.id
                        ? 'bg-blue-50 border-blue-300'
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
                      {!player.is_registered && selectedPlayer?.id !== player.id && (
                        <span className="ml-3 px-3 py-1 text-xs rounded-full bg-green-100 text-green-700">
                          В пару
                        </span>
                      )}
                      {selectedPlayer?.id === player.id && (
                        <span className="ml-3 px-3 py-1 text-xs rounded-full bg-blue-100 text-blue-700">
                          ✓ Выбран
                        </span>
                      )}
                    </div>
                  </button>
                ))}
            </div>
          )}

          {/* Результаты поиска */}
          {searched && (
            <div className="space-y-2">
              {loading ? (
                <div className="text-center py-8 text-gray-500">
                  Поиск...
                </div>
              ) : players.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-600 mb-2">Игроки не найдены</p>
                  <p className="text-sm text-gray-500">
                    Попробуйте изменить запрос
                  </p>
                </div>
              ) : (
                <>
                  <h3 className="font-semibold text-gray-900 mb-2">
                    Найдено игроков: {players.length}
                  </h3>
                  {players.map((player) => (
                    <button
                      key={player.id}
                      onClick={() => handleSelect(player)}
                      disabled={player.is_registered}
                      className={`w-full text-left p-3 rounded-lg border ${
                        player.is_registered
                          ? 'bg-gray-50 border-gray-300 cursor-not-allowed'
                          : selectedPlayer?.id === player.id
                          ? 'bg-blue-50 border-blue-300'
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
                            <div className="text-xs text-gray-500 mt-1">
                              Уже зарегистрирован на турнир
                            </div>
                          )}
                        </div>
                        {!player.is_registered && selectedPlayer?.id !== player.id && (
                          <span className="ml-3 px-3 py-1 text-xs rounded-full bg-green-100 text-green-700">
                            В пару
                          </span>
                        )}
                        {selectedPlayer?.id === player.id && (
                          <span className="ml-3 px-3 py-1 text-xs rounded-full bg-blue-100 text-blue-700">
                            ✓ Выбран
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
              <p className="text-sm">
                Будут показаны игроки, зарегистрированные в системе
              </p>
            </div>
          )}

          {/* Подтверждение выбора */}
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

          {/* Кнопки действий */}
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"
            >
              Отмена
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedPlayer}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Зарегистрироваться парой
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PartnerSearchModal
