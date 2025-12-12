/**
 * Компонент для отображения участников турнира
 */
import { useState, useEffect } from 'react'
import { miniAppAPI, TournamentParticipants as ParticipantsData, TournamentRegistration } from '../../api/miniApp'
import { hapticFeedback } from '../../utils/telegram'

interface TournamentParticipantsProps {
  tournamentId: number
  currentPlayerId?: number
  onInviteSent?: () => void
}

const TournamentParticipants = ({ tournamentId, currentPlayerId, onInviteSent }: TournamentParticipantsProps) => {
  const [participants, setParticipants] = useState<ParticipantsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sendingInvite, setSendingInvite] = useState<number | null>(null)

  useEffect(() => {
    loadParticipants()
  }, [tournamentId])

  const loadParticipants = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await miniAppAPI.getTournamentParticipants(tournamentId)
      setParticipants(data)
    } catch (err) {
      setError('Ошибка загрузки участников')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleSendInvite = async (receiverId: number) => {
    try {
      setSendingInvite(receiverId)
      hapticFeedback.medium()
      
      await miniAppAPI.sendPairInvitation(tournamentId, receiverId)
      
      hapticFeedback.success()
      alert('✅ Приглашение отправлено!')
      
      // Перезагружаем участников
      await loadParticipants()
      
      if (onInviteSent) {
        onInviteSent()
      }
    } catch (err: any) {
      hapticFeedback.error()
      const errorMessage = err.response?.data?.error || 'Ошибка отправки приглашения'
      alert(`❌ ${errorMessage}`)
      console.error(err)
    } finally {
      setSendingInvite(null)
    }
  }

  const renderRegistration = (reg: TournamentRegistration, showInviteButton: boolean = false) => {
    const isCurrentPlayer = reg.player_id === currentPlayerId
    const isPair = reg.partner_id !== null && reg.partner_id !== undefined
    
    return (
      <div
        key={reg.id}
        className={`p-3 rounded-lg border ${
          isCurrentPlayer ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="font-medium text-gray-900">
              {reg.player_name}
              {isCurrentPlayer && <span className="ml-2 text-xs text-blue-600">(Вы)</span>}
            </div>
            {isPair && (
              <div className="text-sm text-gray-600 mt-1">
                Напарник: {reg.partner_name}
              </div>
            )}
          </div>
          
          {showInviteButton && !isCurrentPlayer && (
            <button
              onClick={() => handleSendInvite(reg.player_id)}
              disabled={sendingInvite === reg.player_id}
              className="ml-3 px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendingInvite === reg.player_id ? '⏳' : '🤝 Пригласить'}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="text-gray-500">Загрузка участников...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-600">{error}</p>
        <button
          onClick={loadParticipants}
          className="mt-2 text-sm text-red-700 underline"
        >
          Попробовать снова
        </button>
      </div>
    )
  }

  if (!participants) {
    return null
  }

  const hasMainList = participants.main_list.length > 0
  const hasReserveList = participants.reserve_list.length > 0
  const hasLookingForPartner = participants.looking_for_partner.length > 0

  return (
    <div className="space-y-6">
      {/* Основной состав */}
      {hasMainList && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
            <span className="mr-2">🏆</span>
            Основной состав ({participants.main_list.length})
          </h3>
          <div className="space-y-2">
            {participants.main_list.map((reg) => renderRegistration(reg))}
          </div>
        </div>
      )}

      {/* Резервный список */}
      {hasReserveList && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
            <span className="mr-2">📋</span>
            Резервный список ({participants.reserve_list.length})
          </h3>
          <div className="space-y-2">
            {participants.reserve_list.map((reg) => renderRegistration(reg))}
          </div>
        </div>
      )}

      {/* Ищут пару */}
      {hasLookingForPartner && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
            <span className="mr-2">🔍</span>
            Ищут пару ({participants.looking_for_partner.length})
          </h3>
          <div className="space-y-2">
            {participants.looking_for_partner.map((reg) => renderRegistration(reg, true))}
          </div>
        </div>
      )}

      {!hasMainList && !hasReserveList && !hasLookingForPartner && (
        <div className="text-center py-8 text-gray-500">
          Пока нет зарегистрированных участников
        </div>
      )}
    </div>
  )
}

export default TournamentParticipants
