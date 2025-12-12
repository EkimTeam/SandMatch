/**
 * Модальное окно для просмотра и управления приглашениями
 */
import { useState, useEffect } from 'react'
import { miniAppAPI, PairInvitation } from '../../api/miniApp'
import { hapticFeedback } from '../../utils/telegram'

interface InvitationsModalProps {
  onClose: () => void
  onInvitationHandled?: () => void
}

const InvitationsModal = ({ onClose, onInvitationHandled }: InvitationsModalProps) => {
  const [invitations, setInvitations] = useState<PairInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<number | null>(null)

  useEffect(() => {
    loadInvitations()
  }, [])

  const loadInvitations = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await miniAppAPI.getMyInvitations()
      setInvitations(data)
    } catch (err) {
      setError('Ошибка загрузки приглашений')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleAccept = async (invitationId: number) => {
    try {
      setProcessingId(invitationId)
      hapticFeedback.medium()
      
      await miniAppAPI.acceptInvitation(invitationId)
      
      hapticFeedback.success()
      alert('✅ Приглашение принято!')
      
      // Перезагружаем список
      await loadInvitations()
      
      if (onInvitationHandled) {
        onInvitationHandled()
      }
    } catch (err: any) {
      hapticFeedback.error()
      const errorMessage = err.response?.data?.error || 'Ошибка принятия приглашения'
      alert(`❌ ${errorMessage}`)
      console.error(err)
    } finally {
      setProcessingId(null)
    }
  }

  const handleDecline = async (invitationId: number) => {
    try {
      setProcessingId(invitationId)
      hapticFeedback.medium()
      
      await miniAppAPI.declineInvitation(invitationId)
      
      hapticFeedback.success()
      alert('Приглашение отклонено')
      
      // Перезагружаем список
      await loadInvitations()
      
      if (onInvitationHandled) {
        onInvitationHandled()
      }
    } catch (err: any) {
      hapticFeedback.error()
      const errorMessage = err.response?.data?.error || 'Ошибка отклонения приглашения'
      alert(`❌ ${errorMessage}`)
      console.error(err)
    } finally {
      setProcessingId(null)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    
    if (diffMins < 1) return 'только что'
    if (diffMins < 60) return `${diffMins} мин. назад`
    
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours} ч. назад`
    
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays} дн. назад`
    
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
    })
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Заголовок */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900 flex items-center">
              <span className="mr-2">📬</span>
              Приглашения
            </h2>
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
          {loading && (
            <div className="flex justify-center items-center py-8">
              <div className="text-gray-500">Загрузка...</div>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600">{error}</p>
              <button
                onClick={loadInvitations}
                className="mt-2 text-sm text-red-700 underline"
              >
                Попробовать снова
              </button>
            </div>
          )}

          {!loading && !error && invitations.length === 0 && (
            <div className="text-center py-8">
              <div className="text-6xl mb-4">📭</div>
              <p className="text-gray-500">Нет новых приглашений</p>
            </div>
          )}

          {!loading && !error && invitations.length > 0 && (
            <div className="space-y-4">
              {invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="p-4 bg-blue-50 border border-blue-200 rounded-xl"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900">
                        {invitation.sender_name}
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        приглашает вас в пару
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDate(invitation.created_at)}
                    </div>
                  </div>

                  {invitation.message && (
                    <div className="mb-3 p-3 bg-white rounded-lg text-sm text-gray-700">
                      💬 {invitation.message}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAccept(invitation.id)}
                      disabled={processingId === invitation.id}
                      className="flex-1 py-2 bg-green-500 text-white font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {processingId === invitation.id ? '⏳' : '✅ Принять'}
                    </button>
                    <button
                      onClick={() => handleDecline(invitation.id)}
                      disabled={processingId === invitation.id}
                      className="flex-1 py-2 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {processingId === invitation.id ? '⏳' : '❌ Отклонить'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default InvitationsModal
