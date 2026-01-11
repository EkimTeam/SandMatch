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
  system?: 'round_robin' | 'knockout' | 'king';
  king_calculation_mode?: 'g_minus' | 'm_plus' | 'no';
  groups_count?: number;
  planned_participants?: number;
  participant_mode?: 'singles' | 'doubles';
  set_format_id?: number;
  ruleset?: { id: number; name: string; ordering_priority?: string[] } | null;
  organizer_name?: string;
  can_delete?: boolean;
  date?: string;
  get_system_display?: string;
  get_participant_mode_display?: string;
  has_zero_rating_players?: boolean;
}

export interface Ruleset {
  id: number;
  name: string;
  ordering_priority?: string[];
}

// Типы для турниров Кинг
export type KingCalculationMode = 'g_minus' | 'm_plus' | 'no';

export interface KingPlayer {
  id: number;
  name: string;
  display_name: string;
}

export interface KingMatch {
  id: number;
  team1_players: KingPlayer[];
  team2_players: KingPlayer[];
  score: string | null;
  status: string;
}

export interface KingRound {
  round: number;
  matches: KingMatch[];
}

export interface KingParticipant {
  id: number;
  team_id: number;
  name: string;
  display_name: string;
  row_index: number;
}

export interface KingGroupSchedule {
  participants: KingParticipant[];
  rounds: KingRound[];
}

export interface KingScheduleResponse {
  ok: boolean;
  schedule: {
    [groupIndex: string]: KingGroupSchedule;
  };
}

