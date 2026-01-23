/**
 * Страница деталей турнира в Mini App
 */
import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { miniAppAPI, Tournament, Profile } from '../../api/miniApp'
import {
  showBackButton,
  hideBackButton,
  showMainButton,
  hideMainButton,
  hapticFeedback,
} from '../../utils/telegram'
import TournamentParticipants from '../../components/MiniApp/TournamentParticipants'
import RegistrationModal from '../../components/MiniApp/RegistrationModal'
import InvitationsModal from '../../components/MiniApp/InvitationsModal'
import CancelRegistrationModal from '../../components/MiniApp/CancelRegistrationModal'

const MiniAppTournamentDetail = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [myRegistration, setMyRegistration] = useState<any>(null)
  const [showRegistrationModal, setShowRegistrationModal] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [showInvitationsModal, setShowInvitationsModal] = useState(false)
  const [showParticipants, setShowParticipants] = useState(true)

  useEffect(() => {
    // Показываем кнопку "Назад"
    showBackButton(() => {
      hapticFeedback.light()
      const from = (location.state as any)?.from
      if (from === 'my-tournaments') {
        navigate('/mini-app/my-tournaments')
      } else {
        navigate('/mini-app/tournaments')
      }
    })

    return () => {
      hideBackButton()
      hideMainButton()
    }
  }, [navigate, location])

  useEffect(() => {
    if (id) {
      loadTournament(parseInt(id))
      loadProfile()
      loadMyRegistration(parseInt(id))
    }
  }, [id])

  useEffect(() => {
    // Показываем кнопку регистрации, если турнир открыт и не зарегистрированы
    if (tournament && tournament.status === 'created' && !tournament.is_registered) {
      showMainButton('Зарегистрироваться', () => setShowRegistrationModal(true))
    } else if (tournament && tournament.status === 'created' && tournament.is_registered) {
      showMainButton('Отказаться от турнира', () => setShowCancelModal(true))
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

  const loadProfile = async () => {
    try {
      const data = await miniAppAPI.getProfile()
      setProfile(data)
    } catch (err) {
      console.error('Ошибка загрузки профиля:', err)
    }
  }

  const loadMyRegistration = async (tournamentId: number) => {
    try {
      const data = await miniAppAPI.getMyRegistration(tournamentId)
      if ('registered' in data && !data.registered) {
        setMyRegistration(null)
      } else {
        setMyRegistration(data)
      }
    } catch (err) {
      console.error('Ошибка загрузки регистрации:', err)
      setMyRegistration(null)
    }
  }

  const handleCancelRegistration = async () => {
    if (!tournament) return

    const confirmed = confirm('Вы уверены, что хотите отменить регистрацию?')
    if (!confirmed) return

    try {
      hapticFeedback.medium()
      
      await miniAppAPI.cancelRegistration(tournament.id)
      
      hapticFeedback.success()
      alert('Регистрация отменена')
      
      // Перезагружаем данные турнира
      await loadTournament(tournament.id)
    } catch (err: any) {
      hapticFeedback.error()
      const errorMessage = err.response?.data?.error || 'Ошибка отмены регистрации'
      alert(`❌ ${errorMessage}`)
      console.error(err)
    }
  }

  const handleCancelSuccess = async () => {
    if (!tournament) return
    // Перезагружаем данные турнира и регистрации
    await loadTournament(tournament.id)
    await loadMyRegistration(tournament.id)
  }

  const handleRegistrationSuccess = async () => {
    // Перезагружаем турнир после успешной регистрации
    if (tournament) {
      await loadTournament(tournament.id)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  const getSystemLabel = (system?: string) => {
    switch (system) {
      case 'round_robin':
        return 'Круговая система'
      case 'knockout':
        return 'Олимпийская система'
      case 'king':
        return 'Система "Кинг"'
      default:
        return 'Система не указана'
    }
  }

  const getParticipantModeLabel = (mode?: string) => {
    switch (mode) {
      case 'singles':
        return 'Индивидуальный турнир'
      case 'doubles':
        return 'Парный турнир'
      default:
        return ''
    }
  }

  const getSiteUrl = (t: Tournament) => {
    if (t.system === 'round_robin') {
      return `https://beachplay.ru/tournaments/${t.id}/round_robin`
    }
    if (t.system === 'king') {
      return `https://beachplay.ru/tournaments/${t.id}/king`
    }
    return `https://beachplay.ru/tournaments/${t.id}/knockout`
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
          <div className="mt-3 space-y-2">
            <div className="px-3 py-2 bg-green-50 text-green-700 rounded-lg flex items-center justify-between">
              <div className="flex items-center">
                <span className="mr-2">✓</span>
                <span className="font-medium">
                  {tournament.status === 'completed'
                    ? 'Вы принимали участие в этом турнире'
                    : 'Вы зарегистрированы на этот турнир'}
                </span>
              </div>
              {tournament.status !== 'completed' && (
                <button
                  onClick={handleCancelRegistration}
                  className="ml-2 px-3 py-1 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600 transition-colors"
                >
                  Отменить
                </button>
              )}
            </div>
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
              <div className="text-sm text-gray-500">Дата{tournament.start_time ? ' и время' : ''}</div>
              <div className="font-medium text-gray-900">
                {formatDate(tournament.date)}
                {tournament.start_time ? ` • ${tournament.start_time}` : ''}
              </div>
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
            <span className="text-xl mr-3">🎾</span>
            <div>
              <div className="text-sm text-gray-500">Тип турнира</div>
              <div className="font-medium text-gray-900">
                {getParticipantModeLabel(tournament.participant_mode)}
              </div>
            </div>
          </div>

          <div className="flex items-start">
            <span className="text-xl mr-3">👥</span>
            <div>
              <div className="text-sm text-gray-500">Участники</div>
              <div className="font-medium text-gray-900">
                {tournament.participants_count} / {tournament.max_teams} {tournament.participant_mode === 'singles' ? 'участников' : 'команд'}
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

      {/* Параметры турнира */}
      <div className="bg-white rounded-lg shadow-sm p-6 space-y-3">
        <h2 className="font-semibold text-gray-900 text-lg mb-3">⚙️ Параметры турнира</h2>
        <div className="space-y-2 text-sm text-gray-700">
          <div className="flex items-start">
            <span className="text-xl mr-3">🎯</span>
            <div>
              <div className="text-sm text-gray-500">Система проведения</div>
              <div className="font-medium text-gray-900">{getSystemLabel(tournament.system)}</div>
            </div>
          </div>

          <div className="flex items-start">
            <span className="text-xl mr-3">📏</span>
            <div>
              <div className="text-sm text-gray-500">Формат счёта</div>
              <div className="font-medium text-gray-900">
                {tournament.set_format_name || 'Формат не указан'}
              </div>
            </div>
          </div>

          {typeof tournament.avg_rating_bp === 'number' && (
            <div className="flex items-start">
              <span className="text-xl mr-3">⭐</span>
              <div>
                <div className="text-sm text-gray-500">Средний рейтинг участников</div>
                <div className="font-medium text-gray-900">{tournament.avg_rating_bp}</div>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => window.open(getSiteUrl(tournament), '_blank')}
          className="mt-4 w-full bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg py-3 text-sm font-medium transition-colors"
        >
          Больше деталей по турниру на сайте BeachPlay.ru
        </button>
      </div>

      {/* Описание */}
      {tournament.description && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 text-lg mb-3">📝 Описание</h2>
          <p className="text-gray-700 whitespace-pre-wrap">{tournament.description}</p>
        </div>
      )}

      {/* Участники турнира (только для турниров в статусе created) */}
      {tournament.status === 'created' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-lg">👥 Участники</h2>
            <button
              onClick={() => setShowParticipants(!showParticipants)}
              className="text-blue-600 text-sm font-medium"
            >
              {showParticipants ? 'Скрыть' : 'Показать'}
            </button>
          </div>
          
          {showParticipants && (
            <TournamentParticipants
              tournamentId={tournament.id}
              currentPlayerId={profile?.player?.id}
              currentPlayerStatus={myRegistration?.status}
              onInviteSent={handleRegistrationSuccess}
            />
          )}
        </div>
      )}

      {/* Модальные окна */}
      {showRegistrationModal && tournament && (
        <RegistrationModal
          tournamentId={tournament.id}
          tournamentName={tournament.name}
          isIndividual={tournament.participant_mode === 'singles'}
          onClose={() => setShowRegistrationModal(false)}
          onSuccess={handleRegistrationSuccess}
        />
      )}

      {showInvitationsModal && (
        <InvitationsModal
          onClose={() => setShowInvitationsModal(false)}
          onInvitationHandled={handleRegistrationSuccess}
        />
      )}

      {showCancelModal && tournament && myRegistration && (
        <CancelRegistrationModal
          tournamentId={tournament.id}
          tournamentName={tournament.name}
          hasPartner={!!myRegistration.partner_id}
          onClose={() => setShowCancelModal(false)}
          onSuccess={handleCancelSuccess}
        />
      )}
    </div>
  )
}

export default MiniAppTournamentDetail
