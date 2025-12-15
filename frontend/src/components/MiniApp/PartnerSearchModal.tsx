/**
 * Модальное окно для поиска напарника
 */
import { useState } from 'react'
import { miniAppAPI } from '../../api/miniApp'

interface Player {
  id: number
  full_name: string
  is_registered: boolean
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

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      return
    }

    try {
      setLoading(true)
      setSearched(true)
      
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
                    <div
                      key={player.id}
                      className={`p-3 rounded-lg border ${
                        player.is_registered
                          ? 'bg-gray-50 border-gray-300'
                          : 'bg-white border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">
                            {player.full_name}
                          </div>
                          {player.is_registered && (
                            <div className="text-xs text-gray-500 mt-1">
                              Уже зарегистрирован на турнир
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => onSelect(player.id, player.full_name)}
                          disabled={player.is_registered}
                          className={`ml-3 px-4 py-2 text-sm rounded-lg ${
                            player.is_registered
                              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                              : 'bg-green-500 text-white hover:bg-green-600'
                          }`}
                        >
                          {player.is_registered ? 'Недоступен' : 'Выбрать'}
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {!searched && (
            <div className="text-center py-8 text-gray-500">
              <p className="mb-2">Введите ФИО и нажмите "Найти"</p>
              <p className="text-sm">
                Будут показаны игроки, зарегистрированные в системе
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default PartnerSearchModal
