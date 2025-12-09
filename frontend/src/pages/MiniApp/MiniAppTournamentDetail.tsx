/**
 * Страница деталей турнира в Mini App
 */
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { miniAppAPI, Tournament } from '../../api/miniApp'
import {
  showBackButton,
  hideBackButton,
  showMainButton,
  hideMainButton,
  hapticFeedback,
} from '../../utils/telegram'

const MiniAppTournamentDetail = () => {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [registering, setRegistering] = useState(false)

  useEffect(() => {
    // Показываем кнопку "Назад"
    showBackButton(() => {
      hapticFeedback.light()
      navigate('/mini-app/tournaments')
    })

    return () => {
      hideBackButton()
      hideMainButton()
    }
  }, [navigate])

  useEffect(() => {
    if (id) {
      loadTournament(parseInt(id))
    }
  }, [id])

  useEffect(() => {
    // Показываем кнопку регистрации, если турнир открыт и не зарегистрированы
    if (tournament && tournament.status === 'created' && !tournament.is_registered) {
      showMainButton('Зарегистрироваться', handleRegister)
    } else {
      hideMainButton()
    }
  }, [tournament])

  const loadTournament = async (tournamentId: number) => {
    try {
      setLoading(true)
      setError(null)
      const data = await miniAppAPI.getTournamentDetail(tournamentId)
      setTournament(data)
    } catch (err) {
      setError('Ошибка загрузки турнира')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    if (!tournament) return

    try {
      setRegistering(true)
      hapticFeedback.medium()
      
      await miniAppAPI.registerForTournament(tournament.id)
      
      hapticFeedback.success()
      
      // Перезагружаем данные турнира
      await loadTournament(tournament.id)
      
      alert('✅ Вы успешно зарегистрированы на турнир!')
    } catch (err: any) {
      hapticFeedback.error()
      const errorMessage = err.response?.data?.error || 'Ошибка регистрации'
      alert(`❌ ${errorMessage}`)
      console.error(err)
    } finally {
      setRegistering(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'created':
        return <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">Регистрация открыта</span>
      case 'active':
        return <span className="px-3 py-1 bg-green-100 text-green-800 text-sm rounded-full">В процессе</span>
      case 'completed':
        return <span className="px-3 py-1 bg-gray-100 text-gray-800 text-sm rounded-full">Завершён</span>
      default:
        return null
    }
  }

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Загрузка...</p>
        </div>
      </div>
    )
  }

  if (error || !tournament) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-800 mb-4">{error || 'Турнир не найден'}</p>
          <button
            onClick={() => navigate('/mini-app/tournaments')}
            className="text-red-600 hover:text-red-800 font-medium"
          >
            ← Вернуться к списку
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 pb-20">
      {/* Заголовок */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex justify-between items-start mb-3">
          <h1 className="text-2xl font-bold text-gray-900 flex-1">
            {tournament.name}
          </h1>
          {getStatusBadge(tournament.status)}
        </div>
        
        {tournament.is_registered && (
          <div className="mt-3 px-3 py-2 bg-green-50 text-green-700 rounded-lg flex items-center">
            <span className="mr-2">✓</span>
            <span className="font-medium">Вы зарегистрированы на этот турнир</span>
          </div>
        )}
      </div>

      {/* Основная информация */}
      <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
        <h2 className="font-semibold text-gray-900 text-lg mb-3">📋 Информация</h2>
        
        <div className="space-y-3">
          <div className="flex items-start">
            <span className="text-xl mr-3">📅</span>
            <div>
              <div className="text-sm text-gray-500">Дата и время</div>
              <div className="font-medium text-gray-900">{formatDate(tournament.date)}</div>
            </div>
          </div>

          <div className="flex items-start">
            <span className="text-xl mr-3">📍</span>
            <div>
              <div className="text-sm text-gray-500">Место проведения</div>
              <div className="font-medium text-gray-900">{tournament.venue_name}</div>
              {tournament.venue_address && (
                <div className="text-sm text-gray-600">{tournament.venue_address}</div>
              )}
            </div>
          </div>

          <div className="flex items-start">
            <span className="text-xl mr-3">👥</span>
            <div>
              <div className="text-sm text-gray-500">Участники</div>
              <div className="font-medium text-gray-900">
                {tournament.participants_count} / {tournament.max_teams} команд
              </div>
            </div>
          </div>

          {tournament.organizer_name && (
            <div className="flex items-start">
              <span className="text-xl mr-3">👤</span>
              <div>
                <div className="text-sm text-gray-500">Организатор</div>
                <div className="font-medium text-gray-900">{tournament.organizer_name}</div>
              </div>
            </div>
          )}

          {tournament.entry_fee && (
            <div className="flex items-start">
              <span className="text-xl mr-3">💰</span>
              <div>
                <div className="text-sm text-gray-500">Взнос</div>
                <div className="font-medium text-gray-900">{tournament.entry_fee} ₽</div>
              </div>
            </div>
          )}

          {tournament.prize_fund && (
            <div className="flex items-start">
              <span className="text-xl mr-3">🏆</span>
              <div>
                <div className="text-sm text-gray-500">Призовой фонд</div>
                <div className="font-medium text-gray-900">{tournament.prize_fund} ₽</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Описание */}
      {tournament.description && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 text-lg mb-3">📝 Описание</h2>
          <p className="text-gray-700 whitespace-pre-wrap">{tournament.description}</p>
        </div>
      )}

      {/* Кнопка регистрации (для мобильных устройств без MainButton) */}
      {tournament.status === 'created' && !tournament.is_registered && (
        <div className="md:block lg:hidden">
          <button
            onClick={handleRegister}
            disabled={registering}
            className="w-full bg-blue-600 text-white rounded-lg p-4 font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {registering ? 'Регистрация...' : 'Зарегистрироваться'}
          </button>
        </div>
      )}
    </div>
  )
}

export default MiniAppTournamentDetail
