/**
 * Модальное окно для отмены регистрации
 */
import { useState } from 'react'
import { miniAppAPI } from '../../api/miniApp'
import { hapticFeedback } from '../../utils/telegram'

interface CancelRegistrationModalProps {
  tournamentId: number
  tournamentName: string
  hasPartner: boolean
  onClose: () => void
  onSuccess: () => void
}

const CancelRegistrationModal = ({ 
  tournamentId, 
  tournamentName, 
  hasPartner, 
  onClose, 
  onSuccess 
}: CancelRegistrationModalProps) => {
  const [loading, setLoading] = useState(false)

  const handleLeavePair = async () => {
    try {
      setLoading(true)
      hapticFeedback.medium()
      
      await miniAppAPI.leavePair(tournamentId)
      
      hapticFeedback.success()
      alert('✅ Вы покинули пару. Теперь вы в списке "Ищу пару"')
      onSuccess()
      onClose()
    } catch (err: any) {
      hapticFeedback.error()
      const errorMessage = err.response?.data?.error || 'Ошибка'
      alert(`❌ ${errorMessage}`)
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelRegistration = async () => {
    try {
      setLoading(true)
      hapticFeedback.medium()
      
      await miniAppAPI.cancelRegistration(tournamentId)
      
      hapticFeedback.success()
      alert('✅ Регистрация полностью отменена')
      onSuccess()
      onClose()
    } catch (err: any) {
      hapticFeedback.error()
      const errorMessage = err.response?.data?.error || 'Ошибка'
      alert(`❌ ${errorMessage}`)
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full">
        {/* Заголовок */}
        <div className="border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">Отказаться от турнира</h2>
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
          <p className="text-gray-700 mb-6">
            Выберите действие для турнира <strong>{tournamentName}</strong>:
          </p>

          <div className="space-y-3">
            {hasPartner && (
              <button
                onClick={handleLeavePair}
                disabled={loading}
                className="w-full p-4 border-2 border-orange-300 rounded-lg hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed text-left transition-colors"
              >
                <div className="font-semibold text-gray-900 mb-1">
                  🔄 Отказаться от текущей пары
                </div>
                <div className="text-sm text-gray-600">
                  Вы и ваш напарник перейдёте в список "Ищу пару". Вы потеряете свою позицию в списках регистрации.
                </div>
              </button>
            )}

            <button
              onClick={handleCancelRegistration}
              disabled={loading}
              className="w-full p-4 border-2 border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed text-left transition-colors"
            >
              <div className="font-semibold text-gray-900 mb-1">
                ❌ Покинуть турнир полностью
              </div>
              <div className="text-sm text-gray-600">
                {hasPartner 
                  ? 'Вы будете удалены из всех списков турнира. Ваш напарник перейдёт в список "Ищу пару".'
                  : 'Вы будете удалены из всех списков турнира.'}
              </div>
            </button>
          </div>

          {loading && (
            <div className="mt-4 text-center text-gray-500">
              Обработка...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default CancelRegistrationModal
