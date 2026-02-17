import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { formatDate } from '../services/date';
import api, { matchApi, tournamentApi, Ruleset as ApiRuleset, ratingApi } from '../services/api';
import { getAccessToken } from '../services/auth';
import { useAuth } from '../context/AuthContext';
import { ParticipantPickerModal } from '../components/ParticipantPickerModal';
import { KnockoutParticipantPicker } from '../components/KnockoutParticipantPicker';
import { MatchScoreModal } from '../components/MatchScoreModal';
import FreeFormatScoreModal from '../components/FreeFormatScoreModal';
import SchedulePatternModal from '../components/SchedulePatternModal';
import { DraggableParticipantList } from '../components/DraggableParticipantList';
import { SimplifiedGroupTable, SimplifiedDropSlot } from '../components/SimplifiedGroupTable';
import { DraggableParticipant, DragDropState } from '../types/dragdrop';
import '../styles/knockout-dragdrop.css';
import html2canvas from 'html2canvas';
import { EditTournamentModal } from '../components/EditTournamentModal';
import { InitialRatingModal } from '../components/InitialRatingModal';
import { TournamentStageSelector, StageInfo } from '../components/TournamentStageSelector';
import { CreateStageModal } from '../components/CreateStageModal';
import { AddParticipantsFromStageModal } from '../components/AddParticipantsFromStageModal';
import { IncompleteMatchesModal } from '../components/IncompleteMatchesModal';

// Константы цветов для подсветки ячеек
const MATCH_COLORS = {
  LIVE: '#e9fbe9',      // Матч в процессе (чуть более насыщенный зеленый)
  WINNER: '#d1fae5',   // Победная ячейка (светло-зеленый, как в олимпийской системе)
} as const;

// Константы цветов для кнопок
const BUTTON_COLORS = {
  PRIMARY: '#007bff',   // Синий цвет для основных кнопок
  SUCCESS: '#28a745',   // Зеленый цвет для кнопки "Начать матч"
  DANGER: '#dc3545',    // Красный цвет для кнопки "Удалить матч"
} as const;

type Participant = {
  id: number;
  team?: { id: number; name: string; display_name?: string; full_name?: string; player_1?: number | { id: number }; player_2?: number | { id: number } } | null;
  group_index: number;
  row_index: number;
};

type MatchSetDTO = {
  index: number;
  games_1?: number;
  games_2?: number;
  tb_1?: number | null;
  tb_2?: number | null;
  is_tiebreak_only?: boolean;
};

type MatchDTO = {
  id: number;
  stage: string;
  group_index?: number | null;
  round_index?: number | null;
  round_name?: string | null;
  order_in_round?: number;
  status: string;
  team_1?: { id: number } | null;
  team_2?: { id: number } | null;
  winner?: number | { id: number } | null;
  sets?: MatchSetDTO[];
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
  matches?: MatchDTO[];
  organizer_name?: string;
  can_delete?: boolean;
  participants_count?: number;
  has_zero_rating_players?: boolean;
  parent_tournament?: number | null;
  stage_name?: string;
  stage_order?: number;
  stages_count?: number | null;
  is_master?: boolean;
  master_tournament_id?: number;
  is_rating_calc?: boolean;
};

type SetFormatDict = { id: number; name: string };
type RulesetDict = { id: number; name: string };

const toRoman = (num: number) => {
  const romans: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ];
  let n = num; let out = '';
  for (const [v, s] of romans) { while (n >= v) { out += s; n -= v; } }
  return out || '';
};

