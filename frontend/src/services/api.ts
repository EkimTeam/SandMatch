import axios from 'axios';

// Базовая конфигурация API клиента
const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Интерфейсы TypeScript
export interface Player {
  id: number;
  first_name: string;
  last_name: string;
  display_name: string;
  level: string;
}

export interface Participant {
  id: number;
  player: Player;
  player_id: number;
  group: number;
  points: number;
  wins: number;
  losses: number;
}

export interface Match {
  id: number;
  team1: Participant;
  team2: Participant;
  score1: number | null;
  score2: number | null;
  round_number: number;
  match_type: string;
  is_completed: boolean;
  created_at: string;
}

export interface Tournament {
  id: number;
  name: string;
  tournament_type: string;
  status: string;
  participants: Participant[];
  matches: Match[];
  participants_count: number;
  created_at: string;
  updated_at: string;
}

export interface ApiResponse<T> {
  results?: T[];
  count?: number;
  next?: string | null;
  previous?: string | null;
}

// API методы для турниров
export const tournamentApi = {
  // Получить список турниров
  getList: async (): Promise<Tournament[]> => {
    const response = await api.get<ApiResponse<Tournament>>('/tournaments/');
    return response.data.results || [];
  },

  // Получить турнир по ID
  getById: async (id: number): Promise<Tournament> => {
    const response = await api.get<Tournament>(`/tournaments/${id}/`);
    return response.data;
  },

  // Создать новый турнир
  create: async (data: { name: string; tournament_type: string }): Promise<Tournament> => {
    const response = await api.post<Tournament>('/tournaments/', data);
    return response.data;
  },

  // Сохранить участников турнира
  saveParticipants: async (id: number, participants: { player_id: number; group: number }[]): Promise<void> => {
    await api.post(`/tournaments/${id}/save_participants/`, { participants });
  },

  // Получить статистику групп
  getGroupStats: async (id: number): Promise<any> => {
    const response = await api.get(`/tournaments/${id}/group_stats/`);
    return response.data;
  },
};

// API методы для игроков
export const playerApi = {
  // Получить список игроков
  getList: async (): Promise<Player[]> => {
    const response = await api.get<{ players: Player[] }>('/players/');
    return response.data.players;
  },

  // Поиск игроков
  search: async (query: string): Promise<Player[]> => {
    const response = await api.get<{ players: Player[] }>(`/players/search/?q=${encodeURIComponent(query)}`);
    return response.data.players;
  },

  // Создать нового игрока
  create: async (data: { first_name: string; last_name: string; level?: string }): Promise<Player> => {
    const response = await api.post<Player>('/players/create/', data);
    return response.data;
  },
};

// API методы для матчей
export const matchApi = {
  // Сохранить счет матча
  saveScore: async (id: number, score1: number, score2: number): Promise<Match> => {
    const response = await api.post<Match>(`/matches/${id}/save_score/`, { score1, score2 });
    return response.data;
  },
};

// Обработка ошибок
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default api;
