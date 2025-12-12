/**
 * Страница приглашений в Mini App
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { miniAppAPI, PairInvitation } from '../../api/miniApp'
import { showBackButton, hideBackButton, hapticFeedback } from '../../utils/telegram'

const MiniAppInvitations = () => {
  const navigate = useNavigate()
  const [invitations, setInvitations] = useState<PairInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<number | null>(null)

  useEffect(() => {
    showBackButton(() => {
      hapticFeedback.light()
      navigate('/mini-app')
    })

    return () => {
      hideBackButton()
    }
  }, [navigate])

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
      
      await loadInvitations()
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
      
      await loadInvitations()
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

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-gray-500">Загрузка...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-600">{error}</p>
          <button
            onClick={loadInvitations}
            className="mt-2 text-sm text-red-700 underline"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center">
        <span className="mr-2">📬</span>
        Приглашения
      </h1>

      {invitations.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-8 text-center">
          <div className="text-6xl mb-4">📭</div>
          <p className="text-gray-500 text-lg">Нет новых приглашений</p>
          <p className="text-gray-400 text-sm mt-2">
            Когда кто-то пригласит вас в пару, приглашение появится здесь
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {invitations.map((invitation) => (
            <div
              key={invitation.id}
              className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-blue-500"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="font-semibold text-gray-900 text-lg">
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
                <div className="mb-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-700">
                  💬 {invitation.message}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => handleAccept(invitation.id)}
                  disabled={processingId === invitation.id}
                  className="flex-1 py-2.5 bg-green-500 text-white font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {processingId === invitation.id ? '⏳ Обработка...' : '✅ Принять'}
                </button>
                <button
                  onClick={() => handleDecline(invitation.id)}
                  disabled={processingId === invitation.id}
                  className="flex-1 py-2.5 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {processingId === invitation.id ? '⏳ Обработка...' : '❌ Отклонить'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default MiniAppInvitations
