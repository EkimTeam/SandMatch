/**
 * Страница профиля в Mini App
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { miniAppAPI, Profile } from '../../api/miniApp'
import { showBackButton, hideBackButton, hapticFeedback, openLink } from '../../utils/telegram'

const MiniAppProfile = () => {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
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
    loadProfile()
  }, [])

  const loadProfile = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await miniAppAPI.getProfile()
      setProfile(data)
    } catch (err) {
      setError('Ошибка загрузки профиля')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleOpenWebsite = () => {
    hapticFeedback.light()
    openLink('https://beachplay.ru/profile')
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

  if (error || !profile) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-800 mb-4">{error || 'Профиль не найден'}</p>
          <button
            onClick={loadProfile}
            className="text-red-600 hover:text-red-800 font-medium"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Заголовок */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h1 className="text-2xl font-bold text-gray-900">👤 Мой профиль</h1>
      </div>

      {/* Информация о Telegram */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="font-semibold text-gray-900 text-lg mb-4">Telegram</h2>
        <div className="space-y-3">
          <div>
            <div className="text-sm text-gray-500">Имя</div>
            <div className="font-medium text-gray-900">
              {profile.first_name} {profile.last_name || ''}
            </div>
          </div>
          {profile.username && (
            <div>
              <div className="text-sm text-gray-500">Username</div>
              <div className="font-medium text-gray-900">@{profile.username}</div>
            </div>
          )}
          <div>
            <div className="text-sm text-gray-500">Telegram ID</div>
            <div className="font-medium text-gray-900">{profile.telegram_id}</div>
          </div>
        </div>
      </div>

      {/* Статус связывания */}
      {!profile.is_linked ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <div className="flex items-start">
            <span className="text-2xl mr-3">⚠️</span>
            <div className="flex-1">
              <h3 className="font-semibold text-yellow-900 mb-2">
                Аккаунт не связан
              </h3>
              <p className="text-sm text-yellow-800 mb-4">
                Свяжите ваш Telegram с аккаунтом на beachplay.ru, чтобы получить
                доступ ко всем функциям.
              </p>
              <button
                onClick={handleOpenWebsite}
                className="bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors"
              >
                Связать аккаунт
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Информация об игроке */}
          {profile.player ? (
            <>
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h2 className="font-semibold text-gray-900 text-lg mb-4">
                  🎾 Игровая статистика
                </h2>
                <div className="space-y-3">
                  <div>
                    <div className="text-sm text-gray-500">Полное имя</div>
                    <div className="font-medium text-gray-900 text-lg">
                      {profile.player.full_name}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">
                        {profile.player.rating}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">Рейтинг</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {profile.player.tournaments_played}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">Турниров</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-yellow-600">
                        {profile.player.tournaments_won}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">Побед</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Процент побед */}
              {profile.player.tournaments_played > 0 && (
                <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg shadow-sm p-6 text-white">
                  <div className="text-center">
                    <div className="text-4xl font-bold mb-2">
                      {Math.round(
                        (profile.player.tournaments_won / profile.player.tournaments_played) * 100
                      )}%
                    </div>
                    <div className="text-sm opacity-90">Процент побед</div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="bg-gray-50 rounded-lg p-6 text-center">
              <p className="text-gray-600">
                Информация об игроке не найдена
              </p>
            </div>
          )}

          {/* Ссылка на полный профиль */}
          <button
            onClick={handleOpenWebsite}
            className="w-full bg-blue-600 text-white rounded-lg p-4 flex items-center justify-between hover:bg-blue-700 transition-colors"
          >
            <span className="font-semibold">Открыть полный профиль</span>
            <span className="text-xl">→</span>
          </button>
        </>
      )}
    </div>
  )
}

export default MiniAppProfile
