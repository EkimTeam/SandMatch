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
  organizer_name?: string
  description?: string
  entry_fee?: number
  prize_fund?: number
  system?: string
}

export interface Player {
  id: number
  full_name: string
  rating: number
  tournaments_played: number
  tournaments_won: number
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
}

// Экспортируем singleton
export const miniAppAPI = new MiniAppAPI()
