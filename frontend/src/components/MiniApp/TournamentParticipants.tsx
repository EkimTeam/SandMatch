/**
 * Компонент для отображения участников турнира
 */
import { useState, useEffect } from 'react'
import { miniAppAPI, TournamentParticipants as ParticipantsData, TournamentRegistration } from '../../api/miniApp'
import { hapticFeedback } from '../../utils/telegram'

interface TournamentParticipantsProps {
  tournamentId: number
  currentPlayerId?: number
  currentPlayerStatus?: string  // Статус текущего игрока
  onInviteSent?: () => void
}

const TournamentParticipants = ({ tournamentId, currentPlayerId, currentPlayerStatus, onInviteSent }: TournamentParticipantsProps) => {
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
      
      await miniAppAPI.sendPairInvitationById(tournamentId, receiverId)
      
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

  // Группируем регистрации по парам
  const groupRegistrations = (registrations: TournamentRegistration[]) => {
    const grouped: { [key: string]: TournamentRegistration[] } = {}
    const singles: TournamentRegistration[] = []

    registrations.forEach(reg => {
      if (reg.partner_id) {
        // Создаём уникальный ключ для пары (меньший ID первым)
        const pairKey = [reg.player_id, reg.partner_id].sort((a, b) => a - b).join('-')
        if (!grouped[pairKey]) {
          grouped[pairKey] = []
        }
        grouped[pairKey].push(reg)
      } else {
        singles.push(reg)
      }
    })

    return { pairs: Object.values(grouped).filter(pair => pair.length > 0), singles }
  }

  const renderPair = (pairRegs: TournamentRegistration[]) => {
    if (pairRegs.length === 0) return null
    
    const reg1 = pairRegs[0]
    
    const isCurrentPlayerInPair = pairRegs.some(r => r.player_id === currentPlayerId)
    const pairRating = (reg1 as any).rating_bp
    
    return (
      <div
        key={`pair-${reg1.player_id}-${reg1.partner_id}`}
        className={`p-3 rounded-lg border ${
          isCurrentPlayerInPair ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="font-medium text-gray-900">
              {reg1.player_name} / {reg1.partner_name}
              {isCurrentPlayerInPair && <span className="ml-2 text-xs text-blue-600">(Вы)</span>}
            </div>
            {pairRating !== null && pairRating !== undefined && (
              <div className="text-xs text-gray-500 mt-1">Рейтинг пары: {pairRating}</div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const renderSingle = (reg: TournamentRegistration, showInviteButton: boolean = false) => {
    const isCurrentPlayer = reg.player_id === currentPlayerId
    const playerRating = (reg as any).rating_bp
    
    // Показываем кнопку "Пригласить" если:
    // 1. showInviteButton = true (список "Ищут пару")
    // 2. Это не текущий игрок
    // 3. Текущий игрок в статусе "looking_for_partner" ИЛИ ещё не зарегистрирован
    const canInvite = showInviteButton && !isCurrentPlayer && 
      (currentPlayerStatus === 'looking_for_partner' || !currentPlayerStatus)
    
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
            {playerRating !== null && playerRating !== undefined && (
              <div className="text-xs text-gray-500 mt-1">Рейтинг: {playerRating}</div>
            )}
          </div>
          
          {canInvite && (
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

  // Сортировка и группировка
  const sortByAlphabet = (regs: TournamentRegistration[]) => {
    return [...regs].sort((a, b) => a.player_name.localeCompare(b.player_name, 'ru'))
  }

  const sortByRegistrationOrder = (regs: TournamentRegistration[]) => {
    return [...regs].sort((a, b) => {
      const orderA = (a as any).registration_order || 0
      const orderB = (b as any).registration_order || 0
      return orderA - orderB
    })
  }

  // Основной состав - по алфавиту
  const mainListSorted = sortByAlphabet(participants.main_list)
  const mainGrouped = groupRegistrations(mainListSorted)
  const mainCount = mainGrouped.pairs.length + mainGrouped.singles.length

  // Резервный список - по очереди регистрации
  const reserveListSorted = sortByRegistrationOrder(participants.reserve_list)
  const reserveGrouped = groupRegistrations(reserveListSorted)
  const reserveCount = reserveGrouped.pairs.length + reserveGrouped.singles.length

  // Ищут пару - по алфавиту
  const lookingListSorted = sortByAlphabet(participants.looking_for_partner)
  const lookingCount = lookingListSorted.length

  const hasMainList = mainCount > 0
  const hasReserveList = reserveCount > 0
  const hasLookingForPartner = lookingCount > 0

  return (
    <div className="space-y-6">
      {/* Основной состав */}
      {hasMainList && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
            <span className="mr-2">🏆</span>
            Основной состав ({mainCount})
          </h3>
          <div className="space-y-2">
            {mainGrouped.pairs.map((pair) => renderPair(pair))}
            {mainGrouped.singles.map((reg) => renderSingle(reg))}
          </div>
        </div>
      )}

      {/* Резервный список */}
      {hasReserveList && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
            <span className="mr-2">📋</span>
            Резервный список ({reserveCount})
          </h3>
          <div className="space-y-2">
            {reserveGrouped.pairs.map((pair) => renderPair(pair))}
            {reserveGrouped.singles.map((reg) => renderSingle(reg))}
          </div>
        </div>
      )}

      {/* Ищут пару */}
      {hasLookingForPartner && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
            <span className="mr-2">🔍</span>
            Ищут пару ({lookingCount})
          </h3>
          <div className="space-y-2">
            {lookingListSorted.map((reg) => renderSingle(reg, true))}
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