export const TournamentDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const idNum = id ? Number(id) : NaN;
  const role = user?.role;
  const canManageTournament = role === 'ADMIN' || role === 'ORGANIZER';
  const canManageMatches = canManageTournament || role === 'REFEREE';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [t, setT] = useState<TournamentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lockParticipants, setLockParticipants] = useState(false);
  const [showTech, setShowTech] = useState<boolean[]>([]); // по группам
  const [showFullName, setShowFullName] = useState(false);
  const showNamesInitializedRef = useRef(false);
  const [pickerOpen, setPickerOpen] = useState<null | { group: number; row: number }>(null);
  
  // Состояние для Drag & Drop (для статуса created)
  const [dragDropState, setDragDropState] = useState<DragDropState>({
    participants: [],
    dropSlots: [],
    isSelectionLocked: false
  });
  const [simplifiedDropSlots, setSimplifiedDropSlots] = useState<SimplifiedDropSlot[]>([]);
  const [dragDropPickerOpen, setDragDropPickerOpen] = useState(false);
  const [showTextResultsModal, setShowTextResultsModal] = useState(false);
  const [textResults, setTextResults] = useState<string>('');
  const [loadingTextResults, setLoadingTextResults] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [announcementText, setAnnouncementText] = useState<string>('');
  const [loadingAnnouncement, setLoadingAnnouncement] = useState(false);
  // Настройки авто-анонсов турнира
  const [showAnnouncementSettingsModal, setShowAnnouncementSettingsModal] = useState(false);
  const [announcementSettings, setAnnouncementSettings] = useState<{
    telegram_chat_id: string;
    announcement_mode: 'new_messages' | 'edit_single';
    send_on_creation: boolean;
    send_72h_before: boolean;
    send_48h_before: boolean;
    send_24h_before: boolean;
    send_2h_before: boolean;
    send_on_roster_change: boolean;
  } | null>(null);
  const [loadingAnnouncementSettings, setLoadingAnnouncementSettings] = useState(false);
  const [savingAnnouncementSettings, setSavingAnnouncementSettings] = useState(false);
  // Модалка действий по ячейке счёта
  const [scoreDialog, setScoreDialog] = useState<null | { group: number; a: number; b: number; matchId?: number; isLive: boolean; matchTeam1Id?: number | null; matchTeam2Id?: number | null }>(null);
  // Модалка ввода счёта (унифицированная с олимпийкой)
  const [scoreInput, setScoreInput] = useState<null | {
    matchId: number;
    team1: { id: number; name: string };
    team2: { id: number; name: string };
    matchTeam1Id?: number | null;
    matchTeam2Id?: number | null;
    existingSets?: any[];
  }>(null);
  // Расписание по группам: { [groupIndex]: [ [a,b], [c,d] ][] } — туры, каждый тур: массив пар [a,b]
  const [schedule, setSchedule] = useState<Record<number, [number, number][][]>>({});
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const canDeleteTournament = !!t?.can_delete;
  const [showEditModal, setShowEditModal] = useState(false);
  const [setFormats, setSetFormats] = useState<SetFormatDict[]>([]);
  const [showInitialRatingModal, setShowInitialRatingModal] = useState(false);
  const [showCompleteRatingChoice, setShowCompleteRatingChoice] = useState(false);
  const [showIncompleteMatchesModal, setShowIncompleteMatchesModal] = useState(false);
  const [incompleteMatches, setIncompleteMatches] = useState<any[]>([]);
  // Многостадийные турниры
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [currentStageId, setCurrentStageId] = useState<number | null>(null);
  const [masterSystem, setMasterSystem] = useState<'round_robin' | 'knockout' | 'king' | null>(null);
  const [canAddStage, setCanAddStage] = useState(false);
  const [showCreateStageModal, setShowCreateStageModal] = useState(false);
  const [showAddFromStageModal, setShowAddFromStageModal] = useState(false);
  
  const handleRollbackTournamentCompletion = async () => {
    if (!t || role !== 'ADMIN') return;
    const confirmed = window.confirm('Откатить завершение турнира? Рейтинги за этот турнир будут отменены, статус станет "Активен".');
    if (!confirmed) return;
    try {
      setSaving(true);
      await tournamentApi.rollbackComplete(t.id);
      alert('Завершение турнира откатано, статус снова "Активен".');
      window.location.href = `/tournaments/${t.id}`;
    } catch (e: any) {
      console.error('Failed to rollback tournament completion', e);
      alert(e?.response?.data?.error || 'Не удалось откатить завершение турнира');
    } finally {
      setSaving(false);
    }
  };

  const handleStageChanged = (stageId: number) => {
    if (!stageId || Number.isNaN(stageId) || stageId === idNum) return;
    nav(`/tournaments/${stageId}`);
  };

  const handleDeleteStage = async (stageId: number) => {
    if (!stageId) return;
    if (!window.confirm('Удалить эту стадию?')) return;
    try {
      setSaving(true);
      const res = await tournamentApi.deleteStage(stageId);
      if (!res.ok) {
        window.alert(res.error || 'Не удалось удалить стадию');
      }
      // Если удаляем текущую стадию — переходим на мастер-турнир
      const masterId = (t as any)?.master_tournament_id || t?.id || stageId;
      if (stageId === idNum && masterId && masterId !== stageId) {
        nav(`/tournaments/${masterId}`);
        return;
      }
      await reload();
    } catch (e: any) {
      console.error('Failed to delete stage', e);
      window.alert(e?.response?.data?.error || 'Не удалось удалить стадию');
    } finally {
      setSaving(false);
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
      const updated = await tournamentApi.editSettings(t.id, payload);
      setShowEditModal(false);
      // Полный редирект в зависимости от системы, чтобы страница перечитала данные с бэка
      if (updated.system === 'round_robin') {
        window.location.href = `/tournaments/${updated.id}`;
      } else if (updated.system === 'knockout') {
        window.location.href = `/tournaments/${updated.id}/knockout`;
      } else {
        window.location.href = `/tournaments/${updated.id}`;
      }
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Не удалось изменить настройки турнира');
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteTournamentClick = async () => {
    if (!t) return;
    
    // Проверяем незавершенные матчи во всех стадиях
    try {
      const response = await api.get(`/tournaments/${t.id}/check_incomplete_matches/`);
      const data = response.data;
      
      // Проверяем наличие стадий в статусе created
      if (!data.ok && data.error === 'created_stages') {
        alert(data.message);
        return;
      }
      
      // Если есть незавершенные матчи - показываем модалку с подтверждением
      if (data.ok && data.count > 0) {
        setIncompleteMatches(data.incomplete_matches);
        setShowIncompleteMatchesModal(true);
        return;
      }
      
      // Все матчи завершены - показываем простое подтверждение
      if (data.ok && data.count === 0) {
        const confirmed = window.confirm('Завершить турнир?');
        if (!confirmed) return;
      }
    } catch (e: any) {
      console.error('Failed to check incomplete matches', e);
      // Если проверка не удалась, показываем простое подтверждение
      const confirmed = window.confirm('Завершить турнир?');
      if (!confirmed) return;
    }
    
    // Если в турнире есть игроки без рейтинга, сначала показываем диалог выбора способа завершения
    if (t.has_zero_rating_players) {
      setShowCompleteRatingChoice(true);
      return;
    }
    // Иначе сразу запускаем процедуру завершения турнира
    completeTournament();
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

  const handleShowAnnouncementText = async () => {
    if (!t) return;
    try {
      setLoadingAnnouncement(true);
      const res = await tournamentApi.getAnnouncementText(t.id);
      setAnnouncementText(res?.text || '');
      setShowAnnouncementModal(true);
    } catch (e) {
      console.error('Failed to load announcement text', e);
      alert('Не удалось загрузить текст анонса');
    } finally {
      setLoadingAnnouncement(false);
    }
  };

  const handleOpenAnnouncementSettings = async () => {
    if (!t || !canManageTournament || t.status !== 'created') return;
    try {
      setLoadingAnnouncementSettings(true);
      const data = await tournamentApi.getAnnouncementSettings(t.id);
      setAnnouncementSettings({ ...data });
      setShowAnnouncementSettingsModal(true);
    } catch (e: any) {
      console.error('Failed to load announcement settings', e);
      alert(e?.response?.data?.detail || 'Не удалось загрузить настройки авто-анонсов');
    } finally {
      setLoadingAnnouncementSettings(false);
    }
  };

  const handleSaveAnnouncementSettings = async () => {
    if (!t || !announcementSettings) return;
    try {
      setSavingAnnouncementSettings(true);
      const payload = { ...announcementSettings };
      const updated = await tournamentApi.updateAnnouncementSettings(t.id, payload);
      setAnnouncementSettings({ ...updated });
      setShowAnnouncementSettingsModal(false);
    } catch (e: any) {
      console.error('Failed to save announcement settings', e);
      const detail = e?.response?.data?.detail || e?.message || 'Не удалось сохранить настройки авто-анонсов';
      alert(detail);
    } finally {
      setSavingAnnouncementSettings(false);
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

  const handleCopyAnnouncementText = async () => {
    try {
      if (!announcementText) return;
      // Преобразуем markdown-ссылки [текст](url) в обычные URL для Telegram
      const plainText = announcementText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$2');
      
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(plainText);
        alert('Текст анонса скопирован в буфер обмена');
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = plainText;
        textarea.style.position = 'fixed';
        textarea.style.left = '-1000px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        alert('Текст анонса скопирован в буфер обмена');
      }
    } catch (e) {
      console.error('Copy failed', e);
      alert('Не удалось скопировать текст анонса');
    }
  };

  // Функция для преобразования текста со ссылками в JSX с кликабельными ссылками
  // Поддерживает markdown-формат [текст](url) и обычные URL
  const loadMasterData = useCallback(async () => {
    if (!idNum || Number.isNaN(idNum)) return;
    try {
      const data = await tournamentApi.getMasterData(idNum);
      const mapped: StageInfo[] = (data.stages || []).map((s: any) => ({
        id: s.id,
        stage_name: s.stage_name,
        stage_order: s.stage_order,
        system: s.system,
        status: s.status,
        can_delete: s.can_delete,
        can_edit: s.can_edit,
        is_current: s.id === idNum,
      }));
      // Всегда показываем все стадии, независимо от прав доступа
      // Права доступа используются только для кнопок редактирования/удаления
      setStages(mapped);
      setCurrentStageId(idNum);
      setMasterSystem(data.master.system as any);
      setCanAddStage(data.can_add_stage ?? true);
    } catch (e) {
      console.warn('Failed to load master data', e);
    }
  }, [idNum, canManageTournament]);

  const renderAnnouncementWithLinks = (text: string) => {
    if (!text) return null;
    const lines = text.split('\n');
    return (
      <>
        {lines.map((line, idx) => {
          // Обрабатываем markdown-ссылки [текст](url)
          const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
          const parts: Array<{ type: 'text' | 'link'; content: string; url?: string }> = [];
          let lastIndex = 0;
          let match;

          while ((match = markdownLinkRegex.exec(line)) !== null) {
            // Добавляем текст до ссылки
            if (match.index > lastIndex) {
              parts.push({ type: 'text', content: line.substring(lastIndex, match.index) });
            }
            // Добавляем ссылку
            parts.push({ type: 'link', content: match[1], url: match[2] });
            lastIndex = match.index + match[0].length;
          }

          // Добавляем оставшийся текст
          if (lastIndex < line.length) {
            parts.push({ type: 'text', content: line.substring(lastIndex) });
          }

          // Если не было markdown-ссылок, обрабатываем обычные URL
          if (parts.length === 0) {
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const urlParts = line.split(urlRegex);
            return (
              <div key={idx}>
                {urlParts.map((part, i) => {
                  if (part.match(urlRegex)) {
                    return (
                      <a
                        key={i}
                        href={part}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#007bff', textDecoration: 'underline' }}
                      >
                        {part}
                      </a>
                    );
                  }
                  return <span key={i}>{part}</span>;
                })}
              </div>
            );
          }

          // Рендерим части с markdown-ссылками
          return (
            <div key={idx}>
              {parts.map((part, i) => {
                if (part.type === 'link') {
                  return (
                    <a
                      key={i}
                      href={part.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#007bff', textDecoration: 'underline' }}
                    >
                      {part.content}
                    </a>
                  );
                }
                return <span key={i}>{part.content}</span>;
              })}
            </div>
          );
        })}
      </>
    );
  };

  // Универсальный поиск матча по паре ID команд в группе: учитывает разные формы сериализации
  const findGroupMatch = useCallback((groupIdx: number, teamAId?: number | null, teamBId?: number | null) => {
    if (!t || !teamAId || !teamBId) return undefined as any;
    const roundName = `Группа ${groupIdx}`;
    const matches = (t.matches || []);
    const sameTeams = (mm: any, a: number, b: number) => {
      const raw1 = (mm.team_1 && typeof mm.team_1 === 'object') ? mm.team_1.id : (mm.team_1_id ?? null);
      const raw2 = (mm.team_2 && typeof mm.team_2 === 'object') ? mm.team_2.id : (mm.team_2_id ?? null);
      const t1 = raw1 != null ? Number(raw1) : null;
      const t2 = raw2 != null ? Number(raw2) : null;
      const A = a != null ? Number(a) : null;
      const B = b != null ? Number(b) : null;
      return (t1 === A && t2 === B) || (t1 === B && t2 === A);
    };

    // Сначала ищем строго по группе
    const byGroup = matches.find((mm: any) => {
      const stage = (mm.stage || '').toString().toLowerCase();
      const inGroup = (mm.group_index === groupIdx) || (mm.round_name === roundName) || (mm.round_name === String(roundName));
      return stage === 'group' && inGroup && sameTeams(mm, teamAId, teamBId);
    });
    if (byGroup) return byGroup;
    // Фолбэк 1: если сериализатор не отдал group_index/round_name — ищем только по stage и парам
    const byStageOnly = matches.find((mm: any) => {
      const stage = (mm.stage || '').toString().toLowerCase();
      return stage === 'group' && sameTeams(mm, teamAId, teamBId);
    });
    if (byStageOnly) return byStageOnly;
    // Фолбэк 2: ищем по парам без каких-либо доп. условий (на случай нераскрытого stage)
    return matches.find((mm: any) => sameTeams(mm, teamAId, teamBId));
  }, [t]);

  const fetchGroupSchedule = useCallback(async (tournamentId?: string | number) => {
    const tid = tournamentId ?? id;
    if (!tid) return;
    try {
      const { data } = await api.get(`/tournaments/${tid}/group_schedule/`);
      if (data && data.ok && data.groups) {
        const mapped: Record<number, [number, number][][]> = {};
        for (const [key, rounds] of Object.entries<any>(data.groups)) {
          mapped[Number(key)] = rounds as [number, number][][];
        }
        setSchedule(mapped);
        setScheduleLoaded(true);
      }
    } catch (e) {
      console.error('Не удалось загрузить расписание групп:', e);
    }
  }, [id]);

  // Карта рейтингов игроков: playerId -> рейтинг (current или rating_before)
  const [playerRatings, setPlayerRatings] = useState<Map<number, number>>(new Map());
  // Карта позиций игроков в рейтинге: playerId -> rank (место в рейтинге)
  const [playerRanks, setPlayerRanks] = useState<Map<number, number>>(new Map());

  // Справочники для модалки редактирования (форматы сетов)
  useEffect(() => {
    const loadDictionaries = async () => {
      try {
        const resp = await api.get('/set-formats/');
        setSetFormats(resp.data.set_formats || []);
      } catch (e) {
        console.error('Ошибка загрузки форматов сетов:', e);
        setSetFormats([]);
      }
    };
    loadDictionaries();
  }, []);

  // Загрузка рейтингов всех игроков, участвующих в турнире
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
        if (ids.size === 0) { setPlayerRatings(new Map()); setPlayerRanks(new Map()); return; }
        const idArray = Array.from(ids);

        // Для завершённых турниров используем рейтинг ДО турнира (rating_before)
        if (t.status === 'completed') {
          const map = new Map<number, number>();

          // Сначала пытаемся получить rating_before по каждому игроку
          await Promise.all(idArray.map(async (pid) => {
            try {
              const hist = await ratingApi.playerHistory(pid);
              const rows = hist?.history || [];
              const row = rows.find((r: any) => r.tournament_id === t.id && typeof r.rating_before === 'number');
              if (row) {
                map.set(pid, row.rating_before);
              }
            } catch {
              // Игнорируем ошибки по отдельным игрокам, fallback сделаем ниже
            }
          }));

          // Для тех, у кого нет rating_before, добираем current_rating как раньше
          const missing = idArray.filter(pid => !map.has(pid));
          if (missing.length > 0) {
            try {
              const respBriefs = await ratingApi.playerBriefs(missing);
              for (const it of (respBriefs.results || [])) {
                if (typeof it.id === 'number' && typeof it.current_rating === 'number' && !map.has(it.id)) {
                  map.set(it.id, it.current_rating);
                }
              }
            } catch {
              // Если briefs не доступны, просто оставляем то, что удалось получить
            }
          }

          // Вычисляем позиции в рейтинге по значениям map (чем больше рейтинг, тем выше позиция)
          const ranks = new Map<number, number>();
          const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
          sorted.forEach(([pid], idx) => {
            ranks.set(pid, idx + 1);
          });

          setPlayerRatings(map);
          setPlayerRanks(ranks);
        } else {
          // Для незавершённых турниров используем текущий рейтинг и глобальную позицию из briefs
          const resp = await ratingApi.playerBriefs(idArray);
          const map = new Map<number, number>();
          const ranks = new Map<number, number>();
          for (const it of (resp.results || [])) {
            if (typeof it.id === 'number') {
              if (typeof it.current_rating === 'number') {
                map.set(it.id, it.current_rating);
              }
              if (typeof it.rank === 'number') {
                ranks.set(it.id, it.rank);
              }
            }
          }

          setPlayerRatings(map);
          setPlayerRanks(ranks);
        }
      } catch {
        setPlayerRatings(new Map());
        setPlayerRanks(new Map());
      }
    };
    loadRatings();
  }, [t]);
  // Данные групп с бэкенда: { [group_index]: { stats: { [team_id]: {...} }, placements: { [team_id]: place } } }
  const [groupStats, setGroupStats] = useState<Record<number, { stats: Record<number, { wins: number; sets_won: number; sets_lost: number; sets_drawn?: number; games_won: number; games_lost: number }>; placements: Record<number, number> }>>({});
  const exportRef = useRef<HTMLDivElement | null>(null);
  // Состояние для hover эффекта на расписании
  const [hoveredMatch, setHoveredMatch] = useState<{ groupIdx: number; row1: number; row2: number } | null>(null);
  // Модальное окно выбора формата расписания
  const [schedulePatternModal, setSchedulePatternModal] = useState<{ groupName: string; participantsCount: number; currentPatternId?: number | null } | null>(null);
  // Регламенты для круговой системы
  const [rrRulesets, setRrRulesets] = useState<ApiRuleset[]>([]);
  const [savingRrRuleset, setSavingRrRuleset] = useState(false);
  // Тултип с пояснением, почему победы не считаются в свободном формате
  const winsTipRef = useRef<HTMLDivElement | null>(null);
  const [showWinsTip, setShowWinsTip] = useState(false);

  // Динамическая загрузка html2canvas с CDN
  const ensureHtml2Canvas = async (): Promise<any> => {
    const w = window as any;
    if (w.html2canvas) return w.html2canvas;
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Не удалось загрузить html2canvas'));
      document.head.appendChild(s);
    });
    return (window as any).html2canvas;
  };

  // Явное обновление агрегатов групп с бэка
  const refreshGroupStats = async () => {
    if (!id) return;
    try {
      const { data } = await api.get(`/tournaments/${id}/group_stats/`);
      setGroupStats(data?.groups || {});
    } catch (e) {
      console.warn('Не удалось загрузить агрегаты групп:', e);
    }
  };

  const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось загрузить изображение'));
    img.src = src;
  });

  const handleShare = async () => {
    try {
      const html2canvas = await ensureHtml2Canvas();
      const container = exportRef.current;
      if (!container) return;
      // Временно скрываем элементы, которые не должны попадать в выгрузку
      const excluded = Array.from(document.querySelectorAll('[data-export-exclude="true"]')) as HTMLElement[];
      const prev: string[] = excluded.map(el => el.style.display);
      excluded.forEach(el => el.style.display = 'none');
      // Показать элементы только для экспорта (футер с надписями)
      const exportOnly = Array.from(document.querySelectorAll('[data-export-only="true"]')) as HTMLElement[];
      const prevOnly: string[] = exportOnly.map(el => el.style.display);
      exportOnly.forEach(el => el.style.display = 'flex');
      try {
        const canvas: HTMLCanvasElement = await html2canvas(container, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          windowWidth: container.scrollWidth,
        });
        // Добавим плашку внизу с брендингом
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const W = canvas.width; const H = canvas.height;
          const barH = Math.round(80 * (window.devicePixelRatio || 2));
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, H - barH, W, barH);
          // Бренд‑плашку больше не дорисовываем на canvas — используем DOM‑футер в exportRef
        }
        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `beachplay_tournament_${t?.id || 'export'}.png`;
        document.body.appendChild(a); a.click(); a.remove();
      } finally {
        // Вернём видимость
        excluded.forEach((el, i) => el.style.display = prev[i]);
        const exportOnly = Array.from(document.querySelectorAll('[data-export-only="true"]')) as HTMLElement[];
        exportOnly.forEach((el, i) => (el.style.display = prevOnly[i]));
      }
    } catch (e) {
      alert('Не удалось подготовить изображение для поделиться');
    }
  };

  const reload = async (): Promise<boolean> => {
    try {
      setLoading(true);
      setError(null);
      const { data } = await api.get(`/tournaments/${id}/`);

      // Для турниров в статусе created отправляем на страницу регистрации,
      // если пользователь не является организатором или администратором.
      // Важно: не делаем этот редирект, пока AuthContext ещё загружается,
      // чтобы после создания турнира организатор не попадал на страницу регистрации.
      const role = user?.role;
      const isOrganizerOrAdmin = role === 'ADMIN' || role === 'ORGANIZER';
      if (!authLoading && data.status === 'created' && !isOrganizerOrAdmin) {
        nav(`/tournaments/${id}/registration`);
        return false;
      }

      // Редирект на правильную страницу в зависимости от системы турнира
      if (data.system === 'king') {
        nav(`/tournaments/${id}/king`);
        return false;
      }
      if (data.system === 'knockout') {
        nav(`/tournaments/${id}/knockout`);
        return false;
      }
      
      setT(data);
      setShowTech(Array.from({ length: data.groups_count || 1 }).map(() => false));
      
      // Загрузить данные стадий для многостадийных турниров
      loadMasterData();
      
      // Инициализировать режим отображения имён один раз: по умолчанию ФИО,
      // исключение — турниры организатора ArtemPara (display_name по умолчанию)
      if (!showNamesInitializedRef.current) {
        const organizerUsername = (data as any).organizer_username;
        const useDisplayName = organizerUsername === 'ArtemPara';
        setShowFullName(!useDisplayName);
        showNamesInitializedRef.current = true;
      }
      
      // Определить состояние фиксации на основе статуса турнира
      if (data.status === 'active') {
        setLockParticipants(true);
      } else {
        setLockParticipants(false);
      }
      
      // Загрузить участников для drag-and-drop если статус created
      if (data.status === 'created') {
        loadParticipantsForDragDrop(data);
      }
      
      return true;
    } catch (e: any) {
      const status = e?.response?.status;
      if (!user && status === 403) {
        setError('Завершённые турниры доступны только зарегистрированным пользователям. Пожалуйста, войдите в систему.');
      } else {
        console.error('Ошибка загрузки турнира:', e);
        setError(e?.response?.data?.error || 'Ошибка загрузки турнира');
      }
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Загрузка участников для drag-and-drop (статус created)
  const loadParticipantsForDragDrop = async (tournamentData: TournamentDetail) => {
    const groupsCount = tournamentData.groups_count || 1;
    const totalParticipants = tournamentData.planned_participants || 0;
    
    // Вычисляем размер каждой группы индивидуально
    const getGroupSize = (groupIndex: number) => {
      const base = Math.floor(totalParticipants / groupsCount);
      const remainder = totalParticipants % groupsCount;
      // Первые remainder групп получают +1 участника
      return groupIndex < remainder ? base + 1 : base;
    };
    
    // Создаем drop slots для каждой группы и позиции
    const slots: SimplifiedDropSlot[] = [];
    const participantsInSlots = new Set<number>();
    
    for (let gi = 0; gi < groupsCount; gi++) {
      const groupSize = getGroupSize(gi);
      for (let ri = 0; ri < groupSize; ri++) {
        // Ищем участника с конкретной позицией (group_index и row_index должны быть не null)
        // row_index в БД начинается с 1, а ri с 0, поэтому ri + 1
        const participant = tournamentData.participants.find(
          p => p.group_index === gi + 1 && p.row_index === ri + 1 && p.group_index != null && p.row_index != null
        );
        
        if (participant?.team) {
          participantsInSlots.add(participant.id);
        }
        
        // Вычисляем рейтинг
        let rating: number | undefined = undefined;
        if (participant?.team) {
          const team: any = participant.team as any;
          if (tournamentData.participant_mode === 'doubles' && team.player_1 && team.player_2) {
            // Для пар - средний рейтинг игроков
            const r1 = team.player_1?.current_rating || 0;
            const r2 = team.player_2?.current_rating || 0;
            rating = r1 > 0 || r2 > 0 ? Math.round((r1 + r2) / 2) : undefined;
          } else if (tournamentData.participant_mode === 'singles' && team.player_1) {
            rating = typeof team.player_1 === 'object' ? team.player_1.current_rating : undefined;
          }
        }
        
        slots.push({
          groupIndex: gi,
          rowIndex: ri,
          currentParticipant: participant?.team ? {
            id: participant.id, // TournamentEntry.id
            name: participant.team.display_name || participant.team.name,
            fullName: participant.team.full_name,
            teamId: participant.team.id,
            isInBracket: true,
            currentRating: rating
          } : null
        });
      }
    }
    
    setSimplifiedDropSlots(slots);
    
    // Загружаем всех участников турнира через существующий endpoint
    try {
      const participantsResp = await tournamentApi.getTournamentParticipants(tournamentData.id);
      
      // Маппим участников с учетом list_status
      const allParticipants: DraggableParticipant[] = participantsResp
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          fullName: p.name, // В get_participants уже возвращается полное имя
          teamId: p.team_id,
          isInBracket: participantsInSlots.has(p.id), // Флаг: участник в таблице или нет
          currentRating: typeof p.rating === 'number' ? p.rating : undefined,
          listStatus: p.list_status || 'main', // Статус списка: main или reserve
          registrationOrder: p.registration_order // Порядок регистрации для сортировки резерва
        }));
      
      // Разделяем на основной и резервный списки
      const mainParticipants = allParticipants.filter(p => p.listStatus === 'main');
      const reserveParticipants = allParticipants.filter(p => p.listStatus === 'reserve');
      
      setDragDropState({
        participants: allParticipants, // Сохраняем все для обратной совместимости
        mainParticipants: mainParticipants,
        reserveParticipants: reserveParticipants,
        dropSlots: [],
        isSelectionLocked: tournamentData.status !== 'created'
      });
    } catch (error) {
      console.error('Failed to load tournament entries:', error);
      setDragDropState({
        participants: [],
        mainParticipants: [],
        reserveParticipants: [],
        dropSlots: [],
        isSelectionLocked: tournamentData.status !== 'created'
      });
    }
  };

  // Обработчик добавления участника на позицию
  const handleDropParticipant = async (groupIndex: number, rowIndex: number, participant: DraggableParticipant) => {
    if (!t) return;
    
    // Проверка занятости слота
    const targetSlot = simplifiedDropSlots.find(
      s => s.groupIndex === groupIndex && s.rowIndex === rowIndex
    );
    if (targetSlot?.currentParticipant) {
      alert('Этот слот уже занят. Сначала удалите текущего участника.');
      return;
    }
    
    // Проверка дубликатов - участник уже в таблице
    const alreadyInTable = simplifiedDropSlots.some(
      s => s.currentParticipant?.id === participant.id
    );
    if (alreadyInTable) {
      alert('Этот участник уже находится в таблице.');
      return;
    }
    
    try {
      // Оптимистичное обновление UI - сохраняем рейтинг участника
      setSimplifiedDropSlots(prev => prev.map(slot => {
        if (slot.groupIndex === groupIndex && slot.rowIndex === rowIndex) {
          return { 
            ...slot, 
            currentParticipant: { 
              ...participant, 
              isInBracket: true,
              currentRating: participant.currentRating // Явно сохраняем рейтинг
            } 
          };
        }
        return slot;
      }));
      
      setDragDropState(prev => ({
        ...prev,
        participants: prev.participants.map(p => ({
          ...p,
          isInBracket: p.id === participant.id ? true : p.isInBracket
        }))
      }));
      
      // API вызов для установки позиции участника
      await api.post(`/tournaments/${t.id}/set_participant_position/`, {
        entry_id: participant.id, // TournamentEntry.id
        group_index: groupIndex + 1, // Backend использует 1-based индексацию
        row_index: rowIndex + 1 // Backend использует 1-based индексацию (1, 2, 3...)
      });
      
      // Перезагружаем данные турнира
      await reload();
    } catch (error) {
      console.error('Error adding participant to position:', error);
      alert('Не удалось добавить участника на позицию');
      
      // Откат изменений
      setSimplifiedDropSlots(prev => prev.map(slot => {
        if (slot.groupIndex === groupIndex && slot.rowIndex === rowIndex) {
          return { ...slot, currentParticipant: null };
        }
        return slot;
      }));
      
      setDragDropState(prev => ({
        ...prev,
        participants: prev.participants.map(p => ({
          ...p,
          isInBracket: p.id === participant.id ? false : p.isInBracket
        }))
      }));
    }
  };

  // Обработчик удаления участника с позиции
  const handleRemoveParticipant = async (groupIndex: number, rowIndex: number) => {
    if (!t) return;
    
    const slot = simplifiedDropSlots.find(s => s.groupIndex === groupIndex && s.rowIndex === rowIndex);
    if (!slot?.currentParticipant) return;
    
    if (!confirm(`Удалить ${slot.currentParticipant.name} из группы?`)) return;
    
    try {
      const participantToRemove = slot.currentParticipant;
      
      // API вызов для очистки позиции участника
      await api.post(`/tournaments/${t.id}/clear_participant_position/`, {
        entry_id: participantToRemove.id
      });
      
      // Перезагружаем данные турнира
      await reload();
    } catch (error) {
      console.error('Error removing participant from position:', error);
      alert('Не удалось удалить участника с позиции');
    }
  };

  // Автопосев участников
  const handleAutoSeed = async () => {
    if (!t) return;
    
    if (!confirm('Автоматически распределить участников по группам с учетом рейтинга?')) return;
    
    try {
      setSaving(true);
      
      // API вызов для автопосева
      const { data } = await api.post(`/tournaments/${t.id}/auto_seed/`);
      
      if (data.ok) {
        alert(`Успешно распределено участников: ${data.seeded_count}`);
        // Перезагружаем данные турнира
        await reload();
      } else {
        alert(data.error || 'Не удалось выполнить автопосев');
      }
    } catch (error: any) {
      console.error('Error auto-seeding:', error);
      const errorMsg = error?.response?.data?.error || 'Не удалось выполнить автопосев';
      alert(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  // Обработчик очистки таблиц
  const handleClearTables = async () => {
    if (!t) return;
    
    if (!confirm('Очистить все таблицы? Все участники вернутся в список слева.')) return;
    
    try {
      setSaving(true);
      
      // API вызов для очистки таблиц
      const { data } = await api.post(`/tournaments/${t.id}/clear_tables/`);
      
      if (data.ok) {
        alert(`Таблицы очищены. Участников перемещено: ${data.cleared_count}`);
        // Перезагружаем данные турнира
        await reload();
      } else {
        alert(data.error || 'Не удалось очистить таблицы');
      }
    } catch (error: any) {
      console.error('Error clearing tables:', error);
      const errorMsg = error?.response?.data?.error || 'Не удалось очистить таблицы';
      alert(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  // Обработчик сохранения участников из предыдущей стадии
  const handleSaveParticipantsFromStage = async (selectedTeamIds: number[]) => {
    if (!t) return;
    
    try {
      // Получаем текущие team_id участников
      const currentTeamIds = (t.participants || [])
        .map(p => p.team?.id)
        .filter((id): id is number => id !== undefined);
      
      // Определяем, кого нужно добавить и кого удалить
      const toAdd = selectedTeamIds.filter(id => !currentTeamIds.includes(id));
      const toRemove = currentTeamIds.filter(id => !selectedTeamIds.includes(id));
      
      // Удаляем участников
      for (const teamId of toRemove) {
        const entry = t.participants?.find(p => p.team?.id === teamId);
        if (entry) {
          // Используем тот же endpoint, что и в handleRemoveParticipantFromList
          await api.delete(`/tournaments/${t.id}/remove_participant/`, {
            data: { entry_id: entry.id },
          });
        }
      }
      
      // Добавляем участников
      for (const teamId of toAdd) {
        // Добавляем существующую команду из предыдущей стадии по team_id
        await api.post(`/tournaments/${t.id}/add_participant/`, {
          team_id: teamId,
        });
      }
      
      // Перезагружаем данные
      await reload();
    } catch (e: any) {
      console.error('Failed to update participants', e);
      window.alert(e?.response?.data?.error || 'Не удалось обновить участников');
    }
  };

  // Обработчик удаления участника из турнира (из левого списка)
  const handleRemoveParticipantFromList = async (participantId: number) => {
    if (!t) return;
    
    try {
      // Удалить из БД
      await api.delete(`/tournaments/${t.id}/remove_participant/`, {
        data: { entry_id: participantId }
      });
      
      // Обновить UI
      setDragDropState(prev => ({
        ...prev,
        participants: prev.participants.filter(p => p.id !== participantId)
      }));
      
      // Перезагрузить данные
      await reload();
    } catch (error) {
      console.error('Error removing participant from tournament:', error);
      alert('Не удалось удалить участника из турнира');
    }
  };

  // Собираем пары чисел (left,right) для ячейки по той же логике ориентации, что и рендер
  const getCellPairs = (
    g: { idx: number; entries: (Participant | null)[]; cols: number[] },
    rIdx: number,
    cIdx: number,
    rI: number
  ): { left: number; right: number; tbOnly: boolean; isTB?: boolean }[] => {
    if (!t) return [];
    const aId = g.entries[rI]?.team?.id;
    const bId = g.entries[cIdx - 1]?.team?.id;
    const m = findGroupMatch(g.idx, aId, bId);
    if (!m) return [];
    const sets: any[] = (m as any).sets || [];
    if (m.status === 'live' && sets.length === 0) return [];
    if (sets.length === 0) return [];
    const winnerId = (() => {
      const w: any = (m as any).winner;
      if (typeof w === 'number') return w;
      if (w && typeof w === 'object') return w.id ?? null;
      return null;
    })();
    const team1Id = m.team_1?.id;
    const team2Id = m.team_2?.id;
    const loserId = winnerId ? (winnerId === team1Id ? team2Id : team1Id) : null;
    const findRowByTeamId = (teamId?: number | null) => {
      if (!teamId) return null;
      const idx = g.entries.findIndex((e) => e?.team?.id === teamId);
      return idx >= 0 ? (idx + 1) : null;
    };
    const win_row = winnerId ? findRowByTeamId(winnerId) : null;
    const lose_row = loserId ? findRowByTeamId(loserId) : null;
    const isWinnerCell = !!winnerId && !!win_row && !!lose_row && (rIdx === win_row && cIdx === lose_row);
    const isLoserCell = !!winnerId && !!win_row && !!lose_row && (rIdx === lose_row && cIdx === win_row);
    if (!isWinnerCell && !isLoserCell) return [];
    const aIsWinner = isWinnerCell; // если false — в этой ячейке должен быть зеркальный счёт
    const pairs = sets.map((s: any) => {
      if (s.is_tiebreak_only) {
        const t1 = s.tb_1 ?? 0; const t2 = s.tb_2 ?? 0;
        const w = winnerId === team1Id ? t1 : t2;
        const l = winnerId === team1Id ? t2 : t1;
        return { left: aIsWinner ? w : l, right: aIsWinner ? l : w, tbOnly: true, isTB: true };
      }
      const g1 = s.games_1 ?? 0; const g2 = s.games_2 ?? 0;
      let w = winnerId === team1Id ? g1 : g2;
      let l = winnerId === team1Id ? g2 : g1;
      if (winnerId && w < l) { const tmp = w; w = l; l = tmp; }
      return { left: aIsWinner ? w : l, right: aIsWinner ? l : w, tbOnly: false, isTB: false };
    });
    return pairs;
  };

  // Подсчет тех. столбцов для конкретной строки группы
  const computeRowStats = (g: { idx: number; entries: (Participant | null)[]; cols: number[] }, rIdx: number, rI: number) => {
    // Если доступны агрегаты с бэка — используем их напрямую
    const teamId = g.entries[rI]?.team?.id as number | undefined;
    const groupAgg = groupStats[g.idx];
    if (teamId && groupAgg && groupAgg.stats && groupAgg.stats[teamId]) {
      const st = groupAgg.stats[teamId];
      // Учитываем ничьи в знаменателе для соотношения сетов
      const setsTotal = st.sets_won + st.sets_lost + (st.sets_drawn || 0);
      const gamesTotal = st.games_won + st.games_lost;
      const setsRatio = setsTotal > 0 ? (st.sets_won / setsTotal).toFixed(2) : '0.00';
      const gamesRatio = gamesTotal > 0 ? (st.games_won / gamesTotal).toFixed(2) : '0.00';
      return {
        wins: st.wins,
        sets: `${st.sets_won}/${st.sets_lost}`,
        setsRatio,
        games: `${st.games_won}/${st.games_lost}`,
        gamesRatio,
        setsRatioNum: setsTotal > 0 ? (st.sets_won / setsTotal) : 0,
        gamesRatioNum: gamesTotal > 0 ? (st.games_won / gamesTotal) : 0,
      };
    }

    let wins = 0;
    let setsWon = 0;
    let setsLost = 0;
    let gamesWon = 0;
    let gamesLost = 0;
    // Признак формата "только тай-брейк" (эвристика: один сет и он TB-only). При нём оставляем поведение игр как есть.
    const sf: any = (t as any)?.set_format || {};
    const onlyTiebreakMode = (sf?.max_sets === 1) && !!sf?.allow_tiebreak_only_set;
    for (const cIdx of g.cols) {
      if (cIdx === rIdx) continue;
      const pairs = getCellPairs(g, rIdx, cIdx, rI);
      if (pairs.length === 0) continue;
      // Сначала считаем сеты и игры по каждому сету
      let setsWonLocal = 0;
      let setsLostLocal = 0;
      for (const p of pairs) {
        // Чемпионский TB считаем как 1:0/0:1 по агрегату Сеты (games остаются как есть)
        if (p.left > p.right) setsWonLocal += 1; else setsLostLocal += 1;
        // Игры суммируем всегда по факту отображённых чисел.
        gamesWon += p.left; gamesLost += p.right;
      }
      setsWon += setsWonLocal;
      setsLost += setsLostLocal;
      // Победа в матче определяем по числу выигранных сетов, а не по сумме очков
      if (setsWonLocal > setsLostLocal) wins += 1;
      // Для onlyTiebreakMode поведение эквивалентно (один сет), поэтому дополнительных условий не требуется
    }
    const setsTotal = setsWon + setsLost;
    const gamesTotal = gamesWon + gamesLost;
    const setsRatio = setsTotal > 0 ? (setsWon / setsTotal).toFixed(2) : '0.00';
    const gamesRatio = gamesTotal > 0 ? (gamesWon / gamesTotal).toFixed(2) : '0.00';
    return {
      wins,
      sets: `${setsWon}/${setsLost}`,
      setsRatio,
      games: `${gamesWon}/${gamesLost}`,
      gamesRatio,
      // численные значения для ранжирования
      setsRatioNum: setsTotal > 0 ? (setsWon / setsTotal) : 0,
      gamesRatioNum: gamesTotal > 0 ? (gamesWon / gamesTotal) : 0,
    };
  };

  // --- Ранжирование строк внутри группы ---
  const h2hCompare = (g: { idx: number; entries: (Participant | null)[]; cols: number[] }, rIdxA: number, rIA: number, rIdxB: number, rIB: number): number => {
    // Возвращает -1 если A выше (победил B), 1 если B выше, 0 если определить нельзя
    const pairsAB = getCellPairs(g, rIdxA, rIdxB, rIA);
    const pairsBA = getCellPairs(g, rIdxB, rIdxA, rIB);
    const sumAB_L = pairsAB.reduce((a, p) => a + p.left, 0);
    const sumAB_R = pairsAB.reduce((a, p) => a + p.right, 0);
    const sumBA_L = pairsBA.reduce((a, p) => a + p.left, 0);
    const sumBA_R = pairsBA.reduce((a, p) => a + p.right, 0);
    const aBeatsB = (sumAB_L > sumAB_R) || (sumBA_R > sumBA_L);
    const bBeatsA = (sumAB_L < sumAB_R) || (sumBA_L > sumBA_R);
    if (aBeatsB && !bBeatsA) return -1;
    if (bBeatsA && !aBeatsB) return 1;
    return 0;
  };

  const teamInfoForRow = (g: { entries: (Participant | null)[] }, rI: number) => {
    const team: any = g.entries[rI]?.team || {};
    const name = team.full_name || team.display_name || team.name || '';
    const hasPetrov = (name || '').toLowerCase().includes('петров михаил');
    // рейтинг, если есть
    let rating = Number(team.rating || team.rating_sum || 0);
    // если у команды есть вложенные игроки с рейтингами — попробуем просуммировать
    const p1 = team.player_1 && typeof team.player_1 === 'object' ? team.player_1 : null;
    const p2 = team.player_2 && typeof team.player_2 === 'object' ? team.player_2 : null;
    if (p1 && typeof p1.rating === 'number') rating += p1.rating;
    if (p2 && typeof p2.rating === 'number') rating += p2.rating;
    return { name, hasPetrov, rating };
  };

  const finalizeTie = (g: { idx: number; entries: (Participant | null)[]; cols: number[] }, group: { rIdx: number; rI: number }[]) => {
    // спец-тайбрейкеры: Петров Михаил -> рейтинг -> алфавит
    return [...group].sort((a, b) => {
      const ta = teamInfoForRow(g, a.rI);
      const tb = teamInfoForRow(g, b.rI);
      if (ta.hasPetrov !== tb.hasPetrov) return ta.hasPetrov ? -1 : 1;
      if (ta.rating !== tb.rating) return tb.rating - ta.rating;
      return (ta.name || '').localeCompare(tb.name || '', 'ru');
    });
  };

  const rankGroup = (
    g: { idx: number; entries: (Participant | null)[]; rows: number[]; cols: number[] },
    rows: { rIdx: number; rI: number; wins: number; setsRatio: number; gamesRatio: number }[],
    stage: 0 | 1 | 2
  ): { rIdx: number; rI: number }[] => {
    // stage 0: wins, 1: setsRatio, 2: gamesRatio
    const key = stage === 0 ? 'wins' : (stage === 1 ? 'setsRatio' : 'gamesRatio');
    // группировка по ключу
    const map = new Map<number, { rIdx: number; rI: number; wins: number; setsRatio: number; gamesRatio: number }[]>();
    for (const row of rows) {
      const val = row[key as 'wins' | 'setsRatio' | 'gamesRatio'];
      const k = typeof val === 'number' ? val : 0;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(row);
    }
    const sortedKeys = Array.from(map.keys()).sort((a, b) => b - a);
    const out: { rIdx: number; rI: number }[] = [];
    for (const k of sortedKeys) {
      const group = map.get(k)!;
      if (group.length === 1) {
        out.push({ rIdx: group[0].rIdx, rI: group[0].rI });
        continue;
      }
      if (group.length === 2) {
        // личная встреча
        const [A, B] = group;
        const cmp = h2hCompare(g, A.rIdx, A.rI, B.rIdx, B.rI);
        if (cmp < 0) { out.push({ rIdx: A.rIdx, rI: A.rI }, { rIdx: B.rIdx, rI: B.rI }); continue; }
        if (cmp > 0) { out.push({ rIdx: B.rIdx, rI: B.rI }, { rIdx: A.rIdx, rI: A.rI }); continue; }
        // если не определилось — переходим к следующему критерию/финалу
        if (stage < 2) {
          const sub = rankGroup(g, group as any, (stage + 1) as 1 | 2);
          out.push(...sub);
        } else {
          out.push(...finalizeTie(g, group));
        }
        continue;
      }
      // >2 участников в группе — рекурсивно по следующему показателю
      if (stage < 2) {
        const sub = rankGroup(g, group as any, (stage + 1) as 1 | 2);
        out.push(...sub);
      } else {
        out.push(...finalizeTie(g, group));
      }
    }
    return out;
  };

  const computePlacements = (g: { idx: number; entries: (Participant | null)[]; rows: number[]; cols: number[] }) => {
    // Используем исключительно расклад мест с бэкенда
    const block = groupStats[g.idx];
    const placeByRow: Record<number, number> = {};
    if (block && block.placements) {
      g.rows.forEach((rIdx, rI) => {
        const teamId = g.entries[rI]?.team?.id as number | undefined;
        const place = teamId ? block.placements[teamId] : undefined;
        if (place != null) {
          placeByRow[rIdx] = place;
        }
      });
    }
    // Если по какой-то причине для строки не пришло место, зададим по порядку строки
    if (Object.keys(placeByRow).length !== g.rows.length) {
      g.rows.forEach((rIdx, i) => {
        if (placeByRow[rIdx] == null) placeByRow[rIdx] = i + 1;
      });
    }
    return placeByRow;
  };

  // Подробный рендер содержимого ячейки со счетом с логами пошагового алгоритма
  const renderScoreCell = (
    g: { idx: number; entries: (Participant | null)[] },
    rIdx: number,
    cIdx: number,
    rI: number
  ) => {
    try {
      const aId = g.entries[rI]?.team?.id;
      const bId = g.entries[cIdx - 1]?.team?.id;
      if (!t) return '';
      const m = findGroupMatch(g.idx, aId, bId);
      if (!m) return '';
      const sets: any[] = (m as any).sets || [];
      
      // Красный кружочек для live-матчей
      const liveDot = (
        <span style={{ display: 'inline-block', width: '0.6em', height: '0.6em', background: '#dc3545', borderRadius: '50%', marginRight: 6, verticalAlign: 'middle' }} />
      );
      
      // Для live: если счёт уже есть — показываем счёт, иначе «идет»
      if (m.status === 'live' && sets.length === 0) {
        return <span style={{ fontWeight: 700 }}>{liveDot}идет</span>;
      }
      if (sets.length === 0) return '';
      const winnerId = (() => {
        const w: any = (m as any).winner;
        if (typeof w === 'number') return w;
        if (w && typeof w === 'object') return w.id ?? null;
        return null;
      })();
      
      // Для свободного формата без победителя (ничья) - показываем счет без ориентации
      if (!winnerId) {
        const aId = g.entries[rI]?.team?.id;
        const team1Id = m.team_1?.id;
        const aIsTeam1 = (aId === team1Id);
        
        const scoreStr = sets.map((s: any) => {
          if (s.is_tiebreak_only) {
            const t1 = s.tb_1 ?? 0; const t2 = s.tb_2 ?? 0;
            const left = aIsTeam1 ? t1 : t2;
            const right = aIsTeam1 ? t2 : t1;
            return `${left}:${right}TB`;
          }
          const g1 = s.games_1 ?? 0; const g2 = s.games_2 ?? 0;
          const left = aIsTeam1 ? g1 : g2;
          const right = aIsTeam1 ? g2 : g1;
          const tbShown = (s.tb_1 != null && s.tb_2 != null) ? Math.min(s.tb_1, s.tb_2) : null;
          return tbShown != null ? `${left}:${right}(${tbShown})` : `${left}:${right}`;
        }).join(', ');
        
        const content = <span style={{ fontWeight: 700 }}>{scoreStr}</span>;
        return m.status === 'live' ? <span>{liveDot}{content}</span> : content;
      }
      
      const team1Id = m.team_1?.id;
      const team2Id = m.team_2?.id;
      
      // Проверяем, является ли это свободным форматом
      const isFreeFormat = (t as any)?.set_format?.games_to === 0;
      
      if (isFreeFormat) {
        // Для свободного формата отображаем счет как есть (по team_1/team_2)
        const aId = g.entries[rI]?.team?.id;
        const aIsTeam1 = (aId === team1Id);
        
        const scoreStr = sets.map((s: any) => {
          if (s.is_tiebreak_only) {
            const t1 = s.tb_1 ?? 0; const t2 = s.tb_2 ?? 0;
            const left = aIsTeam1 ? t1 : t2;
            const right = aIsTeam1 ? t2 : t1;
            return `${left}:${right}TB`;
          }
          const g1 = s.games_1 ?? 0; const g2 = s.games_2 ?? 0;
          const left = aIsTeam1 ? g1 : g2;
          const right = aIsTeam1 ? g2 : g1;
          const tbShown = (s.tb_1 != null && s.tb_2 != null) ? Math.min(s.tb_1, s.tb_2) : null;
          return tbShown != null ? `${left}:${right}(${tbShown})` : `${left}:${right}`;
        }).join(', ');
        
        const content = <span style={{ fontWeight: 700 }}>{scoreStr}</span>;
        return m.status === 'live' ? <span>{liveDot}{content}</span> : content;
      }
      
      // Стандартная логика для обычных форматов (с победителем)
      const loserId = winnerId === team1Id ? team2Id : team1Id;
      const findRowByTeamId = (teamId?: number | null) => {
        if (!teamId) return null;
        const idx = g.entries.findIndex((e) => e?.team?.id === teamId);
        return idx >= 0 ? (idx + 1) : null;
      };
      const win_row = findRowByTeamId(winnerId);
      const lose_row = findRowByTeamId(loserId);
      if (!win_row || !lose_row) return '';
      const isWinnerCell = (rIdx === win_row && cIdx === lose_row);
      const isLoserCell = (rIdx === lose_row && cIdx === win_row);
      if (!isWinnerCell && !isLoserCell) return '';
      const aIsWinner = isWinnerCell; // если false — в этой ячейке должен быть зеркальный счёт
      const scoreStr = sets.map((s: any) => {
        if (s.is_tiebreak_only) {
          // Чемпионский TB — добавляем "TB" в конце
          const t1 = s.tb_1 ?? 0; const t2 = s.tb_2 ?? 0;
          const w = winnerId === team1Id ? t1 : t2;
          const l = winnerId === team1Id ? t2 : t1;
          // Зеркалим при необходимости
          const left = aIsWinner ? w : l;
          const right = aIsWinner ? l : w;
          return `${left}:${right}TB`;
        }
        // Обычный сет — собрать как Winner:Loser из games_1/games_2 без принудительного переворота
        const g1 = s.games_1 ?? 0; const g2 = s.games_2 ?? 0;
        const w = winnerId === team1Id ? g1 : g2;
        const l = winnerId === team1Id ? g2 : g1;
        const tbShown = (s.tb_1 != null && s.tb_2 != null) ? Math.min(s.tb_1, s.tb_2) : null;
        const left = aIsWinner ? w : l;
        const right = aIsWinner ? l : w;
        return tbShown != null ? `${left}:${right}(${tbShown})` : `${left}:${right}`;
      }).join(', ');
      const content = <span style={{ fontWeight: 700 }}>{scoreStr}</span>;
      return m.status === 'live' ? <span>{liveDot}{content}</span> : content;
    } catch (e) {
      return '';
    }
  };

  useEffect(() => {
    (async () => {
      const ok = await reload();
      if (!ok) return;
      await refreshGroupStats();
      await fetchGroupSchedule();
    })();
  }, [fetchGroupSchedule]);

  // Загрузка данных мастер-турнира при монтировании или изменении idNum
  useEffect(() => {
    if (idNum && !authLoading) {
      loadMasterData();
    }
  }, [idNum, authLoading, loadMasterData]);

  // Загрузка регламентов для круговой системы (только для отображения селекта)
  useEffect(() => {
    const loadRulesets = async () => {
      if (!t) return;
      try {
        // Инициализируем режим отображения имён один раз, на основе организатора
        if (!showNamesInitializedRef.current) {
          const organizerUsername = (t as any).organizer_username;
          const useDisplayName = organizerUsername === 'ArtemPara';
          setShowFullName(!useDisplayName);
          showNamesInitializedRef.current = true;
        }

        const list = await tournamentApi.getRulesets('round_robin');
        setRrRulesets(list);
      } catch (e) {
        console.warn('Не удалось загрузить регламенты RR:', e);
      }
    };
    loadRulesets();
  }, [t]);

  const handleRrRulesetChange = async (rulesetId: number) => {
    if (!t || !canManageTournament) return;
    try {
      setSavingRrRuleset(true);
      await tournamentApi.setRuleset(t.id, rulesetId);
      await reload();
      await refreshGroupStats();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Ошибка при изменении регламента');
    } finally {
      setSavingRrRuleset(false);
    }
  };

  // Группы: равномерное распределение существующих участников по group_index,
  // если group_index не задан — распределим по порядку.
  const groups = useMemo(() => {
    if (!t) return [] as { idx: number; rows: number[]; cols: number[]; entries: (Participant | null)[] }[];
    const groupsCount = Math.max(1, t.groups_count || 1);
    const parts = [...(t.participants || [])].sort((a, b) => a.group_index - b.group_index || a.row_index - b.row_index);

    // Считаем размеры групп: стараемся максимально равномерно.
    // Если участников пока нет, используем planned_participants.
    const planned = t.planned_participants || 0;
    const total = Math.max(parts.length, planned);
    const base = Math.floor(total / groupsCount);
    let remainder = total % groupsCount;
    const sizes = Array.from({ length: groupsCount }, () => base).map((v, i) => v + (i < remainder ? 1 : 0));

    // Если участников 0, дадим минимум по 1 строке для визуала
    const safeSizes = sizes.map((s) => (s > 0 ? s : 1));

    // Наполняем группы по имеющимся row_index/ group_index, иначе последовательно
    const buckets: (Participant | null)[][] = safeSizes.map((s) => Array.from({ length: s }, () => null));
    for (const p of parts) {
      const gi = Math.min(Math.max((p.group_index || 1) - 1, 0), groupsCount - 1);
      const ri = Math.min(Math.max((p.row_index || 1) - 1, 0), buckets[gi].length - 1);
      if (!buckets[gi][ri]) buckets[gi][ri] = p; else {
        // Найдём первое свободное место в группе
        const k = buckets[gi].findIndex((x) => !x);
        if (k >= 0) buckets[gi][k] = p;
      }
    }

    return buckets.map((rows, i) => ({
      idx: i + 1,
      rows: Array.from({ length: rows.length }, (_, k) => k + 1),
      cols: Array.from({ length: rows.length }, (_, k) => k + 1),
      entries: rows,
    }));
  }, [t]);

  const toggleTech = () => {
    setShowTech((prev) => {
      const anyOn = prev.some(Boolean);
      const next = !anyOn;
      return prev.map(() => next);
    });
  };

  const handleCellClick = (groupIdx: number, rowIdx: number, colIdx: number | null, type: 'participant' | 'score') => {
    if (!t) return;
    // Блокировка действий при завершённом турнире
    if (t?.status === 'completed') return;

    if (type === 'participant') {
      if (!canManageTournament) return;
      setPickerOpen({ group: groupIdx, row: rowIdx });
    } else {
      if (!canManageMatches) return;
      if (!t || colIdx == null) return;
      // Найдём матч по парам команд в группе
      const g = groups.find(g => g.idx === groupIdx);
      if (!g) return;
      const aTeamId = g.entries[rowIdx - 1]?.team?.id;
      const bTeamId = g.entries[colIdx - 1]?.team?.id;
      if (!aTeamId || !bTeamId) return;
      const m = (t.matches || []).find((m: any) => m.stage === 'group' && m.group_index === groupIdx &&
        ((m.team_1?.id === aTeamId && m.team_2?.id === bTeamId) || (m.team_1?.id === bTeamId && m.team_2?.id === aTeamId))
      );
      if (!m?.id) {
        alert('Матч ещё не создан. Сначала зафиксируйте участников.');
        return;
      }
      const isLive = m.status === 'live';
      const matchTeam1Id = (m as any)?.team_1?.id ?? (m as any)?.team_1_id ?? null;
      const matchTeam2Id = (m as any)?.team_2?.id ?? (m as any)?.team_2_id ?? null;
      setScoreDialog({ group: groupIdx, a: rowIdx, b: colIdx, matchId: m.id, isLive, matchTeam1Id, matchTeam2Id });
    }
  };

  const startMatch = async () => {
    // Блокировка для завершённых турниров
    if (t?.status === 'completed') return;
    
    if (!t || !scoreDialog?.matchId) return;
    
    // Проверка: оба участника не должны участвовать в других live-матчах
    const g = groups.find(x => x.idx === scoreDialog.group);
    const team1Id = g?.entries[scoreDialog.a - 1]?.team?.id;
    const team2Id = g?.entries[scoreDialog.b - 1]?.team?.id;
    
    if (team1Id && team2Id) {
      const liveMatches = (t.matches || []).filter((m: any) => 
        m.status === 'live' && m.id !== scoreDialog.matchId
      );
      
      const team1InLive = liveMatches.find((m: any) => 
        m.team_1?.id === team1Id || m.team_2?.id === team1Id
      );
      const team2InLive = liveMatches.find((m: any) => 
        m.team_1?.id === team2Id || m.team_2?.id === team2Id
      );
      
      if (team1InLive || team2InLive) {
        const team1Name = g?.entries[scoreDialog.a - 1]?.team?.display_name || 
                          g?.entries[scoreDialog.a - 1]?.team?.name || 'Участник 1';
        const team2Name = g?.entries[scoreDialog.b - 1]?.team?.display_name || 
                          g?.entries[scoreDialog.b - 1]?.team?.name || 'Участник 2';
        
        if (team1InLive && team2InLive) {
          alert(`Оба участника (${team1Name} и ${team2Name}) уже играют в других матчах. Завершите их текущие матчи перед началом нового.`);
        } else if (team1InLive) {
          alert(`${team1Name} уже играет в другом матче. Завершите текущий матч перед началом нового.`);
        } else {
          alert(`${team2Name} уже играет в другом матче. Завершите текущий матч перед началом нового.`);
        }
        return;
      }
    }
    
    try {
      await api.post(`/tournaments/${t.id}/match_start/`, { match_id: scoreDialog.matchId });
      await reload();
    } finally {
      setScoreDialog(null);
    }
  };

  const cancelMatch = async () => {
    // Блокировка для завершённых турниров
    if (t?.status === 'completed') return;
    
    if (!t || !scoreDialog?.matchId) return;
    try {
      await api.post(`/tournaments/${t.id}/match_cancel/`, { match_id: scoreDialog.matchId });
      await reload();
    } finally {
      setScoreDialog(null);
    }
  };

  const completeTournament = async (force: boolean = false) => {
    if (!t) return;
    setSaving(true);
    try {
      // Используем complete_master для завершения всех стадий турнира
      await api.post(`/tournaments/${t.id}/complete_master/`, { force });
      alert('Турнир завершён, рейтинг рассчитан для всех стадий');
      // Перенаправить на страницу списка турниров
      window.location.href = '/tournaments';
    } catch (err: any) {
      const errorData = err?.response?.data;
      alert(errorData?.error || 'Ошибка при завершении турнира');
    } finally {
      setSaving(false);
    }
  };

  const deleteTournament = async () => {
    if (!t || !canDeleteTournament) return;
    if (!confirm('Удалить турнир без возможности восстановления?')) return;
    setSaving(true);
    try {
      await api.delete(`/tournaments/${t.id}/`);
      nav('/tournaments');
    } finally {
      setSaving(false);
    }
  };

  // Рассчитываем заполненность участников (вынесено выше раннего return для стабильного порядка хуков)
  const distinctPlayerIds = useMemo(() => {
    const ids = new Set<number>();
    (t?.participants || []).forEach(p => {
      const team: any = p.team || {};
      const raw1 = team.player_1;
      const raw2 = team.player_2;
      const p1 = typeof raw1 === 'object' ? raw1?.id : raw1;
      const p2 = typeof raw2 === 'object' ? raw2?.id : raw2;
      if (p1) ids.add(Number(p1));
      if (p2) ids.add(Number(p2));
    });
    return ids;
  }, [t]);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mt-0 mb-6">Турнир #{id}</h1>
        <div className="card text-center py-8">Загрузка данных турнира...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold mt-0 mb-6">Турнир #{id}</h1>
        <div className="card text-center py-8 text-red-700">
          <p className="mb-3">{error}</p>
          {!user && (
            <p>
              <a href="/login" className="text-blue-600 hover:underline">Перейти на страницу входа</a>
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!t) {
    return (
      <div>
        <h1 className="text-2xl font-bold mt-0 mb-6">Турнир #{id}</h1>
        <div className="card text-center py-8">Турнир не найден</div>
      </div>
    );
  }

  // Завершённый турнир: запрещаем отжимать фиксацию участников
  const completed = t.status === 'completed';
  const effectiveLocked = completed ? true : lockParticipants;

  const filledEntries = (t.participants || []).filter(p => p.team).length;
  const planned = t.planned_participants || 0;
  const isDoubles = t.participant_mode === 'doubles';
  const canLock = isDoubles ? (distinctPlayerIds.size >= planned && planned > 0) : (filledEntries >= planned && planned > 0);
  const lockDisabled = completed || !canLock;

  return (
    <div>
      {groups.length === 0 && (
        <div className="card">Пока нет параметров для отображения таблиц. Вернитесь и укажите количество участников и групп.</div>
      )}

      <div ref={exportRef}>
        {/* Шапка для выгрузки с логотипом (и основная шапка страницы) */}
        <div style={{ position: 'relative', padding: '24px 24px 12px 24px', borderBottom: '1px solid #eee', background: '#fff' }}>
          <img src="/static/img/logo.png" alt="BeachPlay" style={{ position: 'absolute', right: 24, top: 24, height: 48 }} />
          {/* 1-я строка: имя турнира */}
          <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 2 }}>{t.name}</div>
          {/* 2-я строка: дата, система, формат, организатор */}
          <div style={{ fontSize: 16, color: '#666' }}>
            {t.date ? formatDate(t.date) : ''}
            {t.get_system_display ? ` • ${t.get_system_display}` : ''}
            {t.get_participant_mode_display ? ` • ${t.get_participant_mode_display}` : ''}
            {(t as any)?.set_format?.name ? ` • Формат счёта: ${(t as any).set_format.name}` : ''}
            {t.organizer_name ? ` • Организатор: ${t.organizer_name}` : ''}
          </div>
          {/* 3-я строка: статус, число участников, число групп, средний рейтинг, коэффициент, призовой фонд */}
          <div style={{ fontSize: 13, color: '#777', marginTop: 2 }}>
            Статус: {t.status === 'created' ? 'Регистрация' : t.status === 'active' ? 'Идёт' : 'Завершён'}
            {typeof t.participants_count === 'number' && typeof t.planned_participants === 'number' 
              ? ` • Участников: ${t.participants_count}/${t.planned_participants}` 
              : typeof t.participants_count === 'number' 
              ? ` • Участников: ${t.participants_count}` 
              : ''}
            {((t.system === 'round_robin' || t.system === 'king') && typeof (t as any).groups_count === 'number' && (t as any).groups_count > 1)
              ? ` • групп: ${(t as any).groups_count}`
              : ''}
            {t.status !== 'created' && typeof (t as any).avg_rating_bp === 'number' ? ` • средний рейтинг турнира по BP: ${Math.round((t as any).avg_rating_bp)}` : ''}
            {t.status !== 'created' && typeof (t as any).rating_coefficient === 'number' ? ` • Коэффициент турнира: ${(t as any).rating_coefficient.toFixed(1)}` : ''}
            {(t as any).prize_fund ? ` • Призовой фонд: ${(t as any).prize_fund}` : ''}
          </div>
        </div>

        {/* Селектор стадий многостадийного турнира */}
        {stages.length > 0 && (
          <div style={{ padding: '0 24px', marginTop: 8 }}>
            <TournamentStageSelector
              stages={stages}
              currentStageId={currentStageId || idNum}
              canEdit={canManageTournament}
              onStageChange={handleStageChanged}
              onDeleteStage={handleDeleteStage}
            />
          </div>
        )}

        {/* Модалка ввода счёта - выбор между обычной и свободным форматом */}
        {scoreInput && (t as any)?.set_format?.games_to === 0 && (t as any)?.set_format?.max_sets !== 1 ? (
          <FreeFormatScoreModal
            match={{
              id: scoreInput.matchId,
              team_1: { 
                id: scoreInput.team1.id, 
                name: scoreInput.team1.name,
                display_name: scoreInput.team1.name 
              },
              team_2: { 
                id: scoreInput.team2.id, 
                name: scoreInput.team2.name,
                display_name: scoreInput.team2.name 
              },
              sets: scoreInput.existingSets || []
            }}
            tournament={t}
            mirror={scoreInput.matchTeam1Id !== null && scoreInput.matchTeam1Id !== scoreInput.team1.id}
            onClose={() => setScoreInput(null)}
            onSave={async (sets) => {
              if (!t) return;
              if (t.status === 'completed') return;
              
              // Преобразуем данные для API
              let setsToSend = sets
                .filter(s => s.custom_enabled || s.champion_tb_enabled)
                .map(s => ({
                  index: s.index,
                  games_1: s.games_1,
                  games_2: s.games_2,
                  tb_loser_points: s.champion_tb_enabled ? null : s.tb_loser_points,
                  is_tiebreak_only: s.champion_tb_enabled
                }));
              
              // Для свободного формата: если порядок команд в UI не совпадает с порядком в матче, переворачиваем сеты
              const matchTeam1Id = scoreInput.matchTeam1Id;
              const uiTeam1Id = scoreInput.team1?.id;
              if (matchTeam1Id && uiTeam1Id && matchTeam1Id !== uiTeam1Id) {
                // Порядок не совпадает - переворачиваем сеты перед отправкой
                setsToSend = setsToSend.map(s => ({
                  index: s.index,
                  games_1: s.games_2,
                  games_2: s.games_1,
                  tb_loser_points: s.tb_loser_points,
                  is_tiebreak_only: s.is_tiebreak_only
                }));
              }
              
              await matchApi.saveFreeFormatScore(t.id, scoreInput.matchId, setsToSend);
              setScoreInput(null);
              await refreshGroupStats();
              reload();
            }}
          />
        ) : (
          <MatchScoreModal
            isOpen={!!scoreInput}
            onClose={() => setScoreInput(null)}
            setFormat={(t as any)?.set_format}
            onSaveFull={async (sets) => {
              if (!t || !scoreInput) return;
              // Блокировка для завершённых турниров
              if (t.status === 'completed') return;
              // Приводим порядок сторон к порядку матча на бэкенде: Match.team_1 / Match.team_2
              let setsToSend = sets;
              const mt1 = scoreInput.matchTeam1Id ?? null;
              const uiT1 = scoreInput.team1?.id ?? null;
              if (mt1 && uiT1 && mt1 !== uiT1) {
                // UI team1 соответствует backend team_2 — нужно поменять стороны в каждом сете
                setsToSend = sets.map(s => ({
                  index: s.index,
                  games_1: s.games_2,
                  games_2: s.games_1,
                  tb_1: s.tb_2 ?? null,
                  tb_2: s.tb_1 ?? null,
                  is_tiebreak_only: s.is_tiebreak_only,
                }));
              }
              await api.post(`/tournaments/${t.id}/match_save_score_full/`, {
                match_id: scoreInput.matchId,
                sets: setsToSend,
              });
              // обновить таблицу сразу после сохранения
              setScoreInput(null);
              await refreshGroupStats();
              reload();
            }}
            onSave={async (winnerTeamId, loserTeamId, gamesWinner, gamesLoser) => {
              // Блокировка для завершённых турниров
              if (t?.status === 'completed') return;
              
              if (!scoreInput) return;
              
              // API ожидает id_team_first/id_team_second как победитель/проигравший
              // и games_first/games_second как очки победителя/проигравшего
              // winnerTeamId/loserTeamId уже правильные (реальные ID команд)
              // gamesWinner/gamesLoser уже правильные (очки победителя/проигравшего)
              // Просто передаём их напрямую
              
              await api.post(`/tournaments/${t.id}/match_save_score/`, {
                match_id: scoreInput.matchId,
                id_team_first: winnerTeamId,
                id_team_second: loserTeamId,
                games_first: gamesWinner,
                games_second: gamesLoser,
              });
              setScoreInput(null);
              await refreshGroupStats();
              reload();
            }}
            team1={scoreInput?.team1 || null}
            team2={scoreInput?.team2 || null}
          />
        )}

      {/* Диалог действий по ячейке счёта */}
      {scoreDialog && (
        <div
          onClick={() => setScoreDialog(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
          }}
          onKeyDown={(e) => { if (e.key === 'Escape') setScoreDialog(null); }}
          tabIndex={-1}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 360, background: '#fff', borderRadius: 10,
              boxShadow: '0 10px 30px rgba(0,0,0,0.15)', overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #eee' }}>
              <strong>{(() => {
                const match = t?.matches?.find(m => m.id === scoreDialog.matchId);
                const hasScore = match?.sets && match.sets.length > 0;
                if (hasScore && match?.status === 'completed') return 'Матч завершен';
                if (scoreDialog.isLive) return 'Матч идёт';
                return 'Матч не начат';
              })()}</strong>
              <button onClick={() => setScoreDialog(null)} style={{ border: 0, background: 'transparent', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, color: '#555' }}>
                {(() => {
                  const g = groups.find(g => g.idx === scoreDialog.group);
                  const aTeam = g?.entries[scoreDialog.a - 1]?.team as any;
                  const bTeam = g?.entries[scoreDialog.b - 1]?.team as any;
                  const fmt = (team: any) => {
                    if (!team) return '—';
                    return showFullName ? (team.full_name || '—') : (team.display_name || team.name || '—');
                  };
                  return (
                    <>Группа {scoreDialog.group}. {fmt(aTeam)} — {fmt(bTeam)}</>
                  );
                })()}
              </div>
              {(() => {
                const match = t?.matches?.find(m => m.id === scoreDialog.matchId);
                const hasScore = match?.sets && match.sets.length > 0;
                const isCompleted = hasScore && match?.status === 'completed';
                
                if (isCompleted) {
                  // Завершенный матч со счетом
                  const isFreeFormat = (t as any)?.set_format?.games_to === 0;
                  
                  return (
                    <>
                      {isFreeFormat && (
                        <button
                          onClick={startMatch}
                          style={{ padding: '8px 12px', borderRadius: 6, background: BUTTON_COLORS.SUCCESS, color: '#fff', border: `1px solid ${BUTTON_COLORS.SUCCESS}`, cursor: 'pointer' }}
                        >
                          Начать матч
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (!scoreDialog?.matchId) return;
                          const g = groups.find(x => x.idx === scoreDialog.group);
                          const aTeam = g?.entries[scoreDialog.a - 1]?.team as any;
                          const bTeam = g?.entries[scoreDialog.b - 1]?.team as any;
                          if (!aTeam?.id || !bTeam?.id) return;
                          const fmt = (team: any) => showFullName ? (team.full_name || '—') : (team.display_name || team.name || '—');
                          
                          const match = t?.matches?.find(m => m.id === scoreDialog.matchId);
                          let existingSets = match?.sets || [];
                          
                          const isFreeFormat = (t as any)?.set_format?.games_to === 0;
                          if (isFreeFormat && existingSets.length > 0) {
                            const matchTeam1Id = scoreDialog.matchTeam1Id;
                            const uiTeam1Id = aTeam.id;
                            if (matchTeam1Id && uiTeam1Id && matchTeam1Id !== uiTeam1Id) {
                              existingSets = existingSets.map((s: any) => ({
                                ...s,
                                games_1: s.games_2,
                                games_2: s.games_1,
                                tb_1: s.tb_2,
                                tb_2: s.tb_1
                              }));
                            }
                          }
                          
                          setScoreInput({
                            matchId: scoreDialog.matchId!,
                            team1: { id: aTeam.id, name: fmt(aTeam) },
                            team2: { id: bTeam.id, name: fmt(bTeam) },
                            matchTeam1Id: scoreDialog.matchTeam1Id ?? null,
                            matchTeam2Id: scoreDialog.matchTeam2Id ?? null,
                            existingSets: existingSets,
                          });
                          setScoreDialog(null);
                        }}
                        style={{ padding: '8px 12px', borderRadius: 6, background: BUTTON_COLORS.PRIMARY, color: '#fff', border: `1px solid ${BUTTON_COLORS.PRIMARY}`, cursor: 'pointer' }}
                      >
                        Ввести счёт
                      </button>
                      <button
                        onClick={async () => {
                          if (!scoreDialog?.matchId) return;
                          if (!confirm('Удалить счет матча? Это действие нельзя отменить.')) return;
                          try {
                            await api.post(`/tournaments/${t.id}/match_delete_score/`, { match_id: scoreDialog.matchId });
                            await refreshGroupStats();
                            reload();
                            setScoreDialog(null);
                          } catch (error) {
                            console.error('Ошибка удаления счета:', error);
                            alert('Не удалось удалить счет матча');
                          }
                        }}
                        style={{ padding: '8px 12px', borderRadius: 6, background: BUTTON_COLORS.DANGER, color: '#fff', border: `1px solid ${BUTTON_COLORS.DANGER}`, cursor: 'pointer' }}
                      >
                        Удалить матч
                      </button>
                    </>
                  );
                }
                
                if (!scoreDialog.isLive) {
                  // Матч не начат
                  return (
                    <>
                      <button
                        onClick={startMatch}
                        style={{ padding: '8px 12px', borderRadius: 6, background: BUTTON_COLORS.SUCCESS, color: '#fff', border: `1px solid ${BUTTON_COLORS.SUCCESS}`, cursor: 'pointer' }}
                      >
                        Начать матч
                      </button>
                      <button
                        onClick={() => {
                          if (!scoreDialog?.matchId) return;
                          const g = groups.find(x => x.idx === scoreDialog.group);
                          const aTeam = g?.entries[scoreDialog.a - 1]?.team as any;
                          const bTeam = g?.entries[scoreDialog.b - 1]?.team as any;
                          if (!aTeam?.id || !bTeam?.id) return;
                          const fmt = (team: any) => showFullName ? (team.full_name || '—') : (team.display_name || team.name || '—');
                          
                          const match = t?.matches?.find(m => m.id === scoreDialog.matchId);
                          let existingSets = match?.sets || [];
                          
                          const isFreeFormat = (t as any)?.set_format?.games_to === 0;
                          if (isFreeFormat && existingSets.length > 0) {
                            const matchTeam1Id = scoreDialog.matchTeam1Id;
                            const uiTeam1Id = aTeam.id;
                            if (matchTeam1Id && uiTeam1Id && matchTeam1Id !== uiTeam1Id) {
                              existingSets = existingSets.map((s: any) => ({
                                ...s,
                                games_1: s.games_2,
                                games_2: s.games_1,
                                tb_1: s.tb_2,
                                tb_2: s.tb_1
                              }));
                            }
                          }
                          
                          setScoreInput({
                            matchId: scoreDialog.matchId!,
                            team1: { id: aTeam.id, name: fmt(aTeam) },
                            team2: { id: bTeam.id, name: fmt(bTeam) },
                            matchTeam1Id: scoreDialog.matchTeam1Id ?? null,
                            matchTeam2Id: scoreDialog.matchTeam2Id ?? null,
                            existingSets: existingSets,
                          });
                          setScoreDialog(null);
                        }}
                        style={{ padding: '8px 12px', borderRadius: 6, background: BUTTON_COLORS.PRIMARY, color: '#fff', border: `1px solid ${BUTTON_COLORS.PRIMARY}`, cursor: 'pointer' }}
                      >
                        Ввести счёт
                      </button>
                    </>
                  );
                }
                
                // Матч идет (live)
                return (
                  <>
                    <button
                      onClick={cancelMatch}
                      style={{ padding: '8px 12px', borderRadius: 6, background: BUTTON_COLORS.DANGER, color: '#fff', border: `1px solid ${BUTTON_COLORS.DANGER}`, cursor: 'pointer' }}
                    >
                      Отменить матч
                    </button>
                    <button
                      onClick={() => {
                        if (!scoreDialog?.matchId) return;
                        const g = groups.find(x => x.idx === scoreDialog.group);
                        const aTeam = g?.entries[scoreDialog.a - 1]?.team as any;
                        const bTeam = g?.entries[scoreDialog.b - 1]?.team as any;
                        if (!aTeam?.id || !bTeam?.id) return;
                        const fmt = (team: any) => showFullName ? (team.full_name || '—') : (team.display_name || team.name || '—');
                        
                        const match = t?.matches?.find(m => m.id === scoreDialog.matchId);
                        const existingSets = match?.sets || [];
                        
                        setScoreInput({
                          matchId: scoreDialog.matchId!,
                          team1: { id: aTeam.id, name: fmt(aTeam) },
                          team2: { id: bTeam.id, name: fmt(bTeam) },
                          matchTeam1Id: scoreDialog.matchTeam1Id ?? null,
                          matchTeam2Id: scoreDialog.matchTeam2Id ?? null,
                          existingSets: existingSets,
                        });
                        setScoreDialog(null);
                      }}
                      style={{ padding: '8px 12px', borderRadius: 6, background: BUTTON_COLORS.PRIMARY, color: '#fff', border: `1px solid ${BUTTON_COLORS.PRIMARY}`, cursor: 'pointer' }}
                    >
                      Ввести счёт
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {showAnnouncementSettingsModal && announcementSettings && (
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
          onClick={() => !savingAnnouncementSettings && setShowAnnouncementSettingsModal(false)}
        >
          <div
            style={{
              backgroundColor: '#fff',
              padding: 20,
              maxWidth: 520,
              width: '100%',
              maxHeight: '80vh',
              overflow: 'auto',
              borderRadius: 8,
              boxShadow: '0 10px 30px rgba(15,23,42,0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Настройка авто-анонсов</h3>
            <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 12 }}>
              Укажите ID чата или канала Telegram, куда будут отправляться анонсы, и выберите, когда их слать.
              Telegram-бот должен быть добавлен в этот чат и должен быть там администратором.
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
                ID чата Telegram
              </label>
              <input
                type="text"
                className="form-control"
                value={announcementSettings.telegram_chat_id}
                onChange={(e) => setAnnouncementSettings(prev => prev ? { ...prev, telegram_chat_id: e.target.value } : prev)}
                placeholder="Например: -1001234567890"
                disabled={savingAnnouncementSettings}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Режим публикации:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="radio"
                    name="announcement_mode"
                    value="edit_single"
                    checked={announcementSettings.announcement_mode === 'edit_single'}
                    onChange={(e) => setAnnouncementSettings(prev => prev ? { ...prev, announcement_mode: 'edit_single' } : prev)}
                    disabled={savingAnnouncementSettings}
                  />
                  <span>Редактировать одно сообщение (рекомендуется)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="radio"
                    name="announcement_mode"
                    value="new_messages"
                    checked={announcementSettings.announcement_mode === 'new_messages'}
                    onChange={(e) => setAnnouncementSettings(prev => prev ? { ...prev, announcement_mode: 'new_messages' } : prev)}
                    disabled={savingAnnouncementSettings}
                  />
                  <span>Публиковать новые сообщения при каждом обновлении</span>
                </label>
              </div>
            </div>

            <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600 }}>Когда отправлять анонсы:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16, fontSize: 13 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={announcementSettings.send_72h_before}
                  onChange={(e) => setAnnouncementSettings(prev => prev ? { ...prev, send_72h_before: e.target.checked } : prev)}
                  disabled={savingAnnouncementSettings}
                />
                <span>За 72 часа до начала</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={announcementSettings.send_48h_before}
                  onChange={(e) => setAnnouncementSettings(prev => prev ? { ...prev, send_48h_before: e.target.checked } : prev)}
                  disabled={savingAnnouncementSettings}
                />
                <span>За 48 часов до начала</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={announcementSettings.send_24h_before}
                  onChange={(e) => setAnnouncementSettings(prev => prev ? { ...prev, send_24h_before: e.target.checked } : prev)}
                  disabled={savingAnnouncementSettings}
                />
                <span>За 24 часа до начала</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={announcementSettings.send_2h_before}
                  onChange={(e) => setAnnouncementSettings(prev => prev ? { ...prev, send_2h_before: e.target.checked } : prev)}
                  disabled={savingAnnouncementSettings}
                />
                <span>За 2 часа до начала</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={announcementSettings.send_on_roster_change}
                  onChange={(e) => setAnnouncementSettings(prev => prev ? { ...prev, send_on_roster_change: e.target.checked } : prev)}
                  disabled={savingAnnouncementSettings}
                />
                <span>При изменении основного состава</span>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                className="btn"
                type="button"
                onClick={() => setShowAnnouncementSettingsModal(false)}
                disabled={savingAnnouncementSettings}
              >
                Отмена
              </button>
              <button
                className="btn"
                type="button"
                onClick={handleSaveAnnouncementSettings}
                disabled={savingAnnouncementSettings || !announcementSettings.telegram_chat_id.trim()}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {showAnnouncementModal && (
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
          onClick={() => setShowAnnouncementModal(false)}
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
            <div
              style={{
                width: '100%',
                minHeight: 260,
                padding: 10,
                marginTop: 8,
                whiteSpace: 'pre-wrap',
                border: '1px solid #ccc',
                borderRadius: 4,
                backgroundColor: '#f9f9f9',
                fontFamily: 'monospace',
                fontSize: 14,
                lineHeight: 1.5,
                overflowY: 'auto',
                maxHeight: '60vh',
              }}
            >
              {renderAnnouncementWithLinks(announcementText)}
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" type="button" onClick={() => setShowAnnouncementModal(false)}>
                Закрыть
              </button>
              <button className="btn" type="button" onClick={handleCopyAnnouncementText} disabled={!announcementText}>
                Копировать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Условный рендеринг в зависимости от статуса турнира */}
      {t.status === 'created' ? (
        /* Drag-and-Drop интерфейс для статуса created */
        <div className="knockout-content" style={{ marginTop: 16, height: 'calc(100vh - 300px)', minHeight: '500px' }}>
          {/* Левая панель с участниками */}
          <div className="participants-panel">
            <DraggableParticipantList
              participants={dragDropState.participants}
              mainParticipants={dragDropState.mainParticipants}
              reserveParticipants={dragDropState.reserveParticipants}
              onRemoveParticipant={handleRemoveParticipantFromList}
              onAddParticipant={() => setDragDropPickerOpen(true)}
              onAddFromPreviousStage={() => setShowAddFromStageModal(true)}
              onAutoSeed={handleAutoSeed}
              onClearTables={handleClearTables}
              maxParticipants={t.planned_participants || 32}
              canAddMore={true}
              isStage={!!t.parent_tournament}
            />
          </div>

          {/* Правая панель с упрощенными таблицами */}
          <div className="bracket-panel">
            {/* Кнопка переключения отображения имен */}
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
              
              // Вычисляем размер группы с учетом остатка
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
                  
                  {/* Расписание и кнопка выбора формата */}
                  <div style={{ marginTop: 16, padding: 12, background: '#f8f9fa', borderRadius: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                      Расписание группы {gi + 1}
                    </div>
                    
                    {(() => {
                      // Получаем расписание для этой группы из schedule
                      const groupScheduleRounds = schedule?.[gi + 1];
                      
                      if (groupScheduleRounds && groupScheduleRounds.length > 0) {
                        // Показываем расписание
                        return (
                          <div style={{ marginBottom: 8 }}>
                            {groupScheduleRounds.map((round: [number, number][], roundIdx: number) => (
                              <div key={roundIdx} style={{ marginBottom: 4, fontSize: 13 }}>
                                <strong>Тур {roundIdx + 1}:</strong>{' '}
                                {round.map((pair: [number, number], pairIdx: number) => (
                                  <span key={pairIdx}>
                                    {pairIdx > 0 ? ', ' : ''}
                                    {pair[0]}–{pair[1]}
                                  </span>
                                ))}
                              </div>
                            ))}
                          </div>
                        );
                      } else {
                        // Расписание не создано
                        return (
                          <div className="text-gray-500 text-sm mb-2">
                            Выберите формат расписания для группы
                          </div>
                        );
                      }
                    })()}
                    
                    {canManageTournament && (
                      <button
                        onClick={() => {
                          // Получаем текущий выбранный шаблон для группы
                          let currentPatternId: number | null = null;
                          const raw = (t as any)?.group_schedule_patterns;
                          if (raw) {
                            if (typeof raw === 'string') {
                              try {
                                const parsed = JSON.parse(raw);
                                const nbspName = groupName.replace(' ', '\u00A0');
                                const val = parsed?.[groupName] ?? parsed?.[nbspName];
                                if (val != null && val !== '') currentPatternId = Number(val);
                              } catch (_) {
                                // ignore parse error
                              }
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
            
            {/* Кнопка фиксации участников */}
            {canManageTournament && (() => {
              // Проверяем, заполнены ли все таблицы
              const allSlotsFilled = simplifiedDropSlots.every(slot => slot.currentParticipant !== null);
              const canLock = allSlotsFilled && simplifiedDropSlots.length > 0;
              
              return (
                <div style={{ marginTop: 16, padding: 16, background: '#f8f9fa', borderRadius: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: canLock ? 'pointer' : 'not-allowed', opacity: canLock ? 1 : 0.5 }}>
                    <input
                      type="checkbox"
                      checked={dragDropState.isSelectionLocked}
                      disabled={saving || !canLock}
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
                    {canLock 
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
        /* Полные таблицы для статусов active и completed */
        <>
      {groups.map((g, gi) => (
        <div key={g.idx} style={{ marginBottom: 22 }}>
          <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <strong>Группа {g.idx}</strong>
            <button data-export-exclude="true" className={`toggle ${showTech[0] ? 'active' : ''}`} onClick={toggleTech}>
              Победы/Сеты/Сеты соот./Геймы соот.
            </button>
            <button data-export-exclude="true" className={`toggle ${showFullName ? 'active' : ''}`} onClick={() => setShowFullName(v => !v)}>
              ФИО показать
            </button>
            {gi === 0 && canManageTournament && (
              <div style={{ marginLeft: 'auto' }} data-export-exclude="true">
                {/* Раньше здесь был чекбокс "Зафиксировать участников".
                    Теперь управление статусом перенесено в нижнюю панель действий. */}
              </div>
            )}
          </div>

          <div style={{ overflow: 'auto' }}>
            <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px' }}>№</th>
                  <th className="sticky" style={{ border: '1px solid #e7e7ea', padding: '6px 8px', background: '#fff', position: 'sticky', left: 0, zIndex: 1, textAlign: 'left' }}>Участник</th>
                  {g.cols.map((i) => (
                    <th key={i} style={{ border: '1px solid #e7e7ea', padding: '6px 8px' }}>{i}</th>
                  ))}
                  <th className={showTech[0] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 80 }}>
                    Победы
                    {(t as any)?.set_format?.games_to === 0 && (t as any)?.set_format?.max_sets === 0 && (
                      <div
                        ref={winsTipRef}
                        style={{ display: 'inline-block', marginLeft: 4, position: 'relative' }}
                        onMouseEnter={() => setShowWinsTip(true)}
                        onMouseLeave={() => setShowWinsTip(false)}
                      >
                        <button
                          type="button"
                          aria-label="Пояснение по учёту побед в свободном формате"
                          aria-expanded={showWinsTip}
                          style={{
                            display: 'inline-block',
                            width: 14,
                            height: 14,
                            border: 'none',
                            padding: 0,
                            borderRadius: 3,
                            backgroundColor: '#007bff',
                            color: '#fff',
                            fontSize: 10,
                            lineHeight: '14px',
                            textAlign: 'center',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowWinsTip(v => !v);
                          }}
                          onBlur={(e) => {
                            const next = e.relatedTarget as Node | null;
                            if (!next || (winsTipRef.current && !winsTipRef.current.contains(next))) {
                              setShowWinsTip(false);
                            }
                          }}
                        >
                          i
                        </button>
                        {showWinsTip && (
                          <div
                            role="dialog"
                            aria-live="polite"
                            style={{
                              position: 'absolute',
                              zIndex: 20,
                              marginTop: 4,
                              left: 0,
                              minWidth: 220,
                              maxWidth: 280,
                              padding: 8,
                              borderRadius: 4,
                              border: '1px solid #e5e7eb',
                              backgroundColor: '#ffffff',
                              boxShadow: '0 4px 10px rgba(15, 23, 42, 0.12)',
                              fontSize: 12,
                              lineHeight: 1.4,
                              textAlign: 'left',
                              whiteSpace: 'pre-line',
                            }}
                          >
                            {'Т.к. турнир проводится со счётом в свободном формате,\n' +
                             'в котором возможны ничьи и чётное количество сетов,\n' +
                             'количество побед не подсчитывается,\n' +
                             'и при определении мест этот критерий игнорируется.'}
                          </div>
                        )}
                      </div>
                    )}
                  </th>
                  <th className={showTech[0] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Сеты</th>
                  <th className={showTech[0] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Сеты<br />соот.</th>
                  <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Геймы</th>
                  <th className={showTech[0] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Геймы<br />соот.</th>
                  <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Место</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((rIdx, rI) => {
                  const placeByRow = computePlacements(g as any);
                  const stats = computeRowStats(g as any, rIdx, rI);
                  return (
                  <tr key={rIdx}>
                    <td style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{rIdx}</td>
                    <td
                      className={`cell-click${effectiveLocked ? ' locked' : ''}`}
                      style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'left', position: 'sticky', left: 0, background: '#fff', fontWeight: effectiveLocked ? 700 as any : 400 as any }}
                      onClick={() => !effectiveLocked && !completed && handleCellClick(g.idx, rIdx, null, 'participant')}
                      title={g.entries[rI]?.team?.full_name || g.entries[rI]?.team?.display_name || g.entries[rI]?.team?.name || ''}
                    >
                      {(() => {
                        const team: any = g.entries[rI]?.team || {};
                        const name = showFullName ? (team.full_name || '—') : (team.display_name || team.name || '—');
                        // Получим рейтинги по id игроков
                        const id1 = team.player_1 && typeof team.player_1 === 'object' ? team.player_1.id : (typeof team.player_1 === 'number' ? team.player_1 : null);
                        const id2 = team.player_2 && typeof team.player_2 === 'object' ? team.player_2.id : (typeof team.player_2 === 'number' ? team.player_2 : null);
                        const r1 = (typeof id1 === 'number' && playerRatings.has(id1)) ? playerRatings.get(id1)! : (typeof team?.player_1 === 'object' && typeof team.player_1?.rating === 'number' ? team.player_1.rating : null);
                        const r2 = (typeof id2 === 'number' && playerRatings.has(id2)) ? playerRatings.get(id2)! : (typeof team?.player_2 === 'object' && typeof team.player_2?.rating === 'number' ? team.player_2.rating : null);
                        let rating: number | null = null;
                        if (typeof r1 === 'number' && typeof r2 === 'number') {
                          rating = Math.round((r1 + r2) / 2);
                        } else if (typeof r1 === 'number') {
                          rating = Math.round(r1);
                        } else if (typeof r2 === 'number') {
                          rating = Math.round(r2);
                        } else if (typeof team.rating === 'number') {
                          rating = Math.round(team.rating);
                        } else if (typeof team.rating_sum === 'number') {
                          const cnt = (team.player_1 ? 1 : 0) + (team.player_2 ? 1 : 0);
                          rating = cnt > 0 ? Math.round(team.rating_sum / cnt) : Math.round(team.rating_sum);
                        }

                        const isDoublesWithNames =
                          !!t && (t.status === 'active' || t.status === 'completed') &&
                          (t as any).participant_mode === 'doubles' && !showFullName;

                        if (isDoublesWithNames && (team.player_1 || team.player_2)) {
                          const p1: any = typeof team.player_1 === 'object' ? team.player_1 : null;
                          const p2: any = typeof team.player_2 === 'object' ? team.player_2 : null;
                          const p1Name = p1 ? (p1.display_name || `${p1.last_name} ${p1.first_name}`) : null;
                          const p2Name = p2 ? (p2.display_name || `${p2.last_name} ${p2.first_name}`) : null;

                          const rank1 = (typeof id1 === 'number' && playerRanks.has(id1)) ? playerRanks.get(id1)! : null;
                          const rank2 = (typeof id2 === 'number' && playerRanks.has(id2)) ? playerRanks.get(id2)! : null;
                          const showRanks = t.status === 'active';

                          return (
                            <>
                              {p1Name && (
                                <span>
                                  {p1Name}
                                  {typeof r1 === 'number' && (
                                    <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.75 }}>
                                      ({showRanks && typeof rank1 === 'number' ? `#${rank1} • ${Math.round(r1)} BP` : `${Math.round(r1)} BP`})
                                    </span>
                                  )}
                                </span>
                              )}
                              {p1Name && p2Name && (
                                <span style={{ margin: '0 4px' }}>/</span>
                              )}
                              {p2Name && (
                                <span>
                                  {p2Name}
                                  {typeof r2 === 'number' && (
                                    <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.75 }}>
                                      ({showRanks && typeof rank2 === 'number' ? `#${rank2} • ${Math.round(r2)} BP` : `${Math.round(r2)} BP`})
                                    </span>
                                  )}
                                </span>
                              )}
                              {typeof rating === 'number' && (
                                <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.75 }}>
                                  {rating} <span style={{ fontSize: 9 }}>BP</span>
                                </span>
                              )}
                            </>
                          );
                        }

                        return (
                          <>
                            <span>{name}</span>
                            {typeof rating === 'number' && (
                              <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.75 }}>
                                {rating} <span style={{ fontSize: 9 }}>BP</span>
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    {g.cols.map((cIdx) => (
                      rIdx === cIdx ? (
                        <td key={cIdx} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', background: '#111', color: '#111', textAlign: 'center' }}>■</td>
                      ) : (
                        <td
                          key={cIdx}
                          className={`cell-click${(!effectiveLocked || completed) ? ' locked' : ''}`}
                          style={{
                            border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center',
                            background: (() => {
                              // Hover эффект от расписания
                              if (hoveredMatch && hoveredMatch.groupIdx === g.idx) {
                                if ((rIdx === hoveredMatch.row1 && cIdx === hoveredMatch.row2) ||
                                    (rIdx === hoveredMatch.row2 && cIdx === hoveredMatch.row1)) {
                                  return '#f3f4f6';
                                }
                              }
                              // Подсветка ячеек:
                              // - live матч: чуть более насыщённый зелёный (#e9fbe9)
                              // - ячейка победителя (winner vs loser): более светлый зелёный (#f3fdf3)
                              const aId = g.entries[rI]?.team?.id;
                              const bId = g.entries[cIdx - 1]?.team?.id;
                              const m = findGroupMatch(g.idx, aId, bId);
                              if (!m) return 'transparent';
                              if (m.status === 'live') return MATCH_COLORS.LIVE;
                              // Подсветка победной ячейки только для завершённых матчей с наличием победителя
                              if (m.status === 'completed') {
                                const sets: any[] = (m as any).sets || [];
                                if (sets.length === 0) return 'transparent';
                                const winnerId = (() => {
                                  const w: any = (m as any).winner;
                                  if (typeof w === 'number') return w;
                                  if (w && typeof w === 'object') return w.id ?? null;
                                  return null;
                                })();
                                if (!winnerId) return 'transparent';
                                const team1Id = m.team_1?.id;
                                const team2Id = m.team_2?.id;
                                const loserId = winnerId === team1Id ? team2Id : team1Id;
                                const findRowByTeamId = (teamId?: number | null) => {
                                  if (!teamId) return null;
                                  const idx = g.entries.findIndex((e) => e?.team?.id === teamId);
                                  return idx >= 0 ? (idx + 1) : null;
                                };
                                const win_row = findRowByTeamId(winnerId);
                                const lose_row = findRowByTeamId(loserId);
                                if (win_row && lose_row && rIdx === win_row && cIdx === lose_row) {
                                  // Такой же цвет, как подсветка победителя в олимпийской сетке
                                  return MATCH_COLORS.WINNER;
                                }
                              }
                              return 'transparent';
                            })()
                          }}
                          onClick={() => effectiveLocked && !completed && handleCellClick(g.idx, rIdx, cIdx, 'score')}
                        >
                          {renderScoreCell(g, rIdx, cIdx, rI)}
                        </td>
                      )
                    ))}
                    <td
                      className={showTech[0] ? '' : 'hidden-col'}
                      style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}
                    >
                      <span>{stats.wins}</span>
                    </td>
                    <td className={showTech[0] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{stats.sets}</td>
                    <td className={showTech[0] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{stats.setsRatio}</td>
                    <td style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{stats.games}</td>
                    <td className={showTech[0] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{stats.gamesRatio}</td>
                    <td style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center', fontWeight: 700 }}><strong>{toRoman(placeByRow[rIdx] || g.rows.length)}</strong></td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>

          {/* Расписание под таблицей группы (в выгрузку не включаем) */}
          <div className="text-sm mt-3" data-export-exclude="true">
            <div className="font-medium mb-1">Порядок игр:</div>
            {schedule[g.idx] && schedule[g.idx].length > 0 ? (
              <div className="flex flex-col gap-1">
                {schedule[g.idx].map((tour: [number, number][], ti: number) => (
                  <div key={ti} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span>Тур {ti + 1}:</span>
                    {tour.map((pair: [number, number], pi: number) => {
                      // Найти матч для этой пары
                      const team1 = g.entries[pair[0] - 1]?.team;
                      const team2 = g.entries[pair[1] - 1]?.team;
                      const m = findGroupMatch(g.idx, team1?.id, team2?.id);
                      const isCompleted = m?.status === 'completed';
                      const isLive = m?.status === 'live';
                      
                      return (
                        <span
                          key={pi}
                          style={{
                            textDecoration: isCompleted ? 'line-through' : 'none',
                            background: isLive ? MATCH_COLORS.LIVE : 'transparent',
                            padding: isLive ? '2px 6px' : '0',
                            borderRadius: isLive ? '4px' : '0',
                            cursor: effectiveLocked && !completed && canManageMatches ? 'pointer' : 'default',
                            transition: 'background 0.15s ease'
                          }}
                          onMouseEnter={() => setHoveredMatch({ groupIdx: g.idx, row1: pair[0], row2: pair[1] })}
                          onMouseLeave={() => setHoveredMatch(null)}
                          onClick={() => {
                            if (effectiveLocked && !completed && canManageMatches && team1?.id && team2?.id) {
                              if (!m?.id) { alert('Матч ещё не создан. Сначала зафиксируйте участников.'); return; }
                              const matchTeam1Id = (m as any)?.team_1?.id ?? (m as any)?.team_1_id ?? null;
                              const matchTeam2Id = (m as any)?.team_2?.id ?? (m as any)?.team_2_id ?? null;
                              setScoreDialog({ 
                                group: g.idx, 
                                a: pair[0], 
                                b: pair[1], 
                                matchId: m.id, 
                                isLive: isLive,
                                matchTeam1Id,
                                matchTeam2Id
                              });
                            }
                          }}
                        >
                          {pair[0]}–{pair[1]}
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-gray-500">Нет данных о расписании</div>
            )}
            
            {/* Кнопка выбора формата расписания */}
            {!completed && !effectiveLocked && (
              <button
                onClick={() => {
                  // Используем плановый размер группы (число строк)
                  const participantsCount = g.rows.length;
                  const groupName = `Группа ${g.idx}`;
                  // Получаем текущий выбранный шаблон для группы (с учётом того, что group_schedule_patterns может быть строкой JSON)
                  let currentPatternId: number | null = null;
                  const raw = (t as any)?.group_schedule_patterns;
                  if (raw) {
                    if (typeof raw === 'string') {
                      try {
                        const parsed = JSON.parse(raw);
                        const nbspName = groupName.replace(' ', '\u00A0');
                        const val = parsed?.[groupName] ?? parsed?.[nbspName];
                        if (val != null && val !== '') currentPatternId = Number(val);
                      } catch (_) {
                        // ignore parse error
                      }
                    } else if (typeof raw === 'object') {
                      const nbspName = groupName.replace(' ', '\u00A0');
                      const val = raw?.[groupName] ?? raw?.[nbspName];
                      if (val != null && val !== '') currentPatternId = Number(val);
                    }
                  }
                  setSchedulePatternModal({
                    groupName,
                    participantsCount,
                    currentPatternId
                  });
                }}
                className="mt-2 px-3 py-1.5 text-sm text-white bg-green-600 rounded hover:bg-green-700 transition-colors"
              >
                Выбрать формат расписания
              </button>
            )}
          </div>
        </div>
      ))}
      
      {/* Нижний DOM-футер для экспорта: скрыт на странице, показывается только при экспортe */}
      <div data-export-only="true" style={{ padding: '12px 24px 20px 24px', borderTop: '1px solid #eee', display: 'none', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14 }}>BeachPlay.ru</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>всегда онлайн!</div>
        {/* TODO: как появиться сайт вставить сюда URL */}
      </div>
        </>
      )}
      </div>

      {/* Регламент (круговая): селект вверху страницы, не попадает в экспорт */}
      {t?.system === 'round_robin' && (
        <div className="mb-4 flex items-center gap-3 flex-wrap" data-export-exclude="true">
          <span className="font-semibold">Регламент:</span>
          <div className="flex-1 min-w-[240px]" style={{ maxWidth: '100%' }}>
            <select
              className="w-full border rounded px-2 py-1 text-sm"
              value={(t as any)?.ruleset?.id || ''}
              disabled={!canManageTournament || !getAccessToken() || savingRrRuleset || t.status === 'completed'}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (!Number.isNaN(val)) handleRrRulesetChange(val);
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
      )}

      {/* Модалка выбора участника для drag-and-drop */}
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

      {/* Модалка выбора участника (старая, для active/completed) */}
      {canManageTournament && pickerOpen && (
        <ParticipantPickerModal
          open={true}
          onClose={() => setPickerOpen(null)}
          tournamentId={t.id}
          groupIndex={pickerOpen.group}
          rowIndex={pickerOpen.row}
          isDoubles={t.participant_mode === 'doubles'}
          usedPlayerIds={Array.from(distinctPlayerIds)}
          onSaved={reload}
        />
      )}

      {/* Модалка редактирования настроек турнира (круговая система) */}
      {showEditModal && t && (
        <EditTournamentModal
          tournament={t}
          setFormats={setFormats}
          rulesets={rrRulesets}
          onSubmit={handleEditSettingsSubmit}
          onClose={() => setShowEditModal(false)}
        />
      )}

      {/* Модалка выбора формата расписания */}
      {schedulePatternModal && (
        <SchedulePatternModal
          isOpen={true}
          onClose={() => setSchedulePatternModal(null)}
          groupName={schedulePatternModal.groupName}
          participantsCount={schedulePatternModal.participantsCount}
          currentPatternId={schedulePatternModal.currentPatternId}
          tournamentId={t.id}
          onSuccess={async () => {
            await reload();
            await fetchGroupSchedule();
            setSchedulePatternModal(null);
          }}
        />
      )}

      {/* Модалка присвоения стартового рейтинга */}
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

      {/* Модалка незавершенных матчей */}
      <IncompleteMatchesModal
        isOpen={showIncompleteMatchesModal}
        onClose={() => setShowIncompleteMatchesModal(false)}
        onConfirm={() => {
          setShowIncompleteMatchesModal(false);
          // Проверяем игроков без рейтинга
          if (t?.has_zero_rating_players) {
            setShowCompleteRatingChoice(true);
          } else {
            completeTournament(true); // force = true
          }
        }}
        incompleteMatches={incompleteMatches}
      />

      {/* Диалог выбора способа завершения турнира при наличии игроков без рейтинга */}
      {showCompleteRatingChoice && (
        <div
          onClick={() => !saving && setShowCompleteRatingChoice(false)}
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
              maxWidth: 520,
              width: '90%',
              padding: '16px 20px 14px 20px',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              В турнире есть игроки без рейтинга
            </div>
            <div style={{ fontSize: 14, color: '#4b5563', marginBottom: 16 }}>
              Вы хотите закрыть турнир, чтобы рейтинг этим игрокам присвоился автоматически, или присвоить рейтинг вручную?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => {
                  setShowCompleteRatingChoice(false);
                  // Если пришли сюда из модалки незавершенных матчей, передаем force=true
                  completeTournament(incompleteMatches.length > 0);
                }}
              >
                Автоматически
              </button>
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => {
                  setShowCompleteRatingChoice(false);
                  setShowInitialRatingModal(true);
                }}
              >
                Вручную
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Нижняя панель действий (в выгрузку не включаем) */}
      <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }} data-export-exclude="true">
        {t && canManageTournament && t.status === 'created' && (
          <button
            className="btn"
            onClick={handleOpenEditSettings}
            disabled={saving}
          >
            Поменять настройки турнира
          </button>
        )}
        {t && canManageTournament && t.status === 'active' && (
          <button className="btn" onClick={() => nav(`/tournaments/${t.id}/schedule`)} disabled={saving}>
            Расписание
          </button>
        )}
        {t && canManageTournament && t.status === 'active' && canAddStage && (
          <button
            className="btn"
            style={{ background: '#28a745', borderColor: '#28a745' }}
            disabled={saving}
            onClick={() => setShowCreateStageModal(true)}
          >
            Добавить стадию
          </button>
        )}
        {t && canManageTournament && t.status === 'active' && (
          <button className="btn" onClick={handleCompleteTournamentClick} disabled={saving}>Завершить турнир</button>
        )}
        {canManageTournament && (
          <button
            className="btn"
            onClick={deleteTournament}
            disabled={saving}
            style={{ background: '#dc3545', borderColor: '#dc3545' }}
          >
            Удалить турнир
          </button>
        )}
        {t && canManageTournament && t.status === 'active' && (
          <button
            className="btn"
            onClick={async () => {
              try {
                setSaving(true);
                await tournamentApi.unlockParticipants(t.id);
                setLockParticipants(false);
                await reload();
              } catch (error) {
                console.error('Failed to unlock participants:', error);
                alert('Не удалось вернуть турнир в статус "Регистрация"');
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
          >
            Вернуть статус "Регистрация"
          </button>
        )}
        {t && t.has_zero_rating_players && t.status !== 'completed' && canManageTournament && (
          <button
            className="btn"
            disabled={saving}
            onClick={() => setShowInitialRatingModal(true)}
          >
            Присвоить стартовый рейтинг
          </button>
        )}
        {/* REFEREE по плану не должен пользоваться кнопкой "Поделиться" */}
        {role !== 'REFEREE' && (
          <>
            <button className="btn" onClick={handleShare}>Поделиться</button>
            {t && canManageTournament && t.status === 'created' && (
              <button
                className="btn"
                type="button"
                disabled={loadingAnnouncement}
                onClick={handleShowAnnouncementText}
              >
                Текст анонса
              </button>
            )}
            {t && canManageTournament && t.status === 'created' && (
              <button
                className="btn"
                type="button"
                disabled={loadingAnnouncementSettings}
                onClick={handleOpenAnnouncementSettings}
              >
                Настройка авто-анонсов
              </button>
            )}
            {t && t.status === 'completed' && (
              <button
                className="btn"
                type="button"
                disabled={loadingTextResults}
                onClick={handleShowTextResults}
              >
                Результаты текстом
              </button>
            )}
            {t && t.status === 'completed' && role === 'ADMIN' && (
              <button
                className="btn"
                type="button"
                disabled={saving}
                onClick={handleRollbackTournamentCompletion}
                style={{ background: BUTTON_COLORS.DANGER, borderColor: BUTTON_COLORS.DANGER }}
              >
                Откатить завершение турнира
              </button>
            )}
          </>
        )}
      </div>

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

      {/* Модалка создания стадии */}
      {showCreateStageModal && t && masterSystem && (
        <CreateStageModal
          isOpen={showCreateStageModal}
          onClose={() => setShowCreateStageModal(false)}
          tournamentId={t.id}
          masterSystem={masterSystem}
          masterParticipantMode={t.participant_mode as 'singles' | 'doubles'}
          parentStageName={t.stage_name || null}
          parentPlannedParticipants={t.planned_participants || undefined}
          parentGroupsCount={t.groups_count || undefined}
          parentDate={t.date ? t.date : undefined}
          parentStartTime={(t as any).start_time || null}
          parentIsRatingCalc={t.is_rating_calc ?? true}
          parentSetFormatId={(t as any).set_format?.id || undefined}
          currentParticipants={(t.participants || []).map((p) => {
            const teamId = p.team?.id;
            let place: number | null = null;
            
            // Найти место участника в groupStats
            if (teamId) {
              for (const groupIdx in groupStats) {
                const block = groupStats[groupIdx];
                if (block?.placements && block.placements[teamId]) {
                  place = block.placements[teamId];
                  break;
                }
              }
            }
            
            // Используем full_name из team, который уже содержит "Фамилия Имя" или "Фамилия Имя1 / Фамилия Имя2"
            const fullName = p.team?.full_name || (p.team && (p.team.display_name || p.team.name)) || `Участник #${p.id}`;
            
            return {
              id: teamId || p.id,
              name: fullName,
              place,
            };
          })}
          setFormats={setFormats}
          onStageCreated={async (stageId) => {
            setShowCreateStageModal(false);
            await reload();
            if (stageId) {
              nav(`/tournaments/${stageId}`);
            }
          }}
        />
      )}

      {/* Модалка добавления участников из предыдущей стадии */}
      {showAddFromStageModal && t && t.parent_tournament && (
        <AddParticipantsFromStageModal
          isOpen={showAddFromStageModal}
          onClose={() => setShowAddFromStageModal(false)}
          tournamentId={t.id}
          parentTournamentId={t.parent_tournament}
          currentParticipantIds={(t.participants || [])
            .map(p => p.team?.id)
            .filter((id): id is number => id !== undefined)}
          onSave={handleSaveParticipantsFromStage}
        />
      )}
    </div>
  );
};
