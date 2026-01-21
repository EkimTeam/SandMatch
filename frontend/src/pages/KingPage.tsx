import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatDate } from '../services/date';
import api, { tournamentApi, Ruleset as ApiRuleset, ratingApi, schedulePatternApi, SchedulePattern, KingScheduleResponse, KingCalculationMode, matchApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { KnockoutParticipantPicker } from '../components/KnockoutParticipantPicker';
import SchedulePatternModal from '../components/SchedulePatternModal';
import { DraggableParticipantList } from '../components/DraggableParticipantList';
import { SimplifiedGroupTable, SimplifiedDropSlot } from '../components/SimplifiedGroupTable';
import { DraggableParticipant, DragDropState } from '../types/dragdrop';
import '../styles/knockout-dragdrop.css';
import html2canvas from 'html2canvas';
import { EditTournamentModal } from '../components/EditTournamentModal';
import { MatchScoreModal } from '../components/MatchScoreModal';
import FreeFormatScoreModal from '../components/FreeFormatScoreModal';
import { computeKingGroupRanking } from '../utils/kingRanking';
import { InitialRatingModal } from '../components/InitialRatingModal';

type Participant = {
  id: number;
  team?: { id: number; name: string; display_name?: string; full_name?: string; player_1?: number | { id: number }; player_2?: number | { id: number } } | null;
  group_index: number;
  row_index: number;
};

type TournamentDetail = {
  id: number;
  name: string;
  date?: string;
  system?: string;
  participant_mode?: string;
  groups_count?: number;
  get_system_display?: string;
  get_participant_mode_display?: string;
  status: string;
  participants: Participant[];
  planned_participants?: number | null;
  organizer_name?: string;
  can_delete?: boolean;
  participants_count?: number;
};

type SetFormatDict = { id: number; name: string };

export const KingPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const role = user?.role;
  const canManageTournament = role === 'ADMIN' || role === 'ORGANIZER';
  const canManageMatches = canManageTournament || role === 'REFEREE';
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [t, setT] = useState<TournamentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFullName, setShowFullName] = useState(false);
  
  const [dragDropState, setDragDropState] = useState<DragDropState>({
    participants: [],
    dropSlots: [],
    isSelectionLocked: false
  });
  const [simplifiedDropSlots, setSimplifiedDropSlots] = useState<SimplifiedDropSlot[]>([]);
  const [dragDropPickerOpen, setDragDropPickerOpen] = useState(false);
  
  const [schedule, setSchedule] = useState<Record<number, [number, number][][]>>({});
  const [showEditModal, setShowEditModal] = useState(false);
  const [setFormats, setSetFormats] = useState<SetFormatDict[]>([]);
  const [rrRulesets, setRrRulesets] = useState<ApiRuleset[]>([]);
  const [schedulePatternModal, setSchedulePatternModal] = useState<{ groupName: string; participantsCount: number; currentPatternId?: number | null } | null>(null);
  const [playerRatings, setPlayerRatings] = useState<Map<number, number>>(new Map());
  const [schedulePatterns, setSchedulePatterns] = useState<Map<number, SchedulePattern>>(new Map());
  const [kingSchedule, setKingSchedule] = useState<KingScheduleResponse | null>(null);
  const [calculationMode, setCalculationMode] = useState<KingCalculationMode>('g_minus');
  const [showTech, setShowTech] = useState(false);
  const [showInitialRatingModal, setShowInitialRatingModal] = useState(false);
  // Модалка действий по матчу (начать / ввести счёт)
  const [scoreDialog, setScoreDialog] = useState<null | {
    groupIndex: number;
    matchId: number;
    status: string;
    team1: { id: number; name: string };
    team2: { id: number; name: string };
    existingSets: any[];
  }>(null);
  const [scoreInput, setScoreInput] = useState<null | {
    matchId: number;
    team1: { id: number; name: string };
    team2: { id: number; name: string };
    existingSets?: any[];
  }>(null);
  const [showCalcTip, setShowCalcTip] = useState(false);
  const [showTextResultsModal, setShowTextResultsModal] = useState(false);
  const [textResults, setTextResults] = useState<string>('');
  const [loadingTextResults, setLoadingTextResults] = useState(false);
  
  // Статистика King с бэкенда (аналогично groupStats в круговой)
  // Бэкенд отдаёт сразу три режима: NO, G-, M+ (поля без суффикса, с _g и _m)
  const [kingStats, setKingStats] = useState<Record<number, {
    stats: Record<number, {
      // NO
      wins: number;
      sets_won: number;
      sets_lost: number;
      games_won: number;
      games_lost: number;
      games_ratio: number;
      sets_ratio_value: number;
      // G-
      wins_g?: number;
      sets_won_g?: number;
      sets_lost_g?: number;
      games_won_g?: number;
      games_lost_g?: number;
      games_ratio_g?: number;
      sets_ratio_value_g?: number;
      // M+
      wins_m?: number;
      sets_won_m?: number;
      sets_lost_m?: number;
      games_won_m?: number;
      games_lost_m?: number;
      games_ratio_m?: number;
      sets_ratio_value_m?: number;
    }>;
    placements: Record<number, number>;
  }>>({});
  
  const exportRef = useRef<HTMLDivElement | null>(null);
  const calcTipRef = useRef<HTMLDivElement | null>(null);

  // Функция генерации расписания King по количеству участников
  const generateKingSchedule = (participantsCount: number): { round: number; matches: [number[], number[]][] }[] => {
    const generateEvenRR = (m: number): Array<Array<[number, number]>> => {
      const rounds: Array<Array<[number, number]>> = [];
      const players = Array.from({ length: m }, (_, i) => i);
      let arr = players.slice();
      for (let r = 0; r < m - 1; r++) {
        const pairs: Array<[number, number]> = [];
        for (let i = 0; i < m / 2; i++) pairs.push([arr[i], arr[m - 1 - i]]);
        rounds.push(pairs);
        arr = [arr[0], arr[m - 1], ...arr.slice(1, m - 1)];
      }
      return rounds;
    };

    const generateOddRR = (m: number): Array<Array<[number, number]>> => {
      const rounds: Array<Array<[number, number]>> = [];
      let arr = Array.from({ length: m }, (_, i) => i);
      for (let r = 0; r < m; r++) {
        const extended = arr.concat([null as unknown as number]);
        const pairs: Array<[number, number]> = [];
        for (let i = 0; i < Math.floor(extended.length / 2); i++) {
          const a = extended[i]; const b = extended[extended.length - 1 - i];
          if (a !== null && b !== null) pairs.push([a, b]);
        }
        rounds.push(pairs);
        arr = [arr[arr.length - 1], ...arr.slice(0, arr.length - 1)];
      }
      return rounds;
    };
    const res: { round: number; matches: [number[], number[]][] }[] = [];

    if (participantsCount === 4) {
      const cfg: [number[], number[]][] = [[[0,1],[2,3]], [[0,2],[1,3]], [[0,3],[1,2]]];
      cfg.forEach((m,i)=>res.push({ round: i+1, matches: [m] }));
      return res;
    }
    
    if (participantsCount === 5) {
      const cfg: [number[], number[], number[]][] = [[[0,1],[2,3],[4]], [[0,2],[3,4],[1]], [[0,3],[1,4],[2]], [[0,4],[1,2],[3]], [[1,3],[2,4],[0]]];
      cfg.forEach(([a,b],i)=>res.push({ round: i+1, matches: [[a,b]] }));
      return res;
    }
    
    if (participantsCount === 6) {
      const cfg: [number[], number[], number[]][] = [[[0,1],[2,3],[4,5]], [[1,5],[3,4],[0,2]], [[0,2],[4,5],[1,3]], [[2,4],[1,3],[0,5]], [[0,4],[2,5],[1,3]], [[0,3],[1,4],[2,5]], [[3,5],[2,4],[0,1]], [[0,5],[1,2],[3,4]]];
      cfg.forEach(([a,b],i)=>res.push({ round: i+1, matches: [[a,b]] }));
      return res;
    }
    const rr = (participantsCount % 2 === 0) ? generateEvenRR(participantsCount) : generateOddRR(participantsCount);
    rr.forEach((pairs, rIdx) => {
      const matches: [number[], number[]][] = [];
      for (let i = 0; i + 1 < pairs.length; i += 2) {
        matches.push([[pairs[i][0], pairs[i][1]], [pairs[i+1][0], pairs[i+1][1]]]);
      }
      res.push({ round: rIdx + 1, matches });
    });
    return res;
  };

  const handleShowTextResults = async () => {
    if (!t) return;
    try {
      setLoadingTextResults(true);
      const res = await tournamentApi.getTextResults(t.id);
      setTextResults(res?.text || '');
      setShowTextResultsModal(true);
    } catch (e) {
      console.error('Failed to load text results', e);
      alert('Не удалось загрузить текстовые результаты');
    } finally {
      setLoadingTextResults(false);
    }
  };

  const handleCopyTextResults = async () => {
    try {
      if (!textResults) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textResults);
        alert('Текст результатов скопирован в буфер обмена');
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = textResults;
        textarea.style.position = 'fixed';
        textarea.style.left = '-1000px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        alert('Текст результатов скопирован в буфер обмена');
      }
    } catch (e) {
      console.error('Copy failed', e);
      alert('Не удалось скопировать текст результатов');
    }
  };

  const startKingMatch = async () => {
    if (!t || !scoreDialog?.matchId) return;
    if (t.status === 'completed') return;
    try {
      await api.post(`/tournaments/${t.id}/match_start/`, { match_id: scoreDialog.matchId });
      await reload();
      // Обновляем расписание King
      const data = await tournamentApi.getKingSchedule(t.id);
      setKingSchedule(data);
    } finally {
      setScoreDialog(null);
    }
  };

  const cancelKingMatch = async () => {
    if (!t || !scoreDialog?.matchId) return;
    if (t.status === 'completed') return;
    try {
      await api.post(`/tournaments/${t.id}/match_cancel/`, { match_id: scoreDialog.matchId });
      await reload();
      const data = await tournamentApi.getKingSchedule(t.id);
      setKingSchedule(data);
    } finally {
      setScoreDialog(null);
    }
  };

  const deleteKingMatch = async () => {
    if (!t || !scoreDialog?.matchId) return;
    if (!window.confirm('Удалить счет матча? Это действие нельзя отменить.')) return;
    try {
      await api.post(`/tournaments/${t.id}/match_delete_score/`, { match_id: scoreDialog.matchId });
      await reload();
      const data = await tournamentApi.getKingSchedule(t.id);
      setKingSchedule(data);
    } finally {
      setScoreDialog(null);
    }
  };

  const handleOpenEditSettings = () => {
    if (!t) return;
    setShowEditModal(true);
  };

  const handleEditSettingsSubmit = async (payload: any) => {
    if (!t) return;
    try {
      setSaving(true);
      await tournamentApi.editSettings(t.id, payload);
      setShowEditModal(false);
      window.location.href = `/tournaments/${t.id}/king`;
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Не удалось изменить настройки турнира');
    } finally {
      setSaving(false);
    }
  };

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await tournamentApi.getById(Number(id));

      // Турнир в статусе created: только ORGANIZER/ADMIN видят страницу King,
      // остальные (включая анонимов, REGISTERED и REFEREE) попадают на страницу регистрации.
      // Не выполняем редирект, пока AuthContext ещё загружается, чтобы сразу после создания
      // организатора не отправляло на страницу регистрации.
      const role = user?.role;
      const isOrganizerOrAdmin = role === 'ADMIN' || role === 'ORGANIZER';
      if (!authLoading && (data as any).status === 'created' && !isOrganizerOrAdmin) {
        nav(`/tournaments/${id}/registration`);
        return;
      }

      setT(data as any);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Не удалось загрузить турнир');
      setT(null);
    } finally {
      setLoading(false);
    }
  }, [id, nav, user?.role]);

  // Загрузка статистики King с бэкенда
  const loadKingStats = useCallback(async () => {
    if (!id) return;
    try {
      // Бэкенд всегда возвращает статистику для всех трёх режимов (NO, G-, M+)
      const { data } = await api.get(`/tournaments/${id}/king_stats/`);
      if (data?.ok && data?.groups) {
        // Преобразуем строковые ключи в числовые
        const statsMap: typeof kingStats = {};
        for (const [groupKey, groupData] of Object.entries(data.groups)) {
          const groupIdx = Number(groupKey);
          const gd = groupData as any;
          statsMap[groupIdx] = {
            stats: Object.fromEntries(
              Object.entries(gd.stats || {}).map(([rowKey, rowStats]) => [
                Number(rowKey),
                rowStats as any
              ])
            ),
            placements: Object.fromEntries(
              Object.entries(gd.placements || {}).map(([rowKey, rank]) => [
                Number(rowKey),
                rank as number
              ])
            )
          };
        }
        setKingStats(statsMap);
      }
    } catch (e) {
      console.warn('Не удалось загрузить King-статистику:', e);
    }
  }, [id, calculationMode]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Загружаем статистику при изменении турнира или режима расчёта
  useEffect(() => {
    if (t && t.status !== 'created') {
      loadKingStats();
    }
  }, [t, calculationMode, loadKingStats]);

  useEffect(() => {
    const loadRulesets = async () => {
      try {
        const list = await tournamentApi.getRulesets('king');
        setRrRulesets(list);
      } catch (e) {
        console.error('Failed to load rulesets:', e);
      }
    };
    loadRulesets();
  }, []);

  // Загрузка шаблонов расписания
  useEffect(() => {
    const loadPatterns = async () => {
      if (!t || !(t as any).group_schedule_patterns) return;
      
      try {
        const patterns = typeof (t as any).group_schedule_patterns === 'string' 
          ? JSON.parse((t as any).group_schedule_patterns) 
          : (t as any).group_schedule_patterns;
        
        const patternIds = new Set<number>();
        Object.values(patterns).forEach((id: any) => {
          if (typeof id === 'number') patternIds.add(id);
        });
        
        if (patternIds.size === 0) return;
        
        const loadedPatterns = new Map<number, SchedulePattern>();
        await Promise.all(
          Array.from(patternIds).map(async (id) => {
            try {
              const pattern = await schedulePatternApi.getById(id);
              loadedPatterns.set(id, pattern);
            } catch (e) {
              console.error(`Failed to load pattern ${id}:`, e);
            }
          })
        );
        
        setSchedulePatterns(loadedPatterns);
      } catch (e) {
        console.error('Failed to load schedule patterns:', e);
      }
    };
    
    loadPatterns();
  }, [t]);

  // Загрузка расписания King для active/completed турниров
  useEffect(() => {
    const loadKingSchedule = async () => {
      if (!t || (t.status !== 'active' && t.status !== 'completed')) return;
      try {
        const data = await tournamentApi.getKingSchedule(t.id);
        setKingSchedule(data);
        // Устанавливаем режим подсчета из турнира
        if ((t as any).calculation_mode) {
          setCalculationMode((t as any).calculation_mode);
        }
      } catch (e) {
        console.error('Failed to load King schedule:', e);
      }
    };
    loadKingSchedule();
  }, [t]);

  // Загрузка рейтингов игроков
  useEffect(() => {
    const loadRatings = async () => {
      try {
        if (!t || !t.participants) return;
        const ids = new Set<number>();
        for (const p of t.participants) {
          const team: any = p.team || {};
          const p1 = team.player_1 && typeof team.player_1 === 'object' ? team.player_1.id : (typeof team.player_1 === 'number' ? team.player_1 : null);
          const p2 = team.player_2 && typeof team.player_2 === 'object' ? team.player_2.id : (typeof team.player_2 === 'number' ? team.player_2 : null);
          if (typeof p1 === 'number') ids.add(p1);
          if (typeof p2 === 'number') ids.add(p2);
        }
        if (ids.size === 0) { setPlayerRatings(new Map()); return; }
        const idArray = Array.from(ids);

        // Для завершённых турниров используем рейтинг ДО турнира
        if (t.status === 'completed') {
          const map = new Map<number, number>();
          await Promise.all(idArray.map(async (pid) => {
            try {
              const hist = await ratingApi.playerHistory(pid);
              const rows = hist?.history || [];
              const row = rows.find((r: any) => r.tournament_id === t.id && typeof r.rating_before === 'number');
              if (row) {
                map.set(pid, row.rating_before);
              }
            } catch {}
          }));

          const missing = idArray.filter(pid => !map.has(pid));
          if (missing.length > 0) {
            try {
              const respBriefs = await ratingApi.playerBriefs(missing);
              for (const it of (respBriefs.results || [])) {
                if (typeof it.id === 'number' && typeof it.current_rating === 'number' && !map.has(it.id)) {
                  map.set(it.id, it.current_rating);
                }
              }
            } catch {}
          }
          setPlayerRatings(map);
        } else {
          // Для незавершённых турниров используем текущий рейтинг
          const resp = await ratingApi.playerBriefs(idArray);
          const map = new Map<number, number>();
          for (const it of (resp.results || [])) {
            if (typeof it.id === 'number' && typeof it.current_rating === 'number') {
              map.set(it.id, it.current_rating);
            }
          }
          setPlayerRatings(map);
        }
      } catch {
        setPlayerRatings(new Map());
      }
    };
    loadRatings();
  }, [t]);

  const fetchGroupSchedule = useCallback(async (tournamentId?: string | number) => {
    const tid = tournamentId ?? id;
    if (!tid) return;
    try {
      // Для King используем king_schedule эндпоинт
      const { data } = await api.get(`/tournaments/${tid}/king_schedule/`);
      if (data && data.schedule) {
        const scheduleMap: Record<number, [number, number][][]> = {};
        // Преобразуем формат king_schedule в нужный формат
        Object.entries(data.schedule).forEach(([groupKey, groupData]: [string, any]) => {
          const match = groupKey.match(/\d+/);
          if (match && groupData.rounds) {
            const groupIndex = parseInt(match[0], 10);
            const rounds: [number, number][][] = groupData.rounds.map((round: any) => {
              return (round.matches || []).map((m: any) => [m.row1, m.row2] as [number, number]);
            });
            scheduleMap[groupIndex] = rounds;
          }
        });
        setSchedule(scheduleMap);
      }
    } catch (e) {
      console.error('Failed to load group schedule:', e);
    }
  }, [id]);

  useEffect(() => {
    if (t && t.status === 'created') {
      fetchGroupSchedule();
    }
  }, [t, fetchGroupSchedule]);

  useEffect(() => {
    if (!t || t.status !== 'created') return;
    
    // Загружаем участников через API для получения list_status
    const loadParticipantsWithStatus = async () => {
      try {
        const participantsList = await tournamentApi.getTournamentParticipants(t.id);
        
        // Создаем Map для быстрого поиска позиций из t.participants
        const positionMap = new Map();
        (t.participants || []).forEach((p: any) => {
          if (p.id) {
            positionMap.set(p.id, {
              groupIndex: p.group_index,
              rowIndex: p.row_index
            });
          }
        });
        
        const allParticipants: DraggableParticipant[] = participantsList.map((p: any) => {
          const position = positionMap.get(p.id) || {};
          return {
            id: p.id,
            teamId: p.team_id,
            name: p.name,
            fullName: p.name,
            displayName: p.name,
            currentRating: typeof p.rating === 'number' ? p.rating : undefined,
            rating: typeof p.rating === 'number' ? p.rating : undefined,
            groupIndex: position.groupIndex,
            rowIndex: position.rowIndex,
            isInBracket: position.groupIndex != null && position.rowIndex != null,
            listStatus: p.list_status || 'main',
            registrationOrder: p.registration_order
          };
        });
        
        const draggableParticipants = allParticipants;
        
        // Разделяем на основной и резервный списки
        const mainParticipants = allParticipants.filter(p => p.listStatus === 'main');
        const reserveParticipants = allParticipants.filter(p => p.listStatus === 'reserve');

        const totalParticipants = t.planned_participants || 0;
        const groupsCount = t.groups_count || 1;
        const base = Math.floor(totalParticipants / groupsCount);
        const remainder = totalParticipants % groupsCount;

        const slots: SimplifiedDropSlot[] = [];
        for (let gi = 0; gi < groupsCount; gi++) {
          const plannedPerGroup = gi < remainder ? base + 1 : base;
          for (let ri = 0; ri < plannedPerGroup; ri++) {
            // Ищем участника, который уже размещён в этой позиции (group_index и row_index заполнены)
            const existing = draggableParticipants.find(p => p.groupIndex === gi + 1 && p.rowIndex === ri + 1);
            slots.push({
              groupIndex: gi,
              rowIndex: ri,
              currentParticipant: existing || null,
            });
          }
        }

        setDragDropState({
          participants: draggableParticipants,
          mainParticipants,
          reserveParticipants,
          dropSlots: [],
          isSelectionLocked: false,
        });
        setSimplifiedDropSlots(slots);
      } catch (error) {
        console.error('Failed to load participants with status:', error);
      }
    };
    
    loadParticipantsWithStatus();
  }, [t]);

  const handleDropParticipant = async (groupIndex: number, rowIndex: number, participant: DraggableParticipant) => {
    if (!t) return;
    const slot = simplifiedDropSlots.find(s => s.groupIndex === groupIndex && s.rowIndex === rowIndex);
    if (slot?.currentParticipant) {
      alert('Эта позиция уже занята');
      return;
    }
    try {
      await api.post(`/tournaments/${t.id}/assign_participant/`, {
        entry_id: participant.id,
        group_index: groupIndex + 1,
        row_index: rowIndex + 1,
      });
      await reload();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Не удалось добавить участника');
    }
  };

  const handleRemoveParticipant = async (groupIndex: number, rowIndex: number) => {
    if (!t) return;
    const slot = simplifiedDropSlots.find(s => s.groupIndex === groupIndex && s.rowIndex === rowIndex);
    if (!slot?.currentParticipant) return;
    try {
      await api.post(`/tournaments/${t.id}/remove_participant_from_slot/`, {
        entry_id: slot.currentParticipant.id,
      });
      await reload();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Не удалось удалить участника');
    }
  };

  const handleRemoveParticipantFromList = async (participantId: number) => {
    if (!t) return;
    if (!confirm('Удалить участника из турнира?')) return;
    try {
      await api.delete(`/tournaments/${t.id}/remove_participant/`, {
        data: { entry_id: participantId }
      });
      await reload();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Не удалось удалить участника');
    }
  };

  const handleAutoSeed = async () => {
    if (!t) return;
    if (!confirm('Автоматически расставить участников по таблицам?')) return;
    try {
      setSaving(true);
      await api.post(`/tournaments/${t.id}/auto_seed/`);
      await reload();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Не удалось выполнить автопосев');
    } finally {
      setSaving(false);
    }
  };

  const handleClearTables = async () => {
    if (!t) return;
    if (!confirm('Очистить все таблицы?')) return;
    try {
      setSaving(true);
      await api.post(`/tournaments/${t.id}/clear_tables/`);
      await reload();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Не удалось очистить таблицы');
    } finally {
      setSaving(false);
    }
  };


  const handleShare = async () => {
    if (!exportRef.current) return;
    const el = exportRef.current;
    const excludes = el.querySelectorAll('[data-export-exclude="true"]');
    const onlys = el.querySelectorAll('[data-export-only="true"]');
    excludes.forEach((node: any) => { if (node.style) node.style.display = 'none'; });
    onlys.forEach((node: any) => { if (node.style) node.style.display = 'flex'; });
    try {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, allowTaint: false });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `beachplay_tournament_${t?.id || 'export'}.png`;
        a.click();
        URL.revokeObjectURL(url);
      });
    } catch (err) {
      console.error('Export error:', err);
      alert('Не удалось экспортировать изображение');
    } finally {
      excludes.forEach((node: any) => { if (node.style) node.style.display = ''; });
      onlys.forEach((node: any) => { if (node.style) node.style.display = 'none'; });
    }
  };

  // Функции управления турниром
  const handleCalculationModeChange = async (mode: KingCalculationMode) => {
    if (!t) return;
    try {
      const result = await tournamentApi.setKingCalculationMode(t.id, mode);
      if (result.ok) {
        setCalculationMode(mode);
        // Перезагрузка расписания для пересчета статистики
        const data = await tournamentApi.getKingSchedule(t.id);
        setKingSchedule(data);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка при изменении режима');
    }
  };

  const handleRulesetChange = async (rulesetId: number) => {
    if (!t || !canManageTournament) return;
    try {
      const res = await tournamentApi.setRuleset(t.id, rulesetId);
      if (res?.ok) {
        await reload();
      }
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Ошибка при изменении регламента');
    }
  };

  const completeTournament = async () => {
    if (!t || !canManageTournament || !window.confirm('Завершить турнир?')) return;
    try {
      setSaving(true);
      await tournamentApi.complete(t.id);
      await reload();
      window.location.href = '/tournaments';
    } catch (err: any) {
      const errorData = err?.response?.data;
      if (errorData?.error === 'incomplete_matches') {
        const confirmed = window.confirm(errorData.message);
        if (confirmed) {
          try {
            await tournamentApi.complete(t.id, true);
            alert('Турнир завершён');
            window.location.href = '/tournaments';
          } catch (e2: any) {
            alert(e2?.response?.data?.error || 'Ошибка завершения турнира');
          }
        }
      } else {
        alert(errorData?.error || 'Ошибка при завершении турнира');
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteTournament = async () => {
    if (!t || !(t as any).can_delete || !window.confirm('Удалить турнир безвозвратно?')) return;
    try {
      setSaving(true);
      await tournamentApi.delete(t.id);
      nav('/tournaments');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка при удалении турнира');
      setSaving(false);
    }
  };

  const distinctPlayerIds = useMemo(() => {
    const ids = new Set<number>();
    (t?.participants || []).forEach(p => {
      const team = p.team;
      if (!team) return;
      const p1 = typeof team.player_1 === 'object' ? team.player_1?.id : team.player_1;
      const p2 = typeof team.player_2 === 'object' ? team.player_2?.id : team.player_2;
      if (p1 != null) ids.add(Number(p1));
      if (p2 != null) ids.add(Number(p2));
    });
    return ids;
  }, [t]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-600">Загрузка...</div>
      </div>
    );
  }

  if (error || !t) {
    return (
      <div className="p-4">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error || 'Турнир не найден'}
        </div>
      </div>
    );
  }

  const completed = t.status === 'completed';

  return (
    <div>
      <div ref={exportRef}>
        <div style={{ position: 'relative', padding: '24px 24px 12px 24px', borderBottom: '1px solid #eee', background: '#fff' }}>
          <img src="/static/img/logo.png" alt="BeachPlay" style={{ position: 'absolute', right: 24, top: 24, height: 48 }} />
          <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 2 }}>{t.name}</div>
          <div style={{ fontSize: 16, color: '#666' }}>
            {t.date ? formatDate(t.date) : ''}
            {t.get_system_display ? ` • ${t.get_system_display}` : ''}
            {t.get_participant_mode_display ? ` • ${t.get_participant_mode_display}` : ''}
            {(t as any)?.set_format?.name ? ` • Формат счёта: ${(t as any).set_format.name}` : ''}
            {(t as any).organizer_name ? ` • Организатор: ${(t as any).organizer_name}` : ''}
          </div>
          <div style={{ fontSize: 13, color: '#777', marginTop: 2 }}>
            Статус: {t.status === 'created' ? 'Регистрация' : t.status === 'active' ? 'Идёт' : 'Завершён'}
            {typeof t.participants_count === 'number' && typeof t.planned_participants === 'number' 
              ? ` • Участников: ${t.participants_count}/${t.planned_participants}` 
              : typeof t.participants_count === 'number' 
              ? ` • Участников: ${t.participants_count}` 
              : ''}
            {typeof (t as any).groups_count === 'number'
              ? ` • Групп: ${(t as any).groups_count}`
              : ''}
            {(t as any).prize_fund ? ` • Призовой фонд: ${(t as any).prize_fund}` : ''}
            {t.status !== 'created' && typeof (t as any).avg_rating_bp === 'number' ? ` • средний рейтинг турнира по BP: ${Math.round((t as any).avg_rating_bp)}` : ''}
            {t.status !== 'created' && typeof (t as any).rating_coefficient === 'number' ? ` • Коэффициент турнира: ${(t as any).rating_coefficient.toFixed(1)}` : ''}
          </div>
        </div>

        {t.status === 'created' ? (
          <div className="knockout-content" style={{ marginTop: 16, height: 'calc(100vh - 300px)', minHeight: '500px' }}>
            <div className="participants-panel">
              <DraggableParticipantList
                participants={dragDropState.participants}
                mainParticipants={dragDropState.mainParticipants}
                reserveParticipants={dragDropState.reserveParticipants}
                onRemoveParticipant={handleRemoveParticipantFromList}
                onAddParticipant={() => setDragDropPickerOpen(true)}
                onAutoSeed={handleAutoSeed}
                onClearTables={handleClearTables}
                maxParticipants={t.planned_participants || 32}
                canAddMore={true}
                tournamentSystem="king"
              />
            </div>

            <div className="bracket-panel">
              <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
                <button 
                  data-export-exclude="true" 
                  className={`toggle ${showFullName ? 'active' : ''}`} 
                  onClick={() => setShowFullName(v => !v)}
                >
                  ФИО показать
                </button>
              </div>
              
              {Array.from({ length: t.groups_count || 1 }, (_, gi) => {
                const groupIndex = gi;
                const groupName = `Группа ${gi + 1}`;
                const totalParticipants = t.planned_participants || 0;
                const groupsCount = t.groups_count || 1;
                const base = Math.floor(totalParticipants / groupsCount);
                const remainder = totalParticipants % groupsCount;
                const plannedPerGroup = groupIndex < remainder ? base + 1 : base;
                const groupSlots = simplifiedDropSlots.filter(s => s.groupIndex === groupIndex);
                
                return (
                  <div key={groupIndex} style={{ marginBottom: 24 }}>
                    <SimplifiedGroupTable
                      groupIndex={groupIndex}
                      groupName={groupName}
                      plannedParticipants={plannedPerGroup}
                      dropSlots={groupSlots}
                      onDrop={handleDropParticipant}
                      onRemove={handleRemoveParticipant}
                      isLocked={dragDropState.isSelectionLocked}
                      showFullName={showFullName}
                    />
                    
                    <div style={{ marginTop: 16, padding: 12, background: '#f8f9fa', borderRadius: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                        Расписание группы {gi + 1}
                      </div>
                      
                      {(() => {
                        // Получаем ID шаблона для этой группы
                        let patternId: number | null = null;
                        const raw = (t as any)?.group_schedule_patterns;
                        if (raw) {
                          const patterns = typeof raw === 'string' ? JSON.parse(raw) : raw;
                          const nbspName = groupName.replace(' ', '\u00A0');
                          const val = patterns?.[groupName] ?? patterns?.[nbspName];
                          if (val != null && val !== '') patternId = Number(val);
                        }
                        
                        // Получаем шаблон из загруженных
                        const pattern = patternId ? schedulePatterns.get(patternId) : null;
                        
                        if (pattern && pattern.custom_schedule) {
                          // Отображаем расписание из шаблона
                          const toLetter = (i: number) => String.fromCharCode(64 + i); // 1->A, 2->B
                          let cs: any = pattern.custom_schedule;
                          if (typeof cs === 'string') {
                            try { cs = JSON.parse(cs); } catch { cs = {}; }
                          }
                          const rounds = Array.isArray(cs?.rounds) ? cs.rounds : [];
                          
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {rounds.map((round: any, idx: number) => (
                                <div key={idx} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0 32px' }}>
                                  {(() => {
                                    const source = Array.isArray(round.pairs) ? round.pairs : (Array.isArray(round.matches) ? round.matches : []);
                                    return source.map((pair: any, pairIdx: number) => {
                                      let a = pair?.[0];
                                      let b = pair?.[1];
                                      if (a == null && b == null && pair && typeof pair === 'object') {
                                        a = pair.team1 ?? pair.left ?? pair.a ?? null;
                                        b = pair.team2 ?? pair.right ?? pair.b ?? null;
                                      }
                                      const formatSide = (side: any) => {
                                        if (Array.isArray(side)) {
                                          return side.map((v) => toLetter(Number(v))).join('+');
                                        }
                                        return toLetter(Number(side));
                                      };
                                      const left = formatSide(a);
                                      const right = formatSide(b);
                                      return (
                                        <React.Fragment key={pairIdx}>
                                          <span style={{ fontWeight: pairIdx === 0 ? 600 : 'normal', opacity: pairIdx === 0 ? 1 : 0, userSelect: pairIdx === 0 ? 'auto' : 'none' }}>
                                            {`Тур ${round.round}:`}
                                          </span>
                                          <span style={{ fontSize: 13 }}>
                                            {left && right ? `${left} vs ${right}` : ''}
                                          </span>
                                        </React.Fragment>
                                      );
                                    });
                                  })()}
                                </div>
                              ))}
                            </div>
                          );
                        } else if (plannedPerGroup >= 4) {
                          // Fallback: генерируем системное расписание
                          const toLetter = (i: number) => String.fromCharCode(65 + i); // 0->A
                          const rounds = generateKingSchedule(plannedPerGroup);
                          
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {rounds.map((r) => (
                                <div key={r.round} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0 32px' }}>
                                  {r.matches.map((m, mi) => (
                                    <React.Fragment key={mi}>
                                      <span style={{ fontWeight: mi === 0 ? 600 : 'normal', opacity: mi === 0 ? 1 : 0, userSelect: mi === 0 ? 'auto' : 'none' }}>
                                        {`Тур ${r.round}:`}
                                      </span>
                                      <span style={{ fontSize: 13 }}>
                                        {m[0].map(toLetter).join('+')} vs {m[1].map(toLetter).join('+')}
                                      </span>
                                    </React.Fragment>
                                  ))}
                                </div>
                              ))}
                            </div>
                          );
                        } else {
                          return (
                            <div style={{ fontSize: 13, color: '#6c757d' }}>
                              Расписание доступно для групп с 4 и более участниками (запланировано: {plannedPerGroup})
                            </div>
                          );
                        }
                      })()}
                      
                      {canManageTournament && (
                        <button
                          onClick={() => {
                            let currentPatternId: number | null = null;
                            const raw = (t as any)?.group_schedule_patterns;
                            if (raw) {
                              if (typeof raw === 'string') {
                                try {
                                  const parsed = JSON.parse(raw);
                                  const nbspName = groupName.replace(' ', '\u00A0');
                                  const val = parsed?.[groupName] ?? parsed?.[nbspName];
                                  if (val != null && val !== '') currentPatternId = Number(val);
                                } catch (_) {}
                              } else if (typeof raw === 'object') {
                                const nbspName = groupName.replace(' ', '\u00A0');
                                const val = raw?.[groupName] ?? raw?.[nbspName];
                                if (val != null && val !== '') currentPatternId = Number(val);
                              }
                            }
                            setSchedulePatternModal({
                              groupName,
                              participantsCount: plannedPerGroup,
                              currentPatternId
                            });
                          }}
                          className="px-3 py-1.5 text-sm text-white bg-green-600 rounded hover:bg-green-700 transition-colors"
                        >
                          Выбрать формат расписания
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              
              {canManageTournament && (() => {
                const allSlotsFilled = simplifiedDropSlots.every(slot => slot.currentParticipant !== null);
                const canLockNow = allSlotsFilled && simplifiedDropSlots.length > 0;
                
                return (
                  <div style={{ marginTop: 16, padding: 16, background: '#f8f9fa', borderRadius: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: canLockNow ? 'pointer' : 'not-allowed', opacity: canLockNow ? 1 : 0.5 }}>
                      <input
                        type="checkbox"
                        checked={dragDropState.isSelectionLocked}
                        disabled={saving || !canLockNow}
                        onChange={async (e) => {
                          if (e.target.checked) {
                            try {
                              setSaving(true);
                              await tournamentApi.lockParticipants(t.id);
                              setDragDropState(prev => ({ ...prev, isSelectionLocked: true }));
                              await reload();
                            } catch (error) {
                              console.error('Failed to lock participants:', error);
                              alert('Не удалось зафиксировать участников');
                            } finally {
                              setSaving(false);
                            }
                          }
                        }}
                      />
                      <span>Зафиксировать участников и сгенерировать расписание</span>
                    </label>
                    <p style={{ margin: '8px 0 0 0', fontSize: 13, color: '#666' }}>
                      {canLockNow 
                        ? 'После фиксации будет создано расписание матчей и турнир перейдет в статус "Идёт"'
                        : 'Заполните все позиции в таблицах, чтобы зафиксировать участников'
                      }
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
          <div style={{ padding: 24 }}>
            {/* Радиокнопки режима подсчета и выбор регламента */}
            <div className="mb-4 flex items-center gap-4 flex-wrap" data-export-exclude="true">
              <span className="font-semibold">Режим подсчета:</span>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="g_minus"
                  checked={calculationMode === 'g_minus'}
                  disabled={!canManageTournament || completed}
                  onChange={(e) => handleCalculationModeChange(e.target.value as KingCalculationMode)}
                  className="cursor-pointer"
                />
                <span>G-</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="m_plus"
                  checked={calculationMode === 'm_plus'}
                  disabled={!canManageTournament || completed}
                  onChange={(e) => handleCalculationModeChange(e.target.value as KingCalculationMode)}
                  className="cursor-pointer"
                />
                <span>M+</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="no"
                  checked={calculationMode === 'no'}
                  disabled={!canManageTournament || completed}
                  onChange={(e) => handleCalculationModeChange(e.target.value as KingCalculationMode)}
                  className="cursor-pointer"
                />
                <span>NO</span>
              </label>
              {/* Тултип с пояснением режимов */}
              {(() => {
                const tipLines = [
                  'При разном количестве сыгранных матчей:',
                  "'G-' — не учитывает последний матч(и), которые больше минимально сыгранных для игрока матчей.",
                  "'M+' — за несыгранные до максимального количества матч(и) добавляется среднее число геймов.",
                  "'NO' — не учитывает разное количество сыгранных матчей.",
                ];
                return (
                  <div className="relative" ref={calcTipRef}
                       onMouseEnter={() => setShowCalcTip(true)}
                       onMouseLeave={() => setShowCalcTip(false)}
                  >
                    <button
                      type="button"
                      aria-label="Пояснение режима подсчета"
                      aria-expanded={showCalcTip}
                      className="text-gray-500 cursor-pointer select-none w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      onClick={() => setShowCalcTip(v => !v)}
                      onFocus={() => setShowCalcTip(true)}
                      onBlur={(e) => {
                        if (calcTipRef.current && !calcTipRef.current.contains(e.relatedTarget as Node)) {
                          setShowCalcTip(false);
                        }
                      }}
                    >
                      ℹ️
                    </button>
                    {showCalcTip && (
                      <div
                        role="dialog"
                        aria-live="polite"
                        className="absolute z-20 mt-2 w-80 max-w-[90vw] rounded-md border border-gray-200 bg-white p-3 shadow-lg text-sm leading-snug"
                        style={{ left: 0 }}
                      >
                        {tipLines.map((line, i) => (
                          <p key={i} className={i === 0 ? 'font-medium mb-1' : 'mb-1'}>{line}</p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Регламент */}
              <span className="font-semibold ml-4">Регламент:</span>
              <div className="flex-1 min-w-[240px]" style={{ maxWidth: '100%' }}>
                <select
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={(t as any).ruleset?.id || ''}
                  disabled={!canManageTournament || completed}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (!Number.isNaN(val)) handleRulesetChange(val);
                  }}
                >
                  {(!rrRulesets || rrRulesets.length === 0) && (
                    <option value="">Загрузка…</option>
                  )}
                  {rrRulesets.map((rs) => (
                    <option key={rs.id} value={rs.id}>{rs.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Таблицы и расписание по группам */}
            {kingSchedule && (
              <div className="space-y-8">
                {Object.entries(kingSchedule.schedule).map(([groupIndex, groupData]) => {
                  const gi = parseInt(groupIndex, 10);
                  const groupName = `Группа ${gi}`;
                  
                  // Статистика для группы из бэкенда (wins/sets/games для всех режимов)
                  const groupStats = kingStats[gi];
                  const statsByRow = groupStats?.stats || {};
                  
                  // Ранжирование считаем на фронтенде по действующему регламенту,
                  // используя бэкенд-агрегаты как базовые значения критериев
                  const rankMap = computeKingGroupRanking(t, groupData, groupIndex, calculationMode, statsByRow);
                  
                  // Функция для конвертации числа в римские цифры
                  const toRoman = (num: number) => {
                    const romans: [number, string][] = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
                    let n = Math.max(1, Math.floor(num));
                    let res = '';
                    for (const [v, s] of romans) {
                      while (n >= v) {
                        res += s;
                        n -= v;
                      }
                    }
                    return res;
                  };
                  
                  return (
                    <div key={groupIndex} style={{ marginBottom: 22 }}>
                      <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <strong>{groupName}</strong>
                        <button 
                          data-export-exclude="true" 
                          className={`toggle ${showTech ? 'active' : ''}`} 
                          onClick={() => setShowTech(v => !v)}
                        >
                          Победы/Сеты/Сеты соот./Геймы соот.
                        </button>
                        <button 
                          data-export-exclude="true" 
                          className={`toggle ${showFullName ? 'active' : ''}`} 
                          onClick={() => setShowFullName(v => !v)}
                        >
                          ФИО показать
                        </button>
                      </div>

                      {/* Таблица результатов */}
                      <div style={{ overflow: 'auto', marginBottom: 20 }}>
                        <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 50 }}>№</th>
                              <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px' }}>Участник</th>
                              {groupData.rounds.map((round: any) => (
                                <th key={round.round} style={{ border: '1px solid #e7e7ea', padding: '6px 8px' }}>Тур {round.round}</th>
                              ))}
                              <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 70 }}>G-/M+</th>
                              <th className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 80 }}>
                                Победы
                                {calculationMode === 'm_plus' && (
                                  <span 
                                    title={
                                      'Для режима M+ число побед не учитывается,\n' +
                                      'так как игроки сыграли разное количество игр,\n' +
                                      'и может возникнуть дисбаланс.'
                                    }
                                    style={{ 
                                      display: 'inline-block',
                                      width: 14,
                                      height: 14,
                                      marginLeft: 4,
                                      borderRadius: 3,
                                      backgroundColor: '#007bff',
                                      color: '#fff',
                                      fontSize: 10,
                                      lineHeight: '14px',
                                      textAlign: 'center',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    i
                                  </span>
                                )}
                              </th>
                              <th className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Сеты</th>
                              <th className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Сеты<br />соот.</th>
                              <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Геймы</th>
                              <th className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Геймы<br />соот.</th>
                              <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Место</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupData.participants.map((participant: any) => {
                              const letter = String.fromCharCode(64 + (participant.row_index || 0));
                              const nm = showFullName ? participant.name : participant.display_name;
                              
                              // Получаем рейтинг участника
                              const entry = (t.participants || []).find((e: any) => e.group_index === gi && e.row_index === participant.row_index);
                              const pTeam: any = entry?.team || {};
                              
                              // Получаем рейтинг первого игрока команды
                              let pid: number | null = null;
                              if (typeof pTeam.player_1 === 'object' && pTeam.player_1?.id) {
                                pid = Number(pTeam.player_1.id);
                              } else if (typeof pTeam.player_1 === 'number') {
                                pid = Number(pTeam.player_1);
                              }
                              
                              // Для doubles берем среднее из двух игроков
                              let pr: number | null = null;
                              if (t.participant_mode === 'doubles') {
                                let pid2: number | null = null;
                                if (typeof pTeam.player_2 === 'object' && pTeam.player_2?.id) {
                                  pid2 = Number(pTeam.player_2.id);
                                } else if (typeof pTeam.player_2 === 'number') {
                                  pid2 = Number(pTeam.player_2);
                                }
                                const r1 = (pid != null && playerRatings.has(pid)) ? playerRatings.get(pid)! : null;
                                const r2 = (pid2 != null && playerRatings.has(pid2)) ? playerRatings.get(pid2)! : null;
                                if (r1 !== null && r2 !== null) {
                                  pr = Math.round((r1 + r2) / 2);
                                } else if (r1 !== null) {
                                  pr = r1;
                                } else if (r2 !== null) {
                                  pr = r2;
                                }
                              } else {
                                pr = (pid != null && playerRatings.has(pid)) ? playerRatings.get(pid)! : null;
                              }
                              
                              return (
                                <tr key={participant.id}>
                                  <td style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{letter}</td>
                                  <td style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'left', fontWeight: 700 }}>
                                    <span>{nm}</span>
                                    {typeof pr === 'number' && (
                                      <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.75 }}>{Math.round(pr)} <span style={{ fontSize: 9 }}>BP</span></span>
                                    )}
                                  </td>
                                  {/* Ячейки по турам + статистика */}
                                  {(() => {
                                    const scheduleRounds: any[] = groupData.rounds || [];
                                    const allMatches: any[] = scheduleRounds.flatMap((r: any) => r.matches || []);
                                    
                                    // Собираем ID игроков для поиска матчей
                                    const playerIds = new Set<number>();
                                    if (typeof pTeam.player_1 === 'object' && pTeam.player_1?.id) {
                                      playerIds.add(Number(pTeam.player_1.id));
                                    } else if (typeof pTeam.player_1 === 'number') {
                                      playerIds.add(Number(pTeam.player_1));
                                    }
                                    if (typeof pTeam.player_2 === 'object' && pTeam.player_2?.id) {
                                      playerIds.add(Number(pTeam.player_2.id));
                                    } else if (typeof pTeam.player_2 === 'number') {
                                      playerIds.add(Number(pTeam.player_2));
                                    }
                                    
                                    // Подсчет очков, сетов и побед по турам
                                    const pointsByRound: Array<number | null> = [];
                                    const oppPointsByRound: Array<number | null> = [];
                                    let computedWins = 0;
                                    let computedSetsWon = 0;
                                    let computedSetsLost = 0;
                                    
                                    scheduleRounds.forEach((round: any, rIdx: number) => {
                                      const sms: any[] = (round.matches || []) as any[];
                                      const schedMatch = sms.find((sm: any) => {
                                        const inT1 = sm.team1_players?.some((p: any) => playerIds.has(Number(p.id)));
                                        const inT2 = sm.team2_players?.some((p: any) => playerIds.has(Number(p.id)));
                                        return inT1 || inT2;
                                      });
                                      if (!schedMatch) { pointsByRound[rIdx] = null; oppPointsByRound[rIdx] = null; return; }
                                      const iAmTeam1 = schedMatch.team1_players?.some((p: any) => playerIds.has(Number(p.id)));
                                      const full = allMatches.find((fm: any) => fm.id === schedMatch.id);
                                      const sets = (full?.sets || []) as any[];
                                      if (!sets.length) { pointsByRound[rIdx] = null; oppPointsByRound[rIdx] = null; return; }
                                      const totalSets = sets.length;
                                      const onlyTB = totalSets === 1 && !!sets[0].is_tiebreak_only;
                                      let sum = 0;
                                      let oppSum = 0;
                                      let hadAnySet = false;
                                      sets.forEach((s: any) => {
                                        const isTBOnly = !!s.is_tiebreak_only;
                                        const hasTB = s.tb_1 != null || s.tb_2 != null;
                                        const idx = Number(s.index || 0);
                                        if (isTBOnly) {
                                          hadAnySet = true;
                                          const t1 = Number(s.tb_1 ?? 0), t2 = Number(s.tb_2 ?? 0);
                                          if (onlyTB) {
                                            const my = iAmTeam1 ? t1 : t2;
                                            const op = iAmTeam1 ? t2 : t1;
                                            sum += my; oppSum += op;
                                          } else {
                                            const my = iAmTeam1 ? (t1 > t2 ? 1 : 0) : (t2 > t1 ? 1 : 0);
                                            const op = iAmTeam1 ? (t2 > t1 ? 1 : 0) : (t1 > t2 ? 1 : 0);
                                            sum += my; oppSum += op;
                                          }
                                          if (t1 > t2) { if (iAmTeam1) computedSetsWon++; else computedSetsLost++; } else if (t2 > t1) { if (iAmTeam1) computedSetsLost++; else computedSetsWon++; }
                                        } else if (hasTB && idx === 3) {
                                          hadAnySet = true;
                                          const t1 = Number(s.tb_1 ?? 0);
                                          const t2 = Number(s.tb_2 ?? 0);
                                          const myPoint = iAmTeam1 ? (t1 > t2 ? 1 : 0) : (t2 > t1 ? 1 : 0);
                                          const opPoint = iAmTeam1 ? (t2 > t1 ? 1 : 0) : (t1 > t2 ? 1 : 0);
                                          sum += myPoint; oppSum += opPoint;
                                          if (myPoint > opPoint) computedSetsWon++; else if (opPoint > myPoint) computedSetsLost++;
                                        } else {
                                          const g1 = Number(s.games_1 || 0);
                                          const g2 = Number(s.games_2 || 0);
                                          if (g1 !== 0 || g2 !== 0) hadAnySet = true;
                                          const my = iAmTeam1 ? g1 : g2;
                                          const op = iAmTeam1 ? g2 : g1;
                                          sum += my; oppSum += op;
                                          if (g1 > g2) { if (iAmTeam1) computedSetsWon++; else computedSetsLost++; }
                                          else if (g2 > g1) { if (iAmTeam1) computedSetsLost++; else computedSetsWon++; }
                                        }
                                      });
                                      if (!hadAnySet) { pointsByRound[rIdx] = null; oppPointsByRound[rIdx] = null; return; }
                                      pointsByRound[rIdx] = sum; oppPointsByRound[rIdx] = oppSum;
                                      
                                      // Подсчёт победы в матче по сетам
                                      let mSetsMy = 0, mSetsOp = 0;
                                      sets.forEach((s: any) => {
                                        const isTBOnly = !!s.is_tiebreak_only;
                                        const hasTB = s.tb_1 != null || s.tb_2 != null;
                                        const idx = Number(s.index || 0);
                                        if (isTBOnly) {
                                          const t1 = Number(s.tb_1 ?? 0), t2 = Number(s.tb_2 ?? 0);
                                          if (t1 > t2) { if (iAmTeam1) mSetsMy++; else mSetsOp++; }
                                          else if (t2 > t1) { if (iAmTeam1) mSetsOp++; else mSetsMy++; }
                                        } else if (hasTB && idx === 3) {
                                          const t1 = Number(s.tb_1 ?? 0), t2 = Number(s.tb_2 ?? 0);
                                          if (t1 > t2) { if (iAmTeam1) mSetsMy++; else mSetsOp++; }
                                          else if (t2 > t1) { if (iAmTeam1) mSetsOp++; else mSetsMy++; }
                                        } else {
                                          const g1 = Number(s.games_1 || 0), g2 = Number(s.games_2 || 0);
                                          if (g1 > g2) { if (iAmTeam1) mSetsMy++; else mSetsOp++; }
                                          else if (g2 > g1) { if (iAmTeam1) mSetsOp++; else mSetsMy++; }
                                        }
                                      });
                                      if (mSetsMy > mSetsOp) computedWins++;
                                    });
                                    
                                    // Подсчет G-/M+
                                    const playedPoints = pointsByRound.filter((v) => v !== null) as number[];
                                    const playedOppPoints = oppPointsByRound.filter((v) => v !== null) as number[];
                                    const playedCount = playedPoints.length;
                                    
                                    const countsAcrossGroup = (groupData.participants || []).map((pt: any) => {
                                      const pIds = new Set<number>();
                                      const gi2 = parseInt(String(groupIndex), 10);
                                      const e2 = (t.participants as any[] | undefined)?.find((e: any) => e.group_index === gi2 && e.row_index === pt.row_index);
                                      const t2: any = e2?.team || {};
                                      if (Array.isArray(t2.players)) {
                                        t2.players.forEach((pl: any) => {
                                          if (pl?.id != null) pIds.add(Number(pl.id));
                                        });
                                      } else {
                                        if (typeof t2.player_1 === 'object' && t2.player_1?.id != null) {
                                          pIds.add(Number(t2.player_1.id));
                                        } else if (typeof t2.player_1 === 'number') {
                                          pIds.add(Number(t2.player_1));
                                        }
                                        if (typeof t2.player_2 === 'object' && t2.player_2?.id != null) {
                                          pIds.add(Number(t2.player_2.id));
                                        } else if (typeof t2.player_2 === 'number') {
                                          pIds.add(Number(t2.player_2));
                                        }
                                      }
                                      let c = 0;
                                      scheduleRounds.forEach((r: any) => {
                                        const sms = r.matches || [];
                                        const has = sms.some((sm: any) => sm.team1_players?.some((p:any)=>pIds.has(Number(p.id))) || sm.team2_players?.some((p:any)=>pIds.has(Number(p.id))));
                                        if (has) c++;
                                      });
                                      return c;
                                    });
                                    const minMatches = Math.min(...countsAcrossGroup);
                                    const maxMatches = Math.max(...countsAcrossGroup);
                                    
                                    let gmDisplay = '—';
                                    let effectiveGamesSum = playedPoints.reduce((a,b)=>a+b, 0);
                                    let gamesDisplay: string | number = '';
                                    let gamesRatioDisplay: string | undefined = undefined;
                                    
                                    if (calculationMode === 'g_minus') {
                                      // Кол-во лишних матчей относительно минимального в группе
                                      const baseMatches = minMatches > 0 ? minMatches : playedCount;
                                      const extraMatches = Math.max(0, playedCount - baseMatches);
                                      const excessPoints = extraMatches > 0
                                        ? playedPoints.slice(-extraMatches).reduce((a, b) => a + b, 0)
                                        : 0;
                                      gmDisplay = `-${excessPoints}`; // всегда показываем -K, в т.ч. -0
                                      const mainCount = playedCount - extraMatches;
                                      effectiveGamesSum = playedPoints.slice(0, Math.max(0, mainCount)).reduce((a, b) => a + b, 0);
                                    } else if (calculationMode === 'm_plus') {
                                      const missing = Math.max(0, maxMatches - playedCount);
                                      const avg = playedCount > 0 ? Math.round(playedPoints.reduce((a,b)=>a+b, 0) / playedCount) : 0;
                                      const add = missing * avg;
                                      gmDisplay = `+${add}`; // всегда показываем +K, в т.ч. +0
                                      effectiveGamesSum = playedPoints.reduce((a,b)=>a+b, 0) + add;
                                      gamesRatioDisplay = '1';
                                      gamesDisplay = effectiveGamesSum;
                                    } else {
                                      gmDisplay = '—';
                                    }
                                    
                                    // Games и Ratio для NO и G-
                                    if (calculationMode !== 'm_plus') {
                                      const indices = pointsByRound.map((v, i) => v !== null ? i : -1).filter(i => i !== -1);
                                      const takeIndices = (calculationMode === 'g_minus') ? indices.slice(0, minMatches) : indices;
                                      const wonSum = takeIndices.reduce((acc, i) => acc + (pointsByRound[i] || 0), 0);
                                      const lostSum = takeIndices.reduce((acc, i) => acc + (oppPointsByRound[i] || 0), 0);
                                      gamesDisplay = `${wonSum}/${lostSum}`;
                                      const denom = wonSum + lostSum;
                                      gamesRatioDisplay = denom > 0 ? (wonSum / denom).toFixed(2) : '0.00';
                                    }
                                    
                                    // Сеты
                                    let setsRatioDisplay: string | number = `${computedSetsWon}/${computedSetsLost}`;
                                    let setsFractionDisplay: string = (computedSetsWon + computedSetsLost) > 0
                                      ? (computedSetsWon / (computedSetsWon + computedSetsLost)).toFixed(2)
                                      : '0.00';
                                    
                                    // Используем статистику с бэкенда, если доступна
                                    const rowStats = groupStats?.stats?.[participant.row_index] as any | undefined;
                                    const suffix = calculationMode === 'g_minus'
                                      ? '_g'
                                      : calculationMode === 'm_plus'
                                      ? '_m'
                                      : '';

                                    const winsKey = `wins${suffix}`;
                                    const setsWonKey = `sets_won${suffix}`;
                                    const setsLostKey = `sets_lost${suffix}`;
                                    const gamesWonKey = `games_won${suffix}`;
                                    const gamesLostKey = `games_lost${suffix}`;
                                    const gamesRatioKey = `games_ratio${suffix}`;
                                    const setsRatioKey = `sets_ratio_value${suffix}`;

                                    const finalWins: number = rowStats && winsKey in rowStats
                                      ? Number(rowStats[winsKey])
                                      : computedWins;

                                    const finalSetsWon: number = rowStats && setsWonKey in rowStats
                                      ? Number(rowStats[setsWonKey])
                                      : computedSetsWon;

                                    const finalSetsLost: number = rowStats && setsLostKey in rowStats
                                      ? Number(rowStats[setsLostKey])
                                      : computedSetsLost;

                                    const finalGamesWonRaw = rowStats && gamesWonKey in rowStats
                                      ? rowStats[gamesWonKey]
                                      : undefined;
                                    const finalGamesLostRaw = rowStats && gamesLostKey in rowStats
                                      ? rowStats[gamesLostKey]
                                      : undefined;

                                    const finalGamesWon: number | undefined =
                                      finalGamesWonRaw !== undefined ? Number(finalGamesWonRaw) : undefined;
                                    const finalGamesLost: number | undefined =
                                      finalGamesLostRaw !== undefined ? Number(finalGamesLostRaw) : undefined;

                                    const finalSetsRatioRaw = rowStats && setsRatioKey in rowStats
                                      ? rowStats[setsRatioKey]
                                      : undefined;
                                    const finalGamesRatioRaw = rowStats && gamesRatioKey in rowStats
                                      ? rowStats[gamesRatioKey]
                                      : undefined;

                                    const finalSetsRatio: number | undefined =
                                      finalSetsRatioRaw !== undefined ? Number(finalSetsRatioRaw) : undefined;
                                    const finalGamesRatio: number | undefined =
                                      finalGamesRatioRaw !== undefined ? Number(finalGamesRatioRaw) : undefined;
                                    
                                    // Форматирование для отображения
                                    const displaySetsRatio = `${finalSetsWon}/${finalSetsLost}`;
                                    const displaySetsFraction = (finalSetsWon + finalSetsLost) > 0
                                      ? (finalSetsRatio !== undefined ? finalSetsRatio.toFixed(2) : (finalSetsWon / (finalSetsWon + finalSetsLost)).toFixed(2))
                                      : '0.00';
                                    
                                    const displayGames = (finalGamesWon !== undefined && finalGamesLost !== undefined)
                                      ? `${Math.round(finalGamesWon)}/${Math.round(finalGamesLost)}`
                                      : gamesDisplay;
                                    
                                    const displayGamesRatio = finalGamesRatio !== undefined
                                      ? (calculationMode === 'm_plus' ? Math.round(finalGamesRatio).toString() : finalGamesRatio.toFixed(2))
                                      : gamesRatioDisplay;
                                    
                                    return (
                                      <>
                                        {scheduleRounds.map((round: any, idx: number) => {
                                          const matchesThisRound: any[] = (round.matches || []) as any[];
                                          const hasLiveHere = matchesThisRound.some((sm: any) => {
                                            if (sm.status !== 'live') return false;
                                            const pid = Number(participant.player_id);
                                            return (sm.team1_players || []).some((p: any) => Number(p.id) === pid) ||
                                                   (sm.team2_players || []).some((p: any) => Number(p.id) === pid);
                                          });

                                          if (hasLiveHere) {
                                            return (
                                              <td
                                                key={round.round}
                                                style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}
                                              >
                                                <span
                                                  style={{
                                                    display: 'inline-block',
                                                    width: 8,
                                                    height: 8,
                                                    borderRadius: '50%',
                                                    background: '#dc2626',
                                                  }}
                                                />
                                              </td>
                                            );
                                          }

                                          const val = pointsByRound[idx];
                                          if (val === null) {
                                            const isRest = !matchesThisRound.some((sm: any) =>
                                              (sm.team1_players || []).concat(sm.team2_players || []).some((p: any) => playerIds.has(Number(p.id)))
                                            );
                                            return (
                                              <td
                                                key={round.round}
                                                style={{
                                                  border: '1px solid #e7e7ea',
                                                  padding: '6px 8px',
                                                  textAlign: 'center',
                                                  background: isRest ? '#f1f5f9' : undefined,
                                                }}
                                              >
                                                —
                                              </td>
                                            );
                                          }
                                          return (
                                            <td
                                              key={round.round}
                                              style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center', fontWeight: 600 }}
                                            >
                                              {val}
                                            </td>
                                          );
                                        })}
                                        <td style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{gmDisplay}</td>
                                        <td className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{finalWins}</td>
                                        <td className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{displaySetsRatio}</td>
                                        <td className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{displaySetsFraction}</td>
                                        <td style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{displayGames}</td>
                                        <td className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{displayGamesRatio}</td>
                                        {(() => {
                                          const place = rankMap.get(Number(participant.row_index)) || 0;
                                          const roman = toRoman(place);
                                          return (
                                            <td style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center', fontWeight: 700 }}>{roman}</td>
                                          );
                                        })()}
                                      </>
                                    );
                                  })()}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Расписание игр */}
                      <div>
                        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: 12 }}>Расписание игр</h3>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          {/* Левая колонка: текстовое расписание A+B vs C+D */}
                          <div style={{ minWidth: 260 }}>
                            {(() => {
                              return (
                                <div className="flex flex-col gap-1">
                                  {(groupData.rounds || []).map((round: any) => (
                                    <div key={round.round} className="grid grid-cols-[auto_1fr] gap-x-8">
                                      {(round.matches || []).map((match: any, mi: number) => {
                                        const participantsList: any[] = groupData.participants || [];
                                        const toLetterByPlayerId = (playerId: number): string => {
                                          const pt = participantsList.find((p: any) => {
                                            const baseId = p.player_id;
                                            return baseId != null && Number(baseId) === Number(playerId);
                                          });
                                          if (!pt || pt.row_index == null) return '?';
                                          const rowIndex = Number(pt.row_index) || 0;
                                          // row_index в King начинается с 1, а буквы с A (0)
                                          return String.fromCharCode(65 + Math.max(0, rowIndex - 1));
                                        };

                                        const team1Players = match.team1_players || [];
                                        const team2Players = match.team2_players || [];
                                        const team1Letters = team1Players.map((p: any) => toLetterByPlayerId(p.id));
                                        const team2Letters = team2Players.map((p: any) => toLetterByPlayerId(p.id));

                                        const handleClick = () => {
                                          if (!canManageMatches) return;

                                          const team1Name = team1Players
                                            .map((p: any) => (showFullName ? p.name : p.display_name))
                                            .join(' + ');
                                          const team2Name = team2Players
                                            .map((p: any) => (showFullName ? p.name : p.display_name))
                                            .join(' + ');

                                          setScoreDialog({
                                            groupIndex: gi,
                                            matchId: match.id,
                                            status: match.status,
                                            team1: { id: team1Players[0]?.id || 0, name: team1Name },
                                            team2: { id: team2Players[0]?.id || 0, name: team2Name },
                                            existingSets: (match as any).sets || [],
                                          });
                                        };

                                        return (
                                          <React.Fragment key={match.id || mi}>
                                            <span className={mi === 0 ? 'font-medium' : 'opacity-0 select-none'}>{`Тур ${round.round}:`}</span>
                                            <span
                                              className="text-sm cursor-pointer hover:underline"
                                              onClick={handleClick}
                                            >
                                              <span
                                                style={{
                                                  display: 'inline-block',
                                                  background: match.status === 'live' ? '#e9fbe9' : 'transparent',
                                                  borderRadius: 4,
                                                  padding: '1px 4px',
                                                  textDecoration: match.status === 'completed' ? 'line-through' : 'none',
                                                }}
                                              >
                                                {team1Letters.join('+')} vs {team2Letters.join('+')}
                                              </span>
                                            </span>
                                          </React.Fragment>
                                        );
                                      })}
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>

                          {/* Правая колонка: плитки матчей */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 280, flex: 1 }}>
                            {groupData.rounds.map((round: any) => (
                              <div key={round.round} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {round.matches.map((match: any) => {
                                  const isLive = match.status === 'live';
                                  const team1Players = match.team1_players || [];
                                  const team2Players = match.team2_players || [];
                                  const team1Name = team1Players.map((p: any) => showFullName ? p.name : p.display_name).join(' + ');
                                  const team2Name = team2Players.map((p: any) => showFullName ? p.name : p.display_name).join(' + ');
                                  const canClick = !completed && canManageMatches;
                                  
                                  const handleTileClick = () => {
                                    if (!canClick) return;
                                    setScoreDialog({
                                      groupIndex: gi,
                                      matchId: match.id,
                                      status: match.status,
                                      team1: { id: team1Players[0]?.id || 0, name: team1Name },
                                      team2: { id: team2Players[0]?.id || 0, name: team2Name },
                                      existingSets: match.sets || [],
                                    });
                                  };

                                  return (
                                    <div
                                      key={match.id}
                                      style={{
                                        border: '1px solid #e7e7ea',
                                        padding: 12,
                                        borderRadius: 6,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 16,
                                        cursor: canClick ? 'pointer' : 'default',
                                        background: isLive ? '#e9fbe9' : 'transparent',
                                        transition: 'background 0.15s ease'
                                      }}
                                      onClick={handleTileClick}
                                    >
                                      <div style={{ flex: 1 }}>
                                        {team1Players.map((p: any, idx: number) => (
                                          <span key={p.id}>
                                            {idx > 0 && ' + '}
                                            {showFullName ? p.name : p.display_name}
                                          </span>
                                        ))}
                                        {(() => {
                                          const vals = team1Players
                                            .map((p: any) => playerRatings.get(Number(p.id)))
                                            .filter((v: unknown): v is number => typeof v === 'number');
                                          if (vals.length === 0) return null;
                                          const avg = Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length);
                                          return <div style={{ fontSize: 10, opacity: 0.75 }}>{avg} <span style={{ fontSize: 9 }}>BP</span></div>;
                                        })()}
                                      </div>
                                      <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {isLive && (
                                          <span
                                            style={{
                                              width: 8,
                                              height: 8,
                                              borderRadius: '50%',
                                              background: '#dc2626',
                                              display: 'inline-block',
                                            }}
                                          />
                                        )}
                                        <span>{isLive ? 'идёт' : (match.score || 'vs')}</span>
                                      </div>
                                      <div style={{ flex: 1 }}>
                                        {team2Players.map((p: any, idx: number) => (
                                          <span key={p.id}>
                                            {idx > 0 && ' + '}
                                            {showFullName ? p.name : p.display_name}
                                          </span>
                                        ))}
                                        {(() => {
                                          const vals = team2Players
                                            .map((p: any) => playerRatings.get(Number(p.id)))
                                            .filter((v: unknown): v is number => typeof v === 'number');
                                          if (vals.length === 0) return null;
                                          const avg = Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length);
                                          return <div style={{ fontSize: 10, opacity: 0.75 }}>{avg} <span style={{ fontSize: 9 }}>BP</span></div>;
                                        })()}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Кнопки в подвале */}
            <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }} data-export-exclude="true">
              {canManageTournament && t.status === 'active' && (
                <button className="btn" onClick={completeTournament} disabled={saving}>Завершить турнир</button>
              )}
              {(t as any).can_delete && (
                <button className="btn" onClick={deleteTournament} disabled={saving} style={{ background: '#dc3545', borderColor: '#dc3545' }}>Удалить турнир</button>
              )}
              {canManageTournament && t.status === 'active' && (
                <button
                  className="btn"
                  onClick={async () => {
                    if (!t) return;
                    try {
                      setSaving(true);
                      // Аналогично RR: возвращаем турнир в статус "Регистрация"
                      await tournamentApi.unlockParticipants(t.id);
                      await reload();
                    } catch (error: any) {
                      console.error('Failed to return tournament to registration status:', error);
                      alert(error?.response?.data?.error || 'Не удалось вернуть турнир в статус "Регистрация"');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                >
                  Вернуть статус "Регистрация"
                </button>
              )}
              {role !== 'REFEREE' && (
                <>
                  <button className="btn" onClick={handleShare}>Поделиться</button>
                  {t.status === 'completed' && (
                    <button
                      className="btn"
                      type="button"
                      disabled={loadingTextResults}
                      onClick={handleShowTextResults}
                    >
                      Результаты текстом
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div data-export-only="true" style={{ padding: '12px 24px 20px 24px', borderTop: '1px solid #eee', display: 'none', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 14 }}>BeachPlay.ru</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>всегда онлайн!</div>
        </div>
      </div>

      {canManageTournament && dragDropPickerOpen && (
        <KnockoutParticipantPicker
          open={true}
          onClose={() => setDragDropPickerOpen(false)}
          tournamentId={t.id}
          isDoubles={t.participant_mode === 'doubles'}
          usedPlayerIds={Array.from(distinctPlayerIds)}
          onSaved={() => {
            setDragDropPickerOpen(false);
            reload();
          }}
        />
      )}

      {schedulePatternModal && (
        <SchedulePatternModal
          isOpen={true}
          onClose={() => setSchedulePatternModal(null)}
          groupName={schedulePatternModal.groupName}
          participantsCount={schedulePatternModal.participantsCount}
          currentPatternId={schedulePatternModal.currentPatternId}
          tournamentId={t.id}
          tournamentSystem="king"
          onSuccess={async () => {
            await reload();
            setSchedulePatternModal(null);
          }}
        />
      )}

      {showInitialRatingModal && (
        <InitialRatingModal
          tournamentId={t.id}
          open={showInitialRatingModal}
          onClose={() => setShowInitialRatingModal(false)}
          onApplied={async () => {
            setShowInitialRatingModal(false);
            await reload();
          }}
        />
      )}

      {/* Диалог действий по матчу King (начать / ввести счёт) */}
      {scoreDialog && (
        <div
          onClick={() => setScoreDialog(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 8,
              boxShadow: '0 10px 30px rgba(15,23,42,0.25)',
              maxWidth: 360,
              width: '90%',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderBottom: '1px solid #eee',
              }}
            >
              <strong>{(() => {
                const status = scoreDialog.status;
                if (status === 'completed') return 'Матч завершен';
                if (status === 'live') return 'Матч идёт';
                return 'Матч не начат';
              })()}</strong>
              <button
                onClick={() => setScoreDialog(null)}
                style={{ border: 0, background: 'transparent', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, color: '#555' }}>
                Группа {scoreDialog.groupIndex}. {scoreDialog.team1.name} — {scoreDialog.team2.name}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {scoreDialog.status === 'scheduled' && (
                  <>
                    <button
                      onClick={startKingMatch}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 6,
                        background: '#28a745',
                        color: '#fff',
                        border: '1px solid #28a745',
                        cursor: 'pointer',
                      }}
                    >
                      Начать матч
                    </button>
                    <button
                      onClick={() => {
                        setScoreInput({
                          matchId: scoreDialog.matchId,
                          team1: scoreDialog.team1,
                          team2: scoreDialog.team2,
                          existingSets: scoreDialog.existingSets,
                        });
                        setScoreDialog(null);
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 6,
                        background: '#007bff',
                        color: '#fff',
                        border: '1px solid #007bff',
                        cursor: 'pointer',
                      }}
                    >
                      Ввести счёт
                    </button>
                  </>
                )}

                {scoreDialog.status === 'live' && (
                  <>
                    <button
                      onClick={cancelKingMatch}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 6,
                        background: '#dc3545',
                        color: '#fff',
                        border: '1px solid #dc3545',
                        cursor: 'pointer',
                      }}
                    >
                      Отменить матч
                    </button>
                    <button
                      onClick={() => {
                        setScoreInput({
                          matchId: scoreDialog.matchId,
                          team1: scoreDialog.team1,
                          team2: scoreDialog.team2,
                          existingSets: scoreDialog.existingSets,
                        });
                        setScoreDialog(null);
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 6,
                        background: '#007bff',
                        color: '#fff',
                        border: '1px solid #007bff',
                        cursor: 'pointer',
                      }}
                    >
                      Ввести счёт
                    </button>
                  </>
                )}

                {scoreDialog.status === 'completed' && (
                  <>
                    <button
                      onClick={() => {
                        setScoreInput({
                          matchId: scoreDialog.matchId,
                          team1: scoreDialog.team1,
                          team2: scoreDialog.team2,
                          existingSets: scoreDialog.existingSets,
                        });
                        setScoreDialog(null);
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 6,
                        background: '#007bff',
                        color: '#fff',
                        border: '1px solid #007bff',
                        cursor: 'pointer',
                      }}
                    >
                      Ввести счёт
                    </button>
                    <button
                      onClick={deleteKingMatch}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 6,
                        background: '#dc3545',
                        color: '#fff',
                        border: '1px solid #dc3545',
                        cursor: 'pointer',
                      }}
                    >
                      Удалить матч
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {scoreInput && t && (t as any)?.set_format?.games_to === 0 && (t as any)?.set_format?.max_sets !== 1 ? (
        <FreeFormatScoreModal
          match={{
            id: scoreInput.matchId,
            team_1: {
              id: scoreInput.team1.id,
              name: scoreInput.team1.name,
              display_name: scoreInput.team1.name,
            },
            team_2: {
              id: scoreInput.team2.id,
              name: scoreInput.team2.name,
              display_name: scoreInput.team2.name,
            },
            sets: scoreInput.existingSets || [],
          }}
          tournament={t}
          onClose={() => setScoreInput(null)}
          onSave={async (sets) => {
            if (!t || !scoreInput) return;
            await matchApi.saveFreeFormatScore(t.id, scoreInput.matchId, sets);
            setScoreInput(null);
            await reload();
            if (t.status === 'active' || t.status === 'completed') {
              const data = await tournamentApi.getKingSchedule(t.id);
              setKingSchedule(data);
            }
          }}
        />
      ) : null}

      {scoreInput && t && !((t as any)?.set_format?.games_to === 0 && (t as any)?.set_format?.max_sets !== 1) && (
        <MatchScoreModal
          isOpen={true}
          onClose={() => setScoreInput(null)}
          team1={scoreInput.team1}
          team2={scoreInput.team2}
          setFormat={(t as any)?.set_format}
          onSave={async () => {
            console.log('Simple save not implemented for King');
          }}
          onSaveFull={async (sets) => {
            if (!t || !scoreInput) return;
            await api.post(`/tournaments/${t.id}/match_save_score_full/`, {
              match_id: scoreInput.matchId,
              sets,
            });
            setScoreInput(null);
            await reload();
            // Перезагрузка расписания King
            if (t.status === 'active' || t.status === 'completed') {
              const data = await tournamentApi.getKingSchedule(t.id);
              setKingSchedule(data);
            }
          }}
        />
      )}

      {/* Дополнительный нижний блок действий больше не нужен, основной футер выше */}

      {showEditModal && t && (
        <EditTournamentModal
          tournament={t}
          setFormats={setFormats}
          rulesets={rrRulesets}
          onSubmit={handleEditSettingsSubmit}
          onClose={() => setShowEditModal(false)}
        />
      )}

      {showTextResultsModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowTextResultsModal(false)}
        >
          <div
            style={{
              backgroundColor: '#fff',
              padding: 20,
              maxWidth: 600,
              width: '100%',
              maxHeight: '80vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <textarea
              readOnly
              value={textResults}
              style={{ width: '100%', height: 260, resize: 'vertical', marginTop: 8, whiteSpace: 'pre' }}
            />
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" type="button" onClick={() => setShowTextResultsModal(false)}>
                Закрыть
              </button>
              <button className="btn" type="button" onClick={handleCopyTextResults} disabled={!textResults}>
                Копировать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
