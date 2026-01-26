/**
 * Страница "Мои турниры" в Mini App
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { miniAppAPI, Tournament } from '../../api/miniApp'
import { showBackButton, hideBackButton, hapticFeedback, openLink } from '../../utils/telegram'

const MiniAppMyTournaments = () => {
  const navigate = useNavigate()
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
    loadMyTournaments()
  }, [])

  const loadMyTournaments = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await miniAppAPI.getMyTournaments()
      setTournaments(data)
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || 'Ошибка загрузки турниров'
      setError(errorMessage)
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleTournamentClick = (id: number) => {
    hapticFeedback.light()
    navigate(`/mini-app/tournaments/${id}`, { state: { from: 'my-tournaments' } })
  }

  const handleOpenAllTournaments = () => {
    hapticFeedback.light()
    openLink('https://beachplay.ru/tournaments')
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'created':
        return <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">Предстоящий</span>
      case 'active':
        return <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">В процессе</span>
      case 'completed':
        return <span className="px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded-full">Завершён</span>
      default:
        return null
    }
  }

  // Группируем турниры по статусу
  const activeTournaments = tournaments.filter(t => t.status === 'active')
  const upcomingTournaments = tournaments.filter(t => t.status === 'created')
  const completedTournaments = tournaments.filter(t => t.status === 'completed')

  return (
    <div className="p-4 space-y-4">
      {/* Заголовок */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h1 className="text-2xl font-bold text-gray-900">📋 Мои турниры</h1>
        {!loading && !error && (
          <p className="text-sm text-gray-600 mt-1">
            Всего турниров: {tournaments.length}
          </p>
        )}
      </div>

      {/* Загрузка */}
      {loading && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600">Загрузка...</p>
        </div>
      )}

      {/* Ошибка */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          <button
            onClick={loadMyTournaments}
            className="mt-2 text-red-600 hover:text-red-800 font-medium"
          >
            Попробовать снова
          </button>
        </div>
      )}

      {/* Пустой список */}
      {!loading && !error && tournaments.length === 0 && (
        <div className="bg-gray-50 rounded-lg p-8 text-center">
          <p className="text-gray-600 mb-4">Вы пока не участвуете в турнирах</p>
          <button
            onClick={() => navigate('/mini-app/tournaments')}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Найти турниры
          </button>
        </div>
      )}

      {/* Активные турниры */}
      {!loading && !error && activeTournaments.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            🔥 Активные турниры
          </h2>
          <div className="space-y-3">
            {activeTournaments.map((tournament) => (
              <button
                key={tournament.id}
                onClick={() => handleTournamentClick(tournament.id)}
                className="w-full bg-white rounded-lg shadow-sm p-4 text-left hover:shadow-md transition-shadow border-l-4 border-green-500"
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
                    <span>
                      {formatDate(tournament.date)}
                      {tournament.start_time ? ` • ${tournament.start_time}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span className="mr-2">📍</span>
                    {tournament.venue_name}
                  </div>
                  <div className="flex items-center">
                    <span className="mr-2">👥</span>
                    {tournament.participants_count} / {tournament.max_teams} команд
                  </div>
                  {tournament.avg_rating_bp && (
                    <div className="flex items-center">
                      <span className="mr-2">⭐</span>
                      Средний рейтинг: {tournament.avg_rating_bp}
                    </div>
                  )}
                  <div className="flex items-center">
                    <span className="mr-2">📋</span>
                    {tournament.set_format_name || 'Формат не указан'}
                  </div>
                  {tournament.prize_fund && (
                    <div className="flex items-center">
                      <span className="mr-2">🏆</span>
                      Призовой фонд: {tournament.prize_fund}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Предстоящие турниры */}
      {!loading && !error && upcomingTournaments.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            📅 Предстоящие турниры
          </h2>
          <div className="space-y-3">
            {upcomingTournaments.map((tournament) => (
              <button
                key={tournament.id}
                onClick={() => handleTournamentClick(tournament.id)}
                className="w-full bg-white rounded-lg shadow-sm p-4 text-left hover:shadow-md transition-shadow border-l-4 border-blue-500"
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
                    <span>
                      {formatDate(tournament.date)}
                      {tournament.start_time ? ` • ${tournament.start_time}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span className="mr-2">📍</span>
                    {tournament.venue_name}
                  </div>
                  <div className="flex items-center">
                    <span className="mr-2">👥</span>
                    {tournament.participants_count} / {tournament.max_teams} команд
                  </div>
                  {tournament.avg_rating_bp && (
                    <div className="flex items-center">
                      <span className="mr-2">⭐</span>
                      Средний рейтинг: {tournament.avg_rating_bp}
                    </div>
                  )}
                  <div className="flex items-center">
                    <span className="mr-2">📋</span>
                    {tournament.set_format_name || 'Формат не указан'}
                  </div>
                  {tournament.prize_fund && (
                    <div className="flex items-center">
                      <span className="mr-2">🏆</span>
                      Призовой фонд: {tournament.prize_fund}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Завершённые турниры */}
      {!loading && !error && completedTournaments.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            ✅ Завершённые турниры
          </h2>
          <div className="space-y-3">
            {completedTournaments.map((tournament) => (
              <button
                key={tournament.id}
                onClick={() => handleTournamentClick(tournament.id)}
                className="w-full bg-white rounded-lg shadow-sm p-4 text-left hover:shadow-md transition-shadow border-l-4 border-gray-300"
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
                  {tournament.my_place && (
                    <div className="flex items-center">
                      <span className="mr-2">🏆</span>
                      Моё место: {tournament.my_place}
                    </div>
                  )}
                  {tournament.winner && (
                    <div className="flex items-center">
                      <span className="mr-2">🥇</span>
                      Победитель: {tournament.winner}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ссылка на все турниры на сайте */}
      {!loading && !error && (
        <button
          onClick={handleOpenAllTournaments}
          className="w-full bg-gray-100 text-gray-800 rounded-lg p-4 text-center text-sm hover:bg-gray-200 transition-colors"
        >
          Все турниры можно посмотреть на BeachPlay.ru
        </button>
      )}
    </div>
  )
}

export default MiniAppMyTournaments
