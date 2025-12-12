/**
 * Страница списка турниров в Mini App
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { miniAppAPI, Tournament } from '../../api/miniApp'
import { showBackButton, hideBackButton, hapticFeedback } from '../../utils/telegram'

const MiniAppTournaments = () => {
  const navigate = useNavigate()
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'created' | 'active'>('all')

  useEffect(() => {
    // Показываем кнопку "Назад"
    showBackButton(() => {
      hapticFeedback.light()
      navigate('/mini-app')
    })

    return () => {
      hideBackButton()
    }
  }, [navigate])

  useEffect(() => {
    loadTournaments()
  }, [filter])

  const loadTournaments = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await miniAppAPI.getTournaments(
        filter === 'all' ? undefined : filter
      )
      setTournaments(data)
    } catch (err) {
      setError('Ошибка загрузки турниров')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleTournamentClick = (id: number) => {
    hapticFeedback.light()
    navigate(`/mini-app/tournaments/${id}`)
  }

  const handleFilterChange = (newFilter: 'all' | 'created' | 'active') => {
    hapticFeedback.light()
    setFilter(newFilter)
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'created':
        return <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">Регистрация</span>
      case 'active':
        return <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">В процессе</span>
      case 'completed':
        return <span className="px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded-full">Завершён</span>
      default:
        return null
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* Заголовок с логотипом */}
      <div className="bg-white rounded-lg shadow-sm p-4 flex items-center">
        <img
          src="/static/img/logo.png"
          alt="BeachPlay"
          className="h-8 w-8 rounded-md mr-3 object-contain"
        />
        <h1 className="text-2xl font-bold text-gray-900">🏆 Турниры</h1>
      </div>

      {/* Фильтры */}
      <div className="flex space-x-2 overflow-x-auto pb-2">
        <button
          onClick={() => handleFilterChange('all')}
          className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
            filter === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          Все
        </button>
        <button
          onClick={() => handleFilterChange('created')}
          className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
            filter === 'created'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          Регистрация
        </button>
        <button
          onClick={() => handleFilterChange('active')}
          className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
            filter === 'active'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          В процессе
        </button>
      </div>

      {/* Список турниров */}
      {loading && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600">Загрузка...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          <button
            onClick={loadTournaments}
            className="mt-2 text-red-600 hover:text-red-800 font-medium"
          >
            Попробовать снова
          </button>
        </div>
      )}

      {!loading && !error && tournaments.length === 0 && (
        <div className="bg-gray-50 rounded-lg p-8 text-center">
          <p className="text-gray-600">Турниры не найдены</p>
        </div>
      )}

      {!loading && !error && tournaments.length > 0 && (
        <div className="space-y-3">
          {tournaments.map((tournament) => (
            <button
              key={tournament.id}
              onClick={() => handleTournamentClick(tournament.id)}
              className="w-full bg-white rounded-lg shadow-sm p-4 text-left hover:shadow-md transition-shadow"
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-semibold text-gray-900 flex-1">
                  {tournament.name}
                </h3>
                {getStatusBadge(tournament.status)}
              </div>
              
              <div className="space-y-1 text-sm text-gray-600">
                <div className="flex items-center">
                  <span className="mr-2">📅</span>
                  {formatDate(tournament.date)}
                </div>
                <div className="flex items-center">
                  <span className="mr-2">📍</span>
                  {tournament.venue_name}
                </div>
                <div className="flex items-center">
                  <span className="mr-2">👥</span>
                  {tournament.participants_count} / {tournament.max_teams} команд
                </div>
              </div>

              {tournament.is_registered && (
                <div className="mt-2 px-2 py-1 bg-green-50 text-green-700 text-xs rounded inline-block">
                  ✓ Вы зарегистрированы
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default MiniAppTournaments
