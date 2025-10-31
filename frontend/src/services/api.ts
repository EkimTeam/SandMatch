import axios from 'axios';
import { getAccessToken, refreshAccessToken, clearTokens } from './auth';

// Базовая конфигурация API клиента
const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach Authorization header with Bearer token on each request
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
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
  // Сохранить ПОЛНЫЙ счёт (все сеты) — для плей-офф
  savePlayoffScoreFull: async (
    tournamentId: number,
    matchId: number,
    sets: Array<{ index: number; games_1: number; games_2: number; tb_1?: number | null; tb_2?: number | null; is_tiebreak_only?: boolean }>,
  ): Promise<{ ok: boolean; match: any }> => {
    const response = await api.post(`/tournaments/${tournamentId}/match_save_score_full/`, {
      match_id: matchId,
      sets,
    });
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

  // Зафиксировать участников (создать матчи по расписанию)
  lockParticipants: async (id: number): Promise<any> => {
    const response = await api.post(`/tournaments/${id}/lock_participants/`);
    return response.data;
  },

  // Снять фиксацию участников в круговой системе
  unlockParticipants: async (id: number): Promise<any> => {
    const response = await api.post(`/tournaments/${id}/unlock_participants/`);
    return response.data;
  },

  // Получить статистику групп
  getGroupStats: async (id: number): Promise<any> => {
    const response = await api.get(`/tournaments/${id}/group_stats/`);
    return response.data;
  },

  // --- Плей-офф ---
  createKnockoutBracket: async (
    id: number,
    params: { size: number; has_third_place?: boolean }
  ): Promise<{ ok: boolean; bracket: { id: number; index: number; size: number; has_third_place: boolean } }> => {
    const response = await api.post(`/tournaments/${id}/create_knockout_bracket/`, params);
    return response.data;
  },

  seedBracket: async (
    id: number,
    bracketId: number
  ): Promise<{ ok: boolean }> => {
    const response = await api.post(`/tournaments/${id}/seed_bracket/`, { bracket_id: bracketId });
    return response.data;
  },

  getBracketDraw: async (
    id: number,
    bracketId: number,
    timestamp?: number
  ): Promise<any> => {
    // Добавляем timestamp для предотвращения кэширования
    const ts = timestamp || Date.now();
    const response = await api.get(`/tournaments/${id}/brackets/${bracketId}/draw/?_t=${ts}`);
    return response.data;
  },

  // Зафиксировать участников в сетке
  lockBracketParticipants: async (tournamentId: number, bracketId: number, slots: any[]): Promise<any> => {
    const response = await api.post(`/tournaments/${tournamentId}/brackets/${bracketId}/lock_participants/`, { slots });
    return response.data;
  },

  // Снять фиксацию участников в сетке
  unlockBracketParticipants: async (tournamentId: number, bracketId: number): Promise<any> => {
    const response = await api.post(`/tournaments/${tournamentId}/brackets/${bracketId}/unlock_participants/`);
    return response.data;
  },

  // Получить участников турнира
  getTournamentParticipants: async (tournamentId: number): Promise<any[]> => {
    const response = await api.get(`/tournaments/${tournamentId}/participants/`);
    return response.data.participants || [];
  },

  // Добавить участника в слот сетки
  addParticipantToBracket: async (
    tournamentId: number,
    bracketId: number,
    matchId: number,
    slot: 'team_1' | 'team_2',
    participantId: number
  ): Promise<{ ok: boolean }> => {
    const response = await api.post(
      `/tournaments/${tournamentId}/brackets/${bracketId}/assign_participant/`,
      { match_id: matchId, slot, participant_id: participantId }
    );
    return response.data;
  },

  // Удалить участника из слота
  removeParticipantFromBracket: async (
    tournamentId: number,
    bracketId: number,
    matchId: number,
    slot: 'team_1' | 'team_2'
  ): Promise<{ ok: boolean }> => {
    const response = await api.delete(
      `/tournaments/${tournamentId}/brackets/${bracketId}/remove_participant/`,
      { data: { match_id: matchId, slot } }
    );
    return response.data;
  },

  // Добавить нового участника в турнир
  addParticipantToTournament: async (
    tournamentId: number,
    participantData: { player_id?: number; name: string }
  ): Promise<{ id: number; name: string; team_id: number }> => {
    const response = await api.post(
      `/tournaments/${tournamentId}/add_participant/`,
      participantData
    );
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
  // Сохранить счёт в свободном формате
  saveFreeFormatScore: async (
    tournamentId: number,
    matchId: number,
    sets: Array<{
      index: number;
      games_1: number;
      games_2: number;
      tb_loser_points: number | null;
      is_tiebreak_only: boolean;
    }>
  ): Promise<{ ok: boolean; match: any }> => {
    const response = await api.post(
      `/tournaments/${tournamentId}/match_save_score_free_format/`,
      { match_id: matchId, sets }
    );
    return response.data;
  },
  // Сохранить счёт (плей-офф, через tournament action)
  savePlayoffScore: async (
    tournamentId: number,
    matchId: number,
    idTeamFirst: number,
    idTeamSecond: number,
    gamesFirst: number,
    gamesSecond: number,
  ): Promise<{ ok: boolean; match: any }> => {
    const response = await api.post(`/tournaments/${tournamentId}/match_save_score/`, {
      match_id: matchId,
      id_team_first: idTeamFirst,
      id_team_second: idTeamSecond,
      games_first: gamesFirst,
      games_second: gamesSecond,
    });
    return response.data;
  },
  // Сохранить ПОЛНЫЙ счёт (все сеты) — для плей-офф
  savePlayoffScoreFull: async (
    tournamentId: number,
    matchId: number,
    sets: Array<{ index: number; games_1: number; games_2: number; tb_1?: number | null; tb_2?: number | null; is_tiebreak_only?: boolean }>,
  ): Promise<{ ok: boolean; match: any }> => {
    const response = await api.post(`/tournaments/${tournamentId}/match_save_score_full/`, {
      match_id: matchId,
      sets,
    });
    return response.data;
  },
  // Начать матч
  startMatch: async (tournamentId: number, matchId: number): Promise<{ ok: boolean; match: any }> => {
    const response = await api.post(`/tournaments/${tournamentId}/match_start/`, {
      match_id: matchId,
    });
    return response.data;
  },
  // Отменить матч
  cancelMatch: async (tournamentId: number, matchId: number): Promise<{ ok: boolean; match: any }> => {
    const response = await api.post(`/tournaments/${tournamentId}/match_cancel/`, {
      match_id: matchId,
    });
    return response.data;
  },
  // Сбросить результат матча (удалить счёт, победителя, убрать из следующего раунда)
  resetMatch: async (tournamentId: number, matchId: number): Promise<{ ok: boolean }> => {
    const response = await api.post(`/tournaments/${tournamentId}/match_reset/`, {
      match_id: matchId,
    });
    return response.data;
  },
};

// Обработка ошибок
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error?.config || {};
    const status = error?.response?.status;
    if (status === 401 && !original._retry) {
      original._retry = true;
      try {
        const newAccess = await refreshAccessToken();
        if (newAccess) {
          original.headers = original.headers || {};
          original.headers.Authorization = `Bearer ${newAccess}`;
          return api(original);
        }
      } catch (_) {}
      // Refresh failed — cleanup tokens
      clearTokens();
    }
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default api;
