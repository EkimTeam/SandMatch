/**
 * Главная страница Telegram Mini App
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTelegramUser, hapticFeedback } from '../../utils/telegram'

const MiniAppHome = () => {
  const navigate = useNavigate()
  const user = getTelegramUser()

  useEffect(() => {
    // Haptic feedback при загрузке
    hapticFeedback.light()
  }, [])

  const handleNavigate = (path: string) => {
    hapticFeedback.light()
    navigate(path)
  }

  return (
    <div className="p-4 space-y-6">
      {/* Приветствие */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Привет, {user?.first_name || 'Игрок'}! 👋
        </h1>
        <p className="text-gray-600">
          Добро пожаловать в BeachPlay Mini App
        </p>
      </div>

      {/* Быстрые действия */}
      <div className="space-y-3">
        <button
          onClick={() => handleNavigate('/mini-app/tournaments')}
          className="w-full bg-blue-600 text-white rounded-lg p-4 flex items-center justify-between hover:bg-blue-700 transition-colors"
        >
          <div className="flex items-center space-x-3">
            <span className="text-2xl">🏆</span>
            <div className="text-left">
              <div className="font-semibold">Турниры</div>
              <div className="text-sm text-blue-100">Смотреть и регистрироваться</div>
            </div>
          </div>
          <span className="text-xl">→</span>
        </button>

        <button
          onClick={() => handleNavigate('/mini-app/profile')}
          className="w-full bg-purple-600 text-white rounded-lg p-4 flex items-center justify-between hover:bg-purple-700 transition-colors"
        >
          <div className="flex items-center space-x-3">
            <span className="text-2xl">👤</span>
            <div className="text-left">
              <div className="font-semibold">Мой профиль</div>
              <div className="text-sm text-purple-100">Статистика и рейтинг</div>
            </div>
          </div>
          <span className="text-xl">→</span>
        </button>

        <button
          onClick={() => handleNavigate('/mini-app/my-tournaments')}
          className="w-full bg-green-600 text-white rounded-lg p-4 flex items-center justify-between hover:bg-green-700 transition-colors"
        >
          <div className="flex items-center space-x-3">
            <span className="text-2xl">📋</span>
            <div className="text-left">
              <div className="font-semibold">Мои турниры</div>
              <div className="text-sm text-green-100">Турниры, в которых участвую</div>
            </div>
          </div>
          <span className="text-xl">→</span>
        </button>
      </div>

      {/* Информация */}
      <div className="bg-gray-100 rounded-lg p-4">
        <h3 className="font-semibold text-gray-900 mb-2">ℹ️ Информация</h3>
        <p className="text-sm text-gray-600">
          Это Mini App для управления турнирами по пляжному теннису.
          Здесь вы можете просматривать турниры, регистрироваться на них
          и следить за своей статистикой.
        </p>
      </div>
    </div>
  )
}

export default MiniAppHome
