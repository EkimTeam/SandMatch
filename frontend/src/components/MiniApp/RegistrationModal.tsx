/**
 * Модальное окно для регистрации на турнир
 */
import { useState } from 'react'
import { miniAppAPI } from '../../api/miniApp'
import { hapticFeedback } from '../../utils/telegram'

interface RegistrationModalProps {
  tournamentId: number
  tournamentName: string
  isIndividual: boolean
  onClose: () => void
  onSuccess: () => void
}

const RegistrationModal = ({ tournamentId, tournamentName, isIndividual, onClose, onSuccess }: RegistrationModalProps) => {
  const [mode, setMode] = useState<'select' | 'single' | 'looking' | 'with-partner'>('select')
  const [partnerSearch, setPartnerSearch] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRegisterSingle = async () => {
    try {
      setLoading(true)
      hapticFeedback.medium()
      
      await miniAppAPI.registerSingle(tournamentId)
      
      hapticFeedback.success()
      alert('✅ Вы зарегистрированы на турнир')
      onSuccess()
      onClose()
    } catch (err: any) {
      hapticFeedback.error()
      const errorMessage = err.response?.data?.error || 'Ошибка регистрации'
      alert(`❌ ${errorMessage}`)
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleRegisterLookingForPartner = async () => {
    try {
      setLoading(true)
      hapticFeedback.medium()
      
      await miniAppAPI.registerLookingForPartner(tournamentId)
      
      hapticFeedback.success()
      alert('✅ Вы зарегистрированы в режиме "Ищу пару"')
      onSuccess()
      onClose()
    } catch (err: any) {
      hapticFeedback.error()
      const errorMessage = err.response?.data?.error || 'Ошибка регистрации'
      alert(`❌ ${errorMessage}`)
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleRegisterWithPartner = async () => {
    if (!partnerSearch.trim()) {
      alert('❌ Введите ФИО напарника')
      return
    }

    try {
      setLoading(true)
      hapticFeedback.medium()
      
      await miniAppAPI.registerWithPartner(tournamentId, partnerSearch.trim())
      
      hapticFeedback.success()
      alert('✅ Вы зарегистрированы с напарником!\n\nНапарнику отправлено уведомление.')
      onSuccess()
      onClose()
    } catch (err: any) {
      hapticFeedback.error()
      const errorData = err.response?.data
      
      // Обработка множественных результатов
      if (errorData?.players && Array.isArray(errorData.players)) {
        const playersList = errorData.players.map((p: any) => p.full_name).join('\n')
        alert(`❌ Найдено несколько игроков. Уточните запрос:\n\n${playersList}`)
      } else {
        const errorMessage = errorData?.error || 'Ошибка регистрации'
        alert(`❌ ${errorMessage}`)
      }
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Заголовок */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">Регистрация</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              ×
            </button>
          </div>
          <p className="text-sm text-gray-600 mt-1">{tournamentName}</p>
        </div>

        {/* Контент */}
        <div className="p-6">
          {/* Индивидуальный турнир - простая регистрация */}
          {isIndividual && mode === 'select' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start">
                  <span className="text-2xl mr-3">🎾</span>
                  <div>
                    <div className="font-semibold text-gray-900 mb-2">Индивидуальный турнир</div>
                    <div className="text-sm text-gray-700">
                      Вы будете зарегистрированы как одиночный участник
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleRegisterSingle}
                disabled={loading}
                className="w-full py-3 bg-blue-500 text-white font-semibold rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Регистрация...' : 'Зарегистрироваться'}
              </button>
            </div>
          )}

          {/* Парный турнир - выбор режима */}
          {!isIndividual && mode === 'select' && (
            <div className="space-y-4">
              <p className="text-gray-700 mb-4">Выберите способ регистрации:</p>
              
              <button
                onClick={() => setMode('looking')}
                className="w-full p-4 bg-blue-50 border-2 border-blue-200 rounded-xl hover:bg-blue-100 transition-colors text-left"
              >
                <div className="flex items-start">
                  <span className="text-2xl mr-3">🔍</span>
                  <div>
                    <div className="font-semibold text-gray-900">Ищу пару</div>
                    <div className="text-sm text-gray-600 mt-1">
                      Другие участники смогут пригласить вас в пару
                    </div>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setMode('with-partner')}
                className="w-full p-4 bg-green-50 border-2 border-green-200 rounded-xl hover:bg-green-100 transition-colors text-left"
              >
                <div className="flex items-start">
                  <span className="text-2xl mr-3">🤝</span>
                  <div>
                    <div className="font-semibold text-gray-900">С напарником</div>
                    <div className="text-sm text-gray-600 mt-1">
                      Зарегистрироваться сразу с конкретным игроком
                    </div>
                  </div>
                </div>
              </button>
            </div>
          )}

          {mode === 'looking' && (
            <div className="space-y-4">
              <button
                onClick={() => setMode('select')}
                className="text-blue-600 hover:text-blue-700 text-sm mb-2"
              >
                ← Назад
              </button>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start">
                  <span className="text-2xl mr-3">🔍</span>
                  <div>
                    <div className="font-semibold text-gray-900 mb-2">Режим "Ищу пару"</div>
                    <div className="text-sm text-gray-700 space-y-1">
                      <p>• Вы будете видны в списке ищущих пару</p>
                      <p>• Другие участники смогут отправить вам приглашение</p>
                      <p>• После принятия приглашения вы попадёте в основной состав или резерв</p>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleRegisterLookingForPartner}
                disabled={loading}
                className="w-full py-3 bg-blue-500 text-white font-semibold rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Регистрация...' : 'Зарегистрироваться'}
              </button>
            </div>
          )}

          {mode === 'with-partner' && (
            <div className="space-y-4">
              <button
                onClick={() => setMode('select')}
                className="text-blue-600 hover:text-blue-700 text-sm mb-2"
              >
                ← Назад
              </button>
              
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-start">
                  <span className="text-2xl mr-3">🤝</span>
                  <div>
                    <div className="font-semibold text-gray-900 mb-2">Регистрация с напарником</div>
                    <div className="text-sm text-gray-700 space-y-1">
                      <p>• Вы и ваш напарник сразу попадёте в основной состав или резерв</p>
                      <p>• Напарнику придёт уведомление о регистрации</p>
                      <p>• Если напарник откажется, вы перейдёте в режим "Ищу пару"</p>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ФИО напарника
                </label>
                <input
                  type="text"
                  value={partnerSearch}
                  onChange={(e) => setPartnerSearch(e.target.value)}
                  placeholder="Иванов Иван"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Введите фамилию и имя напарника для поиска
                </p>
              </div>

              <button
                onClick={handleRegisterWithPartner}
                disabled={loading || !partnerSearch.trim()}
                className="w-full py-3 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Регистрация...' : 'Зарегистрироваться'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default RegistrationModal