export interface SchedulePattern {
  id: number;
  name: string;
  pattern_type: 'berger' | 'snake' | 'custom';
  pattern_type_display: string;
  tournament_system: 'round_robin' | 'knockout' | 'king';
  tournament_system_display: string;
  description: string;
  participants_count: number | null;
  custom_schedule: {
    rounds: Array<{
      round: number;
      pairs: Array<[number, number]>;
    }>;
  } | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiResponse<T> {
  results?: T[];
  count?: number;
  next?: string | null;
  previous?: string | null;
}

export interface UserMe {
  id: number;
  username: string;
  email: string | null;
  first_name: string;
  last_name: string;
  is_staff: boolean;
  is_superuser: boolean;
  role: 'ADMIN' | 'ORGANIZER' | 'REFEREE' | 'REGISTERED' | null;
  player_id: number | null;
  telegram_id: number | null;
  telegram_username: string | null;
}

export interface AdminUserItem {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: 'ADMIN' | 'ORGANIZER' | 'REFEREE' | 'REGISTERED' | null;
  has_bp_player: boolean;
  has_btr_player: boolean;
  has_telegram: boolean;
}

export const authApi = {
  register: async (payload: {
    username: string;
    password: string;
    email?: string;
    first_name?: string;
    last_name?: string;
  }): Promise<{ id: number; username: string; email: string | null; first_name: string; last_name: string; role: string }> => {
    const { data } = await axios.post('/api/auth/register/', payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    return data;
  },

  me: async (): Promise<UserMe> => {
    const { data } = await api.get<UserMe>('/auth/me/');
    return data;
  },

  requestPasswordReset: async (email: string): Promise<{ detail: string; uid?: string; token?: string }> => {
    const { data } = await axios.post('/api/auth/password/reset/', { email }, {
      headers: { 'Content-Type': 'application/json' },
    });
    return data;
  },

  resetPasswordConfirm: async (payload: { uid: string; token: string; new_password: string }): Promise<{ detail: string }> => {
    const { data } = await axios.post('/api/auth/password/reset/confirm/', payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    return data;
  },
};

export const adminApi = {
  listUsers: async (params?: { 
    q?: string; 
    offset?: number; 
    limit?: number;
    role?: string;
    filter_bp?: boolean;
    filter_btr?: boolean;
    filter_telegram?: boolean;
  }): Promise<{ results: AdminUserItem[]; has_more: boolean; total: number }> => {
    const query: string[] = [];
    if (params?.q) query.push(`q=${encodeURIComponent(params.q)}`);
    if (typeof params?.offset === 'number') query.push(`offset=${params.offset}`);
    if (typeof params?.limit === 'number') query.push(`limit=${params.limit}`);
    if (params?.role) query.push(`role=${encodeURIComponent(params.role)}`);
    if (params?.filter_bp) query.push(`filter_bp=true`);
    if (params?.filter_btr) query.push(`filter_btr=true`);
    if (params?.filter_telegram) query.push(`filter_telegram=true`);
    const qs = query.length ? `?${query.join('&')}` : '';
    const { data } = await api.get(`/auth/users/${qs}`);
    return data;
  },
  setUserRole: async (userId: number, role: 'ADMIN' | 'ORGANIZER' | 'REFEREE' | 'REGISTERED'): Promise<{ ok: boolean; changed: boolean; old_role?: string; new_role?: string }> => {
    const { data } = await api.post(`/auth/users/${userId}/set_role/`, { role });
    return data;
  },
  deleteUser: async (userId: number): Promise<{ ok: boolean; deleted_username: string }> => {
    const { data } = await api.delete(`/auth/users/${userId}/delete/`);
    return data;
  },
};

export interface RefereeTournamentItem {
  id: number;
  name: string;
  date: string;
  system: string;
  participant_mode: string;
  status: string;
  get_system_display: string;
  get_participant_mode_display: string;
  organizer_name?: string;
}

export const refereeApi = {
  myTournaments: async (): Promise<RefereeTournamentItem[]> => {
    const { data } = await api.get<{ tournaments: RefereeTournamentItem[] }>('/referee/my_tournaments/');
    return data.tournaments || [];
  },
};

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
  // Получить список регламентов
  getRulesets: async (system?: 'round_robin' | 'knockout' | 'king'): Promise<{ id: number; name: string }[]> => {
    const qs = system ? `?system=${encodeURIComponent(system)}` : '';
    const response = await api.get<{ rulesets: { id: number; name: string }[] }>(`/rulesets/${qs}`);
    const list = response.data?.rulesets || [];
    // Отсортировать по алфавиту
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  },
  // Установить регламент турнира
  setRuleset: async (id: number, rulesetId: number): Promise<{ ok: boolean }> => {
    const response = await api.post(`/tournaments/${id}/set_ruleset/`, { ruleset_id: rulesetId });
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

  // Изменить настройки турнира (для статуса created)
  editSettings: async (id: number, payload: any): Promise<Tournament> => {
    const response = await api.post<Tournament>(`/tournaments/${id}/edit_settings/`, payload);
    return response.data;
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

  // --- МЕТОДЫ ДЛЯ ТУРНИРОВ КИНГ ---
  
  // Зафиксировать участников и сгенерировать матчи для турнира Кинг
  lockParticipantsKing: async (tournamentId: number) => {
    const { data } = await api.post(`/tournaments/${tournamentId}/lock_participants_king/`);
    return data;
  },

  getKingSchedule: async (tournamentId: number): Promise<KingScheduleResponse> => {
    const { data } = await api.get(`/tournaments/${tournamentId}/king_schedule/`);
    return data;
  },

  setKingCalculationMode: async (tournamentId: number, mode: KingCalculationMode) => {
    const { data } = await api.post(`/tournaments/${tournamentId}/set_king_calculation_mode/`, { mode });
    return data;
  },

  complete: async (tournamentId: number, force: boolean = false) => {
    const { data } = await api.post(`/tournaments/${tournamentId}/complete/`, { force });
    return data;
  },

  delete: async (tournamentId: number) => {
    await api.delete(`/tournaments/${tournamentId}/`);
  },

  // Получить существующую сетку плей-офф (read-only)
  getDefaultBracket: async (tournamentId: number): Promise<{ id: number; index: number; size: number; has_third_place: boolean } | null> => {
    const { data } = await api.get(`/tournaments/${tournamentId}/default_bracket/`);
    if (!data?.ok || !data.bracket) return null;
    return data.bracket;
  },

  // --- Стартовые рейтинги участников турнира ---

  initialRatingsPreview: async (tournamentId: number): Promise<{
    ok: boolean;
    tournament: { id: number; name: string; status: string; system?: string };
    players: Array<{
      player_id: number;
      full_name: string;
      current_rating: number;
      has_btr: boolean;
      default_rating: number;
      btr_candidates: Array<{
        id: number;
        full_name: string;
        rni: number;
        city: string;
        birth_date: string | null;
        suggested_rating_from_btr: number;
      }>;
    }>;
  }> => {
    const { data } = await api.get(`/tournaments/${tournamentId}/initial_ratings_preview/`);
    return data;
  },

  applyInitialRatings: async (
    tournamentId: number,
    items: Array<{ player_id: number; rating: number; link_btr_player_id?: number | null }>,
  ): Promise<{ ok: boolean; updated: number }> => {
    const { data } = await api.post(`/tournaments/${tournamentId}/apply_initial_ratings/`, { items });
    return data;
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

// API методы для шаблонов расписания
export const schedulePatternApi = {
  // Получить все шаблоны
  getAll: async (): Promise<SchedulePattern[]> => {
    const response = await api.get<any>('/schedule-patterns/');
    const data = response.data as any;
    if (Array.isArray(data)) return data as SchedulePattern[];
    if (data && Array.isArray(data.results)) return data.results as SchedulePattern[];
    return [] as SchedulePattern[];
  },

  // Получить шаблон по ID
  getById: async (id: number): Promise<SchedulePattern> => {
    const response = await api.get<SchedulePattern>(`/schedule-patterns/${id}/`);
    return response.data;
  },

  // Получить шаблоны по количеству участников
  getByParticipants: async (count: number, system: string = 'round_robin'): Promise<SchedulePattern[]> => {
    const response = await api.get<any>('/schedule-patterns/by_participants/', {
      params: { count, system }
    });
    const data = response.data as any;
    if (Array.isArray(data)) return data as SchedulePattern[];
    if (data && Array.isArray(data.results)) return data.results as SchedulePattern[];
    return [] as SchedulePattern[];
  },

  // Пересоздать расписание группы
  regenerateGroupSchedule: async (
    tournamentId: number,
    groupName: string,
    patternId: number
  ): Promise<{
    ok: boolean;
    deleted: number;
    created: number;
    pattern: SchedulePattern;
  }> => {
    const response = await api.post(`/tournaments/${tournamentId}/regenerate_group_schedule/`, {
      group_name: groupName,
      pattern_id: patternId,
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

    // Универсальная обработка 403: редирект на страницу "нет доступа"
    if (status === 403) {
      try {
        const loc = window.location;
        const nowPath = loc.pathname + loc.search;
        // Чтобы не зациклиться, если уже на странице /forbidden
        if (!nowPath.startsWith('/forbidden')) {
          const next = encodeURIComponent(nowPath || '/');
          window.location.href = `/forbidden?next=${next}`;
        }
      } catch (_) {
        // ignore
      }
    }

    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default api;

// --- Rating API ---
export const ratingApi = {
  leaderboard: async (params?: { hard?: boolean; medium?: boolean; tiebreak_only?: boolean; q?: string; page?: number; page_size?: number }): Promise<{ results: Array<{
    id: number;
    first_name?: string;
    display_name: string;
    last_name: string;
    current_rating: number;
    tournaments_count: number;
    matches_count: number;
    winrate?: number;
    rank?: number;
    last5: Array<{ match_id: number; tournament_id: number; result: 'W'|'L'|'U' }>;
  }>, page: number, page_size: number, total: number, total_pages: number }> => {
    const q: string[] = [];
    if (params?.hard) q.push('hard=1');
    if (params?.medium) q.push('medium=1');
    if (params?.tiebreak_only) q.push('tiebreak_only=1');
    if (params?.q) q.push(`q=${encodeURIComponent(params.q)}`);
    if (params?.page) q.push(`page=${params.page}`);
    if (params?.page_size) q.push(`page_size=${params.page_size}`);
    const qs = q.length ? `?${q.join('&')}` : '';
    const { data } = await api.get(`/rating/leaderboard/${qs}`);
    return data;
  },
  playerHistory: async (playerId: number): Promise<{
    player_id: number;
    history: Array<{ tournament_id: number; tournament_date: string; rating_before: number; rating_after: number; total_change: number; matches_count: number }>;
  }> => {
    const { data } = await api.get(`/rating/player/${playerId}/history/`);
    return data;
  },
  summaryStats: async (params?: { from?: string; to?: string }): Promise<any> => {
    const qs: string[] = [];
    if (params?.from) qs.push(`from=${encodeURIComponent(params.from)}`);
    if (params?.to) qs.push(`to=${encodeURIComponent(params.to)}`);
    const s = qs.length ? `?${qs.join('&')}` : '';
    const { data } = await api.get(`/rating/stats/summary/${s}`);
    return data;
  },
  playerBriefs: async (ids: number[]): Promise<{ results: Array<{ id: number; current_rating: number; last_delta: number; rank?: number }> }> => {
    const qs = ids.length ? `?ids=${ids.join(',')}` : '';
    const { data } = await api.get(`/rating/players/briefs/${qs}`);
    return data;
  },
  playerMatchDeltas: async (playerId: number): Promise<{ player_id: number; matches: Array<{ match_id: number; tournament_id: number; tournament_name: string; tournament_date: string; tournament_system?: string; participant_mode?: string; finished_at?: string; delta: number; opponent?: string; partner?: string; score?: string; team1: (number|null)[]; team2: (number|null)[]; team1_avg_before?: number | null; team2_avg_before?: number | null }> }> => {
    const { data } = await api.get(`/rating/player/${playerId}/match_deltas/`);
    return data;
  },
  h2h: async (a: number, b: number): Promise<{ a: number; b: number; matches: Array<{ match_id: number; tournament_id: number; tournament_name: string; tournament_date: string; team1: (number|null)[]; team2: (number|null)[]; score: string; delta_for_a: number; team1_avg_before: number | null; team2_avg_before: number | null }> }> => {
    const { data } = await api.get(`/rating/h2h/?a=${a}&b=${b}`);
    return data;
  },
  playerRelations: async (playerId: number): Promise<{ player_id: number; opponents: number[]; partners: Array<{ id: number; count: number }> }> => {
    const { data } = await api.get(`/rating/player/${playerId}/relations/`);
    return data;
  },
  playerTopWins: async (playerId: number): Promise<{ player_id: number; wins: Array<{ match_id: number; tournament_id: number; tournament_name: string; tournament_date: string; delta: number; opponent: string; partner: string; score: string }> }> => {
    const { data } = await api.get(`/rating/player/${playerId}/top_wins/`);
    return data;
  }
};

// ============================================================================
// BTR API (BeachTennisRussia)
// ============================================================================

export interface BtrPlayer {
  id: number;
  rni: number;
  first_name: string;
  last_name: string;
  middle_name: string;
  gender: 'male' | 'female' | null;
  birth_date: string | null;
  city: string;
  country: string;
  current_rating?: number;
  rank?: number;
  category?: string;
  rating_date?: string;
}

export interface BtrLeaderboardItem {
  id: number;
  rni: number;
  first_name: string;
  last_name: string;
  middle_name: string;
  gender: 'male' | 'female' | null;
  birth_date: string | null;
  city: string;
  current_rating: number;
  rank: number;
  category: string;
  category_display: string;
  rating_date: string;
  tournaments_total: number;
  tournaments_52_weeks: number;
  tournaments_counted: number;
}

export interface BtrRatingSnapshot {
  date: string;
  rating: number;
  rank: number | null;
  tournaments_total: number;
  tournaments_52_weeks: number;
  tournaments_counted: number;
}

export interface BtrCategory {
  code: string;
  label: string;
  players_count: number;
  latest_date: string;
}

export interface BtrPlayerDetail {
  player: {
    id: number;
    rni: number;
    first_name: string;
    last_name: string;
    middle_name: string;
    gender: 'male' | 'female' | null;
    birth_date: string | null;
    city: string;
  };
  categories: Record<string, {
    category: string;
    category_display: string;
    current_rating: number;
    rank: number | null;
    rating_date: string;
    tournaments_total: number;
    tournaments_52_weeks: number;
    tournaments_counted: number;
  }>;
  stats: Record<string, {
    max_rating: number;
    min_rating: number;
    total_tournaments: number;
  }>;
}

export const btrApi = {
  // Таблица лидеров BTR (все 6 категорий)
  leaderboard: async (params?: {
    q?: string;
  }): Promise<{
    categories: Record<string, {
      label: string;
      results: BtrLeaderboardItem[];
      latest_date: string;
      total: number;
    }>;
  }> => {
    const { data } = await api.get('/btr/leaderboard/', { params });
    return data;
  },

  // Детальная информация об игроке
  playerDetail: async (playerId: number): Promise<BtrPlayerDetail> => {
    const { data } = await api.get(`/btr/player/${playerId}/`);
    return data;
  },

  // Информация о BTR рейтингах по BP player ID
  playerByBpId: async (bpPlayerId: number): Promise<{
    btr_player_id: number | null;
    categories: Record<string, {
      category: string;
      category_display: string;
      current_rating: number;
      rank: number | null;
    }>;
  }> => {
    const { data } = await api.get(`/btr/player/by-bp-id/${bpPlayerId}/`);
    return data;
  },

  // История рейтинга игрока
  playerHistory: async (
    playerId: number,
    category?: string
  ): Promise<{
    player_id: number;
    rni: number;
    full_name: string;
    history_by_category: Record<string, BtrRatingSnapshot[]>;
    history: any[];
  }> => {
    const params = category ? { category } : {};
    const { data } = await api.get(`/btr/player/${playerId}/history/`, { params });
    return data;
  },

  // Краткая информация об игроке (публичный)
  playerBrief: async (playerId: number): Promise<BtrPlayer> => {
    const { data } = await api.get(`/btr/player/${playerId}/brief/`);
    return data;
  },

  // Список категорий
  categories: async (): Promise<{ categories: BtrCategory[] }> => {
    const { data } = await api.get('/btr/categories/');
    return data;
  },
};

// ===========================
// Profile API
// ===========================
export interface UserProfile {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  player?: {
    id: number;
    last_name: string;
    first_name: string;
    patronymic?: string;
    birth_date?: string;
    gender?: 'male' | 'female';
    phone?: string;
    display_name?: string;
    city?: string;
    current_rating: number;
    level?: string;
    is_profi: boolean;
    created_at: string;
  };
}

export interface UpdateProfileData {
  email?: string;
  first_name?: string;
  last_name?: string;
  patronymic?: string;
  birth_date?: string;
  gender?: 'male' | 'female';
  phone?: string;
  display_name?: string;
  city?: string;
  level?: string;
}

export interface ChangePasswordData {
  old_password: string;
  new_password: string;
  new_password_confirm: string;
}

export interface PlayerSearchResult {
  id: number;
  first_name: string;
  last_name: string;
  display_name: string;
  patronymic?: string;
  current_rating?: number;
  level?: string;
  city?: string;
  is_profi?: boolean;
}

export interface PlayerCandidate {
  id: number;
  first_name: string;
  last_name: string;
  patronymic: string;
  city: string;
  current_rating: number;
}

export const profileApi = {
  // Получение профиля
  getProfile: async (): Promise<UserProfile> => {
    const { data } = await api.get('/auth/profile/');
    return data;
  },

  // Обновление профиля
  updateProfile: async (profileData: UpdateProfileData): Promise<UserProfile> => {
    const { data } = await api.patch('/auth/profile/update/', profileData);
    return data;
  },

  // Смена пароля
  changePassword: async (passwordData: ChangePasswordData): Promise<{ detail: string }> => {
    const { data } = await api.post('/auth/profile/change-password/', passwordData);
    return data;
  },

  // Автоподбор кандидатов игрока по ФИО пользователя
  getPlayerCandidates: async (): Promise<{ candidates: PlayerCandidate[] }> => {
    const { data } = await api.get('/auth/profile/player-candidates/');
    return data;
  },

  // Поиск игроков для связывания: используем общий эндпоинт, как в модалке участников
  searchPlayers: async (query: string): Promise<{ players: PlayerSearchResult[] }> => {
    const { data } = await api.get('/players/search/', { params: { q: query } });
    return data;
  },

  // Связывание с игроком
  linkPlayer: async (playerId: number): Promise<UserProfile> => {
    const { data } = await api.post('/auth/profile/link-player/', { player_id: playerId });
    return data;
  },
  // Отвязка игрока
  unlinkPlayer: async (): Promise<UserProfile> => {
    const { data } = await api.post('/auth/profile/unlink-player/');
    return data;
  },
};

// ===========================
// Telegram API
// ===========================
export interface TelegramLinkCode {
  code: string;
  expires_at: string;
  instructions: string;
}

export interface TelegramStatus {
  is_linked: boolean;
  telegram_user?: {
    telegram_id: number;
    username?: string;
    first_name: string;
    is_linked: boolean;
    created_at: string;
  };
  pending_code?: {
    code: string;
    created_at: string;
    expires_at: string;
    expires_in_minutes: number;
  };
}

export const telegramApi = {
  // Генерация кода для связывания
  generateCode: async (): Promise<TelegramLinkCode> => {
    const { data } = await api.post('/telegram/generate-code/');
    return data;
  },
  // Проверка статуса связывания
  getStatus: async (): Promise<TelegramStatus> => {
    const { data } = await api.get('/telegram/status/');
    return data;
  },

  // Отвязка Telegram
  unlink: async (): Promise<{ message: string }> => {
    const { data } = await api.post('/telegram/unlink/');
    return data;
  },
};

// ===========================
// Регистрация турниров (веб)
// ===========================

export type WebRegistrationStatus = 'looking_for_partner' | 'invited' | 'main_list' | 'reserve_list';

export interface WebTournamentRegistration {
  id: number;
  player_id: number;
  player_name: string;
  partner_id?: number | null;
  partner_name?: string | null;
  status: WebRegistrationStatus;
  status_display: string;
  registered_at: string;
}

export interface WebTournamentParticipants {
  main_list: WebTournamentRegistration[];
  reserve_list: WebTournamentRegistration[];
  looking_for_partner: WebTournamentRegistration[];
}

export interface WebRegistrationStateResponse {
  tournament: {
    id: number;
    name: string;
    status: string;
    system?: string;
    participant_mode?: 'singles' | 'doubles';
    planned_participants?: number | null;
    date?: string | null;
    participants_count?: number | null;
    registered_count?: number | null;
    get_system_display?: string | null;
    get_participant_mode_display?: string | null;
    organizer_name?: string | null;
  };
  participants: WebTournamentParticipants;
  my_registration: WebTournamentRegistration | null;
}

export const tournamentRegistrationApi = {
  getState: async (tournamentId: number): Promise<WebRegistrationStateResponse> => {
    const { data } = await api.get(`/tournaments/${tournamentId}/registration_state/`);
    return data;
  },
  registerSingle: async (tournamentId: number): Promise<WebTournamentRegistration> => {
    const { data } = await api.post(`/tournaments/${tournamentId}/register_single/`);
    return data;
  },
  registerLookingForPartner: async (tournamentId: number): Promise<WebTournamentRegistration> => {
    const { data } = await api.post(`/tournaments/${tournamentId}/register_looking_for_partner/`);
    return data;
  },
  registerWithPartner: async (tournamentId: number, partnerId: number): Promise<WebTournamentRegistration> => {
    const { data } = await api.post(`/tournaments/${tournamentId}/register_with_partner/`, { partner_id: partnerId });
    return data;
  },
  sendInvitation: async (tournamentId: number, receiverId: number, message?: string): Promise<any> => {
    const { data } = await api.post(`/tournaments/${tournamentId}/send_invitation/`, {
      receiver_id: receiverId,
      message: message || '',
    });
    return data;
  },
  leavePair: async (tournamentId: number): Promise<{ detail: string }> => {
    const { data } = await api.post(`/tournaments/${tournamentId}/leave_pair/`);
    return data;
  },
  cancelRegistration: async (tournamentId: number): Promise<{ detail: string }> => {
    const { data } = await api.post(`/tournaments/${tournamentId}/cancel_registration/`);
    return data;
  },
  searchPlayers: async (
    tournamentId: number,
    query: string,
  ): Promise<{ players: Array<{ id: number; full_name: string; is_registered: boolean }> }> => {
    const { data } = await api.get(`/tournaments/${tournamentId}/search_players/`, { params: { q: query } });
    return data;
  },
};
