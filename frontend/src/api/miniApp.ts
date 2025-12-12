/**
 * API клиент для Telegram Mini App
 */
import axios, { AxiosInstance } from 'axios'
import { getTelegramInitData } from '../utils/telegram'

// Типы данных
export interface Tournament {
  id: number
  name: string
  date: string
  status: 'created' | 'active' | 'completed'
  venue_name: string
  venue_address?: string
  participants_count: number
  max_teams: number
  is_registered: boolean
  start_time?: string | null
  avg_rating_bp?: number | null
  system?: string
  set_format_name?: string | null
  organizer_name?: string
  description?: string
  entry_fee?: number
  prize_fund?: number
}

export interface Player {
  id: number
  full_name: string
  rating: number
  tournaments_played: number
  tournaments_won: number
  matches_played: number
}

export interface Profile {
  telegram_id: number
  username: string
  first_name: string
  last_name: string | null
  player: Player | null
  is_linked: boolean
}

export interface RegisterTournamentData {
  partner_id?: number
}

export interface TournamentRegistration {
  id: number
  player_id: number
  player_name: string
  partner_id?: number | null
  partner_name?: string | null
  status: 'looking_for_partner' | 'invited' | 'main_list' | 'reserve_list'
  status_display: string
  registered_at: string
}

export interface PairInvitation {
  id: number
  sender_id: number
  sender_name: string
  receiver_id: number
  receiver_name: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  status_display: string
  message: string
  created_at: string
  responded_at?: string | null
}

export interface TournamentParticipants {
  main_list: TournamentRegistration[]
  reserve_list: TournamentRegistration[]
  looking_for_partner: TournamentRegistration[]
}

/**
 * Создание API клиента с Telegram аутентификацией
 */
class MiniAppAPI {
  private api: AxiosInstance

  constructor() {
    this.api = axios.create({
      baseURL: '/api/mini-app',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // Добавляем Telegram initData в каждый запрос
    this.api.interceptors.request.use((config) => {
      const initData = getTelegramInitData()
      if (initData) {
        config.headers['X-Telegram-Init-Data'] = initData
      }
      return config
    })
  }

  /**
   * Получить список турниров
   */
  async getTournaments(status?: string): Promise<Tournament[]> {
    const response = await this.api.get('/tournaments/', {
      params: { status },
    })
    const data = response.data
    // DRF ViewSet по умолчанию возвращает пагинированный ответ
    // { count, next, previous, results: [...] }
    if (data && Array.isArray(data.results)) {
      return data.results
    }
    // Для кастомных действий (my_tournaments) возвращается сразу массив
    return data
  }

  /**
   * Получить детали турнира
   */
  async getTournamentDetail(id: number): Promise<Tournament> {
    const response = await this.api.get(`/tournaments/${id}/`)
    return response.data
  }

  /**
   * Получить мои турниры
   */
  async getMyTournaments(): Promise<Tournament[]> {
    const response = await this.api.get('/tournaments/my_tournaments/')
    return response.data
  }

  /**
   * Зарегистрироваться на турнир
   */
  async registerForTournament(
    id: number,
    data?: RegisterTournamentData
  ): Promise<{ message: string; tournament: Tournament }> {
    const response = await this.api.post(`/tournaments/${id}/register/`, data)
    return response.data
  }

  /**
   * Получить профиль пользователя
   */
  async getProfile(): Promise<Profile> {
    const response = await this.api.get('/profile/')
    return response.data
  }

  // --- Новые методы для системы регистрации ---

  /**
   * Получить список участников турнира
   */
  async getTournamentParticipants(tournamentId: number): Promise<TournamentParticipants> {
    const response = await this.api.get(`/tournaments/${tournamentId}/participants/`)
    return response.data
  }

  /**
   * Зарегистрироваться в режиме "ищу пару"
   */
  async registerLookingForPartner(tournamentId: number): Promise<TournamentRegistration> {
    const response = await this.api.post(`/tournaments/${tournamentId}/register-looking-for-partner/`)
    return response.data
  }

  /**
   * Зарегистрироваться с напарником
   */
  async registerWithPartner(tournamentId: number, partnerId: number): Promise<TournamentRegistration> {
    const response = await this.api.post(`/tournaments/${tournamentId}/register-with-partner/`, {
      partner_id: partnerId,
    })
    return response.data
  }

  /**
   * Отправить приглашение в пару
   */
  async sendPairInvitation(
    tournamentId: number,
    receiverId: number,
    message?: string
  ): Promise<PairInvitation> {
    const response = await this.api.post(`/tournaments/${tournamentId}/send-invitation/`, {
      receiver_id: receiverId,
      message: message || '',
    })
    return response.data
  }

  /**
   * Получить мои приглашения
   */
  async getMyInvitations(): Promise<PairInvitation[]> {
    const response = await this.api.get('/invitations/')
    return response.data
  }

  /**
   * Принять приглашение
   */
  async acceptInvitation(invitationId: number): Promise<{ message: string; registration: TournamentRegistration }> {
    const response = await this.api.post(`/invitations/${invitationId}/accept/`)
    return response.data
  }

  /**
   * Отклонить приглашение
   */
  async declineInvitation(invitationId: number): Promise<{ message: string }> {
    const response = await this.api.post(`/invitations/${invitationId}/decline/`)
    return response.data
  }

  /**
   * Отменить регистрацию на турнир
   */
  async cancelRegistration(tournamentId: number): Promise<{ message: string }> {
    const response = await this.api.post(`/tournaments/${tournamentId}/cancel-registration/`)
    return response.data
  }
}

// Экспортируем singleton
export const miniAppAPI = new MiniAppAPI()
