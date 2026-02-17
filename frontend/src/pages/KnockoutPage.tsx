import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BracketData } from '../types/bracket';
import { BracketWithSVGConnectors } from '../components/BracketWithSVGConnectors';
import { DraggableParticipantList } from '../components/DraggableParticipantList';
import { KnockoutParticipantPicker } from '../components/KnockoutParticipantPicker';
import api, { tournamentApi, matchApi } from '../services/api';
import { formatDate } from '../services/date';
import { DraggableParticipant, DropSlot, DragDropState } from '../types/dragdrop';
import { MatchActionDialog } from '../components/MatchActionDialog';
import { MatchScoreModal } from '../components/MatchScoreModal';
import FreeFormatScoreModal from '../components/FreeFormatScoreModal';
import { EditTournamentModal } from '../components/EditTournamentModal';
import { InitialRatingModal } from '../components/InitialRatingModal';
import { TournamentStageSelector, StageInfo } from '../components/TournamentStageSelector';
import { AddParticipantsFromStageModal } from '../components/AddParticipantsFromStageModal';
import { CreateStageModal } from '../components/CreateStageModal';
import { IncompleteMatchesModal } from '../components/IncompleteMatchesModal';
import '../styles/knockout-dragdrop.css';
import { useAuth } from '../context/AuthContext';

// Подбор размера сетки плей-офф по количеству участников:
// ближайшая степень двойки, не меньше 4 и не меньше фактического количества участников.
const computeBracketSize = (baseParticipants: number): number => {
  let n = baseParticipants || 0;
  if (n < 4) n = 4;
  let size = 1;
  while (size < n) size *= 2;
  return size;
};

export const KnockoutPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const role = user?.role;
  const canManageStructure = role === 'ADMIN' || role === 'ORGANIZER';
  const canManageMatches = canManageStructure || role === 'REFEREE';
  const [searchParams, setSearchParams] = useSearchParams();
  const tournamentId = useMemo(() => Number(id), [id]);

  const [bracketId, setBracketId] = useState<number | null>(() => {
    const p = Number(searchParams.get('bracket'));
    return Number.isFinite(p) && p > 0 ? p : null;
  });
  const [data, setData] = useState<BracketData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Set<number>>(new Set());
  const [tMeta, setTMeta] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const bracketExportRef = useRef<HTMLDivElement | null>(null);
  const canDeleteTournament = !!(tMeta && (tMeta as any).can_delete);

  // Состояние для Drag & Drop
  const [dragDropState, setDragDropState] = useState<DragDropState>({
    participants: [],
    dropSlots: [],
    isSelectionLocked: false
  });

  // Модальное окно выбора участника
  const [pickerOpen, setPickerOpen] = useState(false);
  
  // Модальное окно редактирования настроек турнира
  const [showEditModal, setShowEditModal] = useState(false);
  const [setFormats, setSetFormats] = useState<any[]>([]);
  const [koRulesets, setKoRulesets] = useState<any[]>([]);
  
  // Позиции BYE (блокированные для drag-and-drop)
  const [byePositions, setByePositions] = useState<Set<number>>(new Set());
  // Гард от двойных вызовов в StrictMode: сохраняем, для какого bracketId уже грузили BYE
  const byeLoadedRef = useRef<Record<number, boolean>>({});
  
  // Переключатель отображения имён (display_name vs Фамилия Имя)
  const [showFullNames, setShowFullNames] = useState(false);
  const showNamesInitializedRef = useRef(false);
  
  // Диалог действий с матчем
  const [matchActionDialog, setMatchActionDialog] = useState<{
    isOpen: boolean;
    matchId: number | null;
    matchStatus: 'scheduled' | 'live' | 'completed';
    matchTitle?: string;
  }>({ isOpen: false, matchId: null, matchStatus: 'scheduled' });
  
  // Модальное окно ввода счёта
  const [scoreModal, setScoreModal] = useState<{
    open: boolean;
    matchId: number | null;
    team1: { id: number; name: string } | null;
    team2: { id: number; name: string } | null;
  }>({ open: false, matchId: null, team1: null, team2: null });
  const [showInitialRatingModal, setShowInitialRatingModal] = useState(false);
  const [showCompleteRatingChoice, setShowCompleteRatingChoice] = useState(false);
  const [showIncompleteMatchesModal, setShowIncompleteMatchesModal] = useState(false);
  const [incompleteMatches, setIncompleteMatches] = useState<any[]>([]);
  const [showTextResultsModal, setShowTextResultsModal] = useState(false);
  const [textResults, setTextResults] = useState<string>('');
  const [loadingTextResults, setLoadingTextResults] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [announcementText, setAnnouncementText] = useState<string>('');
  const [loadingAnnouncement, setLoadingAnnouncement] = useState(false);
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

  // Многостадийный турнир: список стадий и текущая стадия
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [currentStageId, setCurrentStageId] = useState<number | null>(null);
  const [masterSystem, setMasterSystem] = useState<'round_robin' | 'knockout' | 'king' | null>(null);
  const [canAddStage, setCanAddStage] = useState(false);
  const [showAddFromStageModal, setShowAddFromStageModal] = useState(false);
  const [showCreateStageModal, setShowCreateStageModal] = useState(false);

  // Загрузка master-data для многостадийных турниров (список стадий)
  const loadMasterData = useCallback(async () => {
    if (!tournamentId || Number.isNaN(tournamentId)) return;
    try {
      const data = await tournamentApi.getMasterData(tournamentId);
      const mapped: StageInfo[] = (data.stages || []).map((s: any) => ({
        id: s.id,
        stage_name: s.stage_name,
        stage_order: s.stage_order,
        system: s.system,
        status: s.status,
        can_delete: s.can_delete,
        can_edit: s.can_edit,
        is_current: s.id === tournamentId,
      }));
      // Всегда показываем все стадии, независимо от прав доступа
      // Права доступа используются только для кнопок редактирования/удаления
      setStages(mapped);
      setCurrentStageId(tournamentId);
      setMasterSystem(data.master?.system as any);
      setCanAddStage(data.can_add_stage ?? true);
    } catch (e) {
      console.warn('Failed to load master data for knockout page', e);
    }
  }, [tournamentId, canManageStructure]);

  const handleStageChange = useCallback((stageId: number) => {
    if (!stageId || !stages.length) return;
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;

    // Навигация в зависимости от системы стадии
    if (stage.system === 'knockout') {
      navigate(`/tournaments/${stage.id}/knockout`);
    } else {
      navigate(`/tournaments/${stage.id}`);
    }
  }, [navigate, stages]);

  // Обработчик сохранения участников из предыдущей стадии
  const handleSaveParticipantsFromStage = async (selectedTeamIds: number[]) => {
    if (!tMeta) return;
    
    try {
      // Получаем текущие team_id участников
      const currentTeamIds = dragDropState.participants
        .map(p => p.teamId)
        .filter((id): id is number => id !== undefined);
      
      // Определяем, кого нужно добавить и кого удалить
      const toAdd = selectedTeamIds.filter(id => !currentTeamIds.includes(id));
      const toRemove = currentTeamIds.filter(id => !selectedTeamIds.includes(id));
      
      // Удаляем участников
      for (const teamId of toRemove) {
        const participant = dragDropState.participants.find(p => p.teamId === teamId);
        if (participant) {
          await api.delete(`/tournaments/${tMeta.id}/remove_participant/`, {
            data: { entry_id: participant.id },
          });
        }
      }
      
      // Добавляем участников
      for (const teamId of toAdd) {
        await api.post(`/tournaments/${tMeta.id}/add_participant/`, {
          team_id: teamId,
        });
      }
      
      // Перезагружаем данные
      await loadParticipants();
      await loadDraw();
    } catch (e: any) {
      console.error('Failed to update participants', e);
      window.alert(e?.response?.data?.error || 'Не удалось обновить участников');
    }
  };

  const handleRollbackTournamentCompletion = async () => {
    if (!tMeta || role !== 'ADMIN') return;
    const confirmed = window.confirm('Откатить завершение турнира? Рейтинги за этот турнир будут отменены, статус станет "Активен".');
    if (!confirmed) return;
    try {
      setSaving(true);
      await tournamentApi.rollbackComplete(tMeta.id);
      alert('Завершение турнира откатано, статус снова "Активен".');
      window.location.href = `/tournaments/${tMeta.id}/knockout`;
    } catch (e: any) {
      console.error('Failed to rollback tournament completion', e);
      alert(e?.response?.data?.error || 'Не удалось откатить завершение турнира');
    } finally {
      setSaving(false);
    }
  };

  const handleShowAnnouncementText = async () => {
    if (!tMeta) return;
    try {
      setLoadingAnnouncement(true);
      const res = await tournamentApi.getAnnouncementText(tMeta.id);
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
    if (!tMeta || !canManageStructure || tMeta.status !== 'created') return;
    try {
      setLoadingAnnouncementSettings(true);
      const data = await tournamentApi.getAnnouncementSettings(tMeta.id);
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
    if (!tMeta || !announcementSettings) return;
    try {
      setSavingAnnouncementSettings(true);
      const payload = { ...announcementSettings };
      const updated = await tournamentApi.updateAnnouncementSettings(tMeta.id, payload);
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

  const handleCopyAnnouncementText = async () => {
    try {
      if (!announcementText) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(announcementText);
        alert('Текст анонса скопирован в буфер обмена');
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = announcementText;
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

  const completeTournamentInternal = async (force: boolean = false) => {
    if (!tMeta || !canManageStructure) return;
    setSaving(true);
    try {
      // Используем complete_master для завершения всех стадий турнира
      await api.post(`/tournaments/${tMeta.id}/complete_master/`, { force });
      alert('Турнир завершён, рейтинг рассчитан для всех стадий');
      window.location.href = '/tournaments';
    } catch (e: any) {
      console.error(e);
      const errorData = e?.response?.data;
      alert(errorData?.error || 'Ошибка завершения турнира');
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteTournamentClick = async () => {
    if (!tMeta) return;
    
    // Проверяем незавершенные матчи во всех стадиях
    try {
      const response = await api.get(`/tournaments/${tMeta.id}/check_incomplete_matches/`);
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
    
    if (tMeta?.has_zero_rating_players && tMeta.status !== 'completed') {
      setShowCompleteRatingChoice(true);
      return;
    }
    completeTournamentInternal();
  };

  const handleShowTextResults = async () => {
    if (!tMeta) return;
    try {
      setLoadingTextResults(true);
      const res = await tournamentApi.getTextResults(tMeta.id);
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

  // Динамическая загрузка html2canvas с CDN
  const ensureHtml2Canvas = async (): Promise<any> => {
    const w = window as any;
    if (w.html2canvas) return w.html2canvas;
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Не удалось загрузить html2canvas'));
      document.head.appendChild(s);
    });
    return (window as any).html2canvas;
  };

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
      // Дадим браузеру время переложить layout (особенно важно для экспортной копии сетки и её SVG)
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(), 60)));
      });
      try {
        // Элементы для отдельного рендера
        const headerEl = container.querySelector(':scope > div:first-child') as HTMLElement | null;
        // Предпочитаем экспортную копию сетки (без DnD и контролов)
        const exportWrapper = container.querySelector('[data-bracket-export="true"]') as HTMLElement | null;
        const exportInner = exportWrapper?.querySelector('[data-bracket-container="true"]') as HTMLElement | null;
        // Если экспортной копии нет, падаем обратно на живую панель
        const panelEl = bracketExportRef.current as HTMLElement | null;
        const liveInner = (panelEl?.querySelector('[data-bracket-container="true"]') as HTMLElement | null);

        const targetWrapper = exportWrapper ?? panelEl;
        const targetInner = exportInner ?? liveInner;

        if (!headerEl || !targetWrapper || !targetInner) throw new Error('Не найден контейнер сетки или шапки');

        // Снимем ограничения прокрутки и зафиксируем полные размеры сетки
        const restoreList: Array<{el: HTMLElement; key: string; val: string}> = [];
        const saveStyle = (el: HTMLElement, key: string) => restoreList.push({ el, key, val: el.style.getPropertyValue(key) });

        const sw = Math.max(targetInner.scrollWidth, targetInner.clientWidth);
        const sh = Math.max(targetInner.scrollHeight, targetInner.clientHeight);

        saveStyle(targetWrapper, 'overflow');
        (targetWrapper as HTMLElement).style.overflow = 'visible';
        saveStyle(targetInner, 'overflow');
        targetInner.style.overflow = 'visible';
        saveStyle(targetInner, 'width');
        targetInner.style.width = sw + 'px';
        saveStyle(targetInner, 'height');
        targetInner.style.height = sh + 'px';

        // Рендерим шапку отдельно, растягивая её на ширину всей сетки,
        // чтобы логотип был у правого края финального изображения
        saveStyle(headerEl, 'width');
        headerEl.style.width = sw + 'px';
        const headerCanvas: HTMLCanvasElement = await html2canvas(headerEl, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          width: sw,
          height: headerEl.scrollHeight,
          windowWidth: sw,
          windowHeight: headerEl.scrollHeight,
          scrollX: 0,
          scrollY: 0,
        });

        // Ещё один кадр — для перестроения SVG коннекторов под новые размеры
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

        // Рендерим всю сетку отдельно (полный размер)
        const bracketCanvas: HTMLCanvasElement = await html2canvas(targetInner, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          width: sw,
          height: sh,
          windowWidth: sw,
          windowHeight: sh,
          scrollX: 0,
          scrollY: 0,
        });

        // Собираем финальный холст: шапка + сетка + брендинг
        const footerBar = Math.round(60 * (window.devicePixelRatio || 2));
        const finalWidth = Math.max(headerCanvas.width, bracketCanvas.width);
        const finalHeight = headerCanvas.height + bracketCanvas.height + footerBar;
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = finalWidth;
        finalCanvas.height = finalHeight;
        const ctx = finalCanvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, finalWidth, finalHeight);
        ctx.drawImage(headerCanvas, 0, 0);
        ctx.drawImage(bracketCanvas, 0, headerCanvas.height);
        // Footer branding
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, finalHeight - footerBar, finalWidth, footerBar);
        ctx.fillStyle = '#000';
        ctx.font = 'bold 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('BeachPlay', 24, finalHeight - footerBar / 2);
        ctx.font = '600 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        const soon = 'скоро онлайн';
        const textWidth = ctx.measureText(soon).width;
        ctx.fillText(soon, finalWidth - 24 - textWidth, finalHeight - footerBar / 2);

        const dataUrl = finalCanvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `beachplay_knockout_${tMeta?.id || 'export'}.png`;
        document.body.appendChild(a); a.click(); a.remove();

        // Восстанавливаем стили
        restoreList.forEach(({ el, key, val }) => el.style.setProperty(key, val));
      } finally {
        // Вернём видимость
        excluded.forEach((el, i) => el.style.display = prev[i]);
        const exportOnly = Array.from(document.querySelectorAll('[data-export-only="true"]')) as HTMLElement[];
        exportOnly.forEach((el, i) => (el.style.display = prevOnly[i]));
      }
    } catch (e) {
      console.error('Export error:', e);
      alert('Не удалось подготовить изображение для поделиться');
    }
  };

  const loadDraw = useCallback(async () => {
    if (!tournamentId || !bracketId) return;
    setLoading(true);
    setError(null);
    try {
      // Добавляем timestamp для предотвращения кэширования
      const timestamp = Date.now();
      const resp = await tournamentApi.getBracketDraw(tournamentId, bracketId, timestamp);
      // Создаём новый объект для гарантированного обновления React
      setData({ ...resp } as BracketData);
      
      // Загрузить статус турнира для чекбокса "Зафиксировать"
      try {
        const tournament = await tournamentApi.getById(tournamentId);

        // Турнир в статусе created: только ORGANIZER/ADMIN видят сетку,
        // остальные (включая анонимов и REFEREE/REGISTERED) работают через страницу регистрации.
        // Не выполняем редирект, пока AuthContext ещё загружается, чтобы сразу после создания
        // организатора не отправляло на страницу регистрации.
        const isOrganizerOrAdmin = role === 'ADMIN' || role === 'ORGANIZER';
        if (!authLoading && tournament.status === 'created' && !isOrganizerOrAdmin) {
          navigate(`/tournaments/${tournamentId}/registration`);
          return;
        }

        setDragDropState(prev => ({
          ...prev,
          isSelectionLocked: tournament.status === 'active' || tournament.status === 'completed'
        }));

        // Сохранить метаданные турнира для проверки статуса
        setTMeta(tournament);
        // Инициализировать режим отображения имён один раз: по умолчанию ФИО,
        // исключение — турниры организатора ArtemPara (display_name по умолчанию)
        if (!showNamesInitializedRef.current) {
          const organizerUsername = (tournament as any).organizer_username;
          const useDisplayName = organizerUsername === 'ArtemPara';
          setShowFullNames(!useDisplayName);
          showNamesInitializedRef.current = true;
        }
      } catch (e) {
        console.error('Failed to load tournament status:', e);
      }
      
      // Загрузить BYE позиции (один раз на bracketId)
      try {
        if (bracketId && !byeLoadedRef.current[bracketId]) {
          const byeResp = await api.get(`/tournaments/${tournamentId}/brackets/${bracketId}/bye_positions/`);
          const byeData = byeResp.data;
          setByePositions(new Set(byeData.bye_positions || []));
          byeLoadedRef.current[bracketId] = true;
        }
      } catch (e) {
        console.error('Failed to load BYE positions:', e);
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Ошибка загрузки сетки');
    } finally {
      setLoading(false);
    }
  }, [tournamentId, bracketId]);

  // Загрузка участников турнира
  const loadParticipants = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const participantsList = await tournamentApi.getTournamentParticipants(tournamentId);
      const allParticipants: DraggableParticipant[] = participantsList
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          teamId: p.team_id,
          isInBracket: false, // будет обновлено при проверке слотов
          currentRating: typeof p.rating === 'number' ? p.rating : undefined,
          listStatus: p.list_status || 'main',
          registrationOrder: p.registration_order
        }));
      
      // Разделяем на основной и резервный списки
      const mainParticipants = allParticipants.filter(p => p.listStatus === 'main');
      const reserveParticipants = allParticipants.filter(p => p.listStatus === 'reserve');
      
      setDragDropState(prev => ({ 
        ...prev, 
        participants: allParticipants,
        mainParticipants,
        reserveParticipants
      }));
    } catch (error) {
      console.error('Failed to load participants:', error);
    }
  }, [tournamentId, canManageStructure]);

  // Инициализация drop slots при загрузке сетки
  useEffect(() => {
    if (data) {
      const dropSlots: DropSlot[] = [];
      
      data.rounds.forEach(round => {
        if (round.round_index === 0) { // Только первый раунд
          round.matches.forEach((match, idx) => {
            // Проверить, является ли позиция BYE
            // Позиция рассчитывается как: (order_in_round - 1) * 2 + 1 для team_1 и +2 для team_2
            // order_in_round начинается с 1, idx с 0
            const orderInRound = match.order_in_round || (idx + 1);
            const position1 = ((orderInRound - 1) * 2) + 1;
            const position2 = ((orderInRound - 1) * 2) + 2;
            const isBye1 = byePositions.has(position1);
            const isBye2 = byePositions.has(position2);
            
            const team1Participant = isBye1 ? {
              id: -1,
              name: 'BYE',
              isInBracket: true
            } : match.team_1 ? {
              id: match.team_1.id,
              name: match.team_1.name,
              isInBracket: true
            } : null;
            
            const team2Participant = isBye2 ? {
              id: -1,
              name: 'BYE',
              isInBracket: true
            } : match.team_2 ? {
              id: match.team_2.id,
              name: match.team_2.name,
              isInBracket: true
            } : null;
            
            dropSlots.push({
              matchId: match.id,
              slot: 'team_1',
              position: match.position_data.round_index * 100 + match.position_data.match_order * 2,
              currentParticipant: team1Participant
            });
            dropSlots.push({
              matchId: match.id,
              slot: 'team_2',
              position: match.position_data.round_index * 100 + match.position_data.match_order * 2 + 1,
              currentParticipant: team2Participant
            });
          });
        }
      });
      
      // Обновить статус isInBracket для участников
      setDragDropState(prev => {
        const teamsInSlots = new Set<number>();
        dropSlots.forEach(slot => {
          if (slot.currentParticipant && slot.currentParticipant.name !== 'BYE') {
            // slot.currentParticipant.id это team.id из match.team_1/team_2
            teamsInSlots.add(slot.currentParticipant.id);
          }
        });
        
        const updatedParticipants = prev.participants.map(p => ({
          ...p,
          isInBracket: teamsInSlots.has(p.teamId || 0)
        }));
        
        // Также обновляем mainParticipants и reserveParticipants
        const updatedMainParticipants = prev.mainParticipants?.map(p => ({
          ...p,
          isInBracket: teamsInSlots.has(p.teamId || 0)
        }));
        
        const updatedReserveParticipants = prev.reserveParticipants?.map(p => ({
          ...p,
          isInBracket: teamsInSlots.has(p.teamId || 0)
        }));
        
        return { 
          ...prev, 
          participants: updatedParticipants,
          mainParticipants: updatedMainParticipants,
          reserveParticipants: updatedReserveParticipants,
          dropSlots,
          // Не включаем фиксацию автоматически — пользователь делает это вручную
          isSelectionLocked: prev.isSelectionLocked
        };
      });
    }
  }, [data, byePositions]);

  useEffect(() => {
    (async () => {
      if (!tournamentId) return;

      let baseParticipants = 0;

      // 1. Загружаем метаданные турнира для шапки и проверки прав доступа
      try {
        const { data } = await api.get(`/tournaments/${tournamentId}/`);
        setTMeta(data);
        // planned_participants задаётся при создании стадии, participants_count — фактическое число
        baseParticipants = (data.planned_participants as number | undefined)
          || (data.participants_count as number | undefined)
          || 0;
      } catch (e: any) {
        const status = e?.response?.status;
        if (!user && status === 403) {
          setError('Завершённые турниры доступны только зарегистрированным пользователям. Пожалуйста, войдите в систему.');
        } else {
          setError(e?.response?.data?.error || 'Ошибка загрузки турнира');
        }
        return; // не продолжаем загрузку сетки/участников
      }

      // 1.5. Загружаем master-data для стадий (если это стадийный турнир)
      await loadMasterData();

      // 2. Загрузка участников (read-only для REGISTERED/гостей)
      await loadParticipants();

      // 3. Определяем/создаём bracketId
      if (!bracketId) {
        try {
          if (canManageStructure) {
            // Организатор / админ: можем создать (или получить существующую) сетку
            const size = computeBracketSize(baseParticipants || dragDropState.participants.length || 8);
            const resp = await tournamentApi.createKnockoutBracket(tournamentId, { size, has_third_place: true });
            const bid = resp?.bracket?.id;
            if (bid) {
              setBracketId(bid);
              setSearchParams(prev => {
                const sp = new URLSearchParams(prev);
                sp.set('bracket', String(bid));
                return sp;
              }, { replace: true });
            }
          } else {
            // REGISTERED / гость / REFEREE: только пытаемся получить уже существующую сетку
            const b = await tournamentApi.getDefaultBracket(tournamentId);
            if (b && b.id) {
              setBracketId(b.id);
              setSearchParams(prev => {
                const sp = new URLSearchParams(prev);
                sp.set('bracket', String(b.id));
                return sp;
              }, { replace: true });
            } else {
              setError('Сетка плей-офф ещё не создана организатором.');
              return;
            }
          }
        } catch (e: any) {
          setError(e?.response?.data?.error || 'Не удалось получить сетку');
          return;
        }
      } else {
        // bracketId уже есть в URL
        setSearchParams(prev => {
          const sp = new URLSearchParams(prev);
          sp.set('bracket', String(bracketId));
          return sp;
        }, { replace: true });
      }

      // 4. Загружаем сетку
      await loadDraw();
    })();
  }, [loadDraw, bracketId, tournamentId, loadParticipants, canManageStructure, setSearchParams, user, loadMasterData]);

  // createBracket/demos удалены — управление сетками теперь через бэк/модалку создания турнира
  // demoCreateSeed8 удалена

  // Обработчики Drag & Drop
  const handleDrop = useCallback(async (
    matchId: number,
    slot: 'team_1' | 'team_2',
    participant: DraggableParticipant
  ) => {
    if (!canManageStructure) return;
    // Блокировка для завершённых турниров
    if (tMeta?.status === 'completed') return;
    
    if (!tournamentId || !bracketId) return;

    // Проверка занятости слота
    const targetSlot = dragDropState.dropSlots.find(
      s => s.matchId === matchId && s.slot === slot
    );
    if (targetSlot?.currentParticipant) {
      // Проверить, не BYE ли это
      if (targetSlot.currentParticipant.name === 'BYE') {
        alert('Эта позиция зарезервирована для BYE и не может быть изменена.');
        return;
      }
      alert('Этот слот уже занят. Сначала удалите текущего участника.');
      return;
    }
    
    // Проверка дубликатов - участник уже в сетке
    const alreadyInBracket = dragDropState.dropSlots.some(
      s => s.currentParticipant?.id === participant.teamId
    );
    if (alreadyInBracket) {
      alert('Этот участник уже находится в сетке.');
      return;
    }

    try {
      // Оптимистичное обновление UI
      setDragDropState(prev => {
        const updatedDropSlots = prev.dropSlots.map(dropSlot =>
          dropSlot.matchId === matchId && dropSlot.slot === slot
            ? { ...dropSlot, currentParticipant: { id: participant.teamId!, name: participant.name, isInBracket: true } }
            : dropSlot
        );
        
        // Пересчитать isInBracket
        const participantsInSlots = new Set<number>();
        updatedDropSlots.forEach(s => {
          if (s.currentParticipant) {
            participantsInSlots.add(s.currentParticipant.id);
          }
        });
        
        const updatedParticipants = prev.participants.map(p => ({
          ...p,
          isInBracket: participantsInSlots.has(p.teamId || 0)
        }));
        
        return { ...prev, participants: updatedParticipants, dropSlots: updatedDropSlots };
      });

      // Сохранение на бэкенде (фиксация в DrawPosition/матче)
      await tournamentApi.addParticipantToBracket(
        tournamentId,
        bracketId,
        matchId,
        slot,
        participant.id // это TournamentEntry.id
      );

      // Перезагрузить сетку, чтобы подтянуть актуальные данные матчей из бэкенда
      await loadDraw();
    } catch (error) {
      console.error('Failed to add participant to bracket:', error);
      // Откат изменений
      setDragDropState(prev => {
        const updatedDropSlots = prev.dropSlots.map(dropSlot =>
          dropSlot.matchId === matchId && dropSlot.slot === slot
            ? { ...dropSlot, currentParticipant: null }
            : dropSlot
        );
        
        const participantsInSlots = new Set<number>();
        updatedDropSlots.forEach(s => {
          if (s.currentParticipant) {
            participantsInSlots.add(s.currentParticipant.id);
          }
        });
        
        const updatedParticipants = prev.participants.map(p => ({
          ...p,
          isInBracket: participantsInSlots.has(p.teamId || 0)
        }));
        
        return { ...prev, participants: updatedParticipants, dropSlots: updatedDropSlots };
      });
      alert('Не удалось добавить участника в сетку');
    }
  }, [tournamentId, bracketId, dragDropState.dropSlots, canManageStructure, loadDraw]);

  const handleRemoveFromSlot = useCallback(async (
    matchId: number,
    slot: 'team_1' | 'team_2'
  ) => {
    // Блокировка для завершённых турниров
    if (tMeta?.status === 'completed') return;
    
    if (!tournamentId || !bracketId) return;

    const slotToClear = dragDropState.dropSlots.find(
      s => s.matchId === matchId && s.slot === slot
    );
    if (!slotToClear?.currentParticipant) return;

    try {
      // Отправить запрос на backend для удаления участника из слота
      await tournamentApi.removeParticipantFromBracket(
        tournamentId,
        bracketId,
        matchId,
        slot
      );

      // Перезагрузить данные сетки для синхронизации
      await loadDraw();
      
      // Обновить статус участников
      setDragDropState(prev => {
        const participantsInSlots = new Set<number>();
        prev.dropSlots.forEach(s => {
          if (s.currentParticipant) {
            participantsInSlots.add(s.currentParticipant.id);
          }
        });
        
        const updatedParticipants = prev.participants.map(p => ({
          ...p,
          isInBracket: participantsInSlots.has(p.teamId || 0)
        }));
        
        return { ...prev, participants: updatedParticipants };
      });
    } catch (error) {
      console.error('Failed to remove participant from bracket:', error);
      alert('Не удалось удалить участника из сетки');
    }
  }, [tournamentId, bracketId, dragDropState.dropSlots]);

  const handleRemoveParticipant = useCallback(async (participantId: number) => {
    if (!canManageStructure) return;
    if (!tournamentId) return;
    
    try {
      // Удалить из БД
      await api.delete(`/tournaments/${tournamentId}/remove_participant/`, {
        data: { entry_id: participantId }
      });
      
      // Перезагрузить участников и сетку
      await loadParticipants();
      await loadDraw();
    } catch (error) {
      console.error('Failed to remove participant:', error);
      alert('Не удалось удалить участника');
    }
  }, [tournamentId, canManageStructure, loadParticipants, loadDraw]);

  const handleAddParticipant = useCallback(() => {
    if (!canManageStructure) return;
    setPickerOpen(true);
  }, [canManageStructure]);

  const handleParticipantSaved = useCallback(async () => {
    // Перезагрузить участников после добавления
    await loadParticipants();
    
    // Обновить isInBracket статус
    setDragDropState(prev => {
      const participantsInSlots = new Set<number>();
      prev.dropSlots.forEach(slot => {
        if (slot.currentParticipant) {
          participantsInSlots.add(slot.currentParticipant.id);
        }
      });
      
      const updatedParticipants = prev.participants.map(p => ({
        ...p,
        isInBracket: participantsInSlots.has(p.teamId || 0)
      }));
      
      return { ...prev, participants: updatedParticipants };
    });
  }, [loadParticipants]);

  // Получить список ID игроков, уже используемых в турнире
  const usedPlayerIds = useMemo(() => {
    const ids: number[] = [];
    dragDropState.participants.forEach(p => {
      if (p.teamId) {
        // Нужно извлечь player_1 и player_2 из команды
        // Пока упрощенно - добавим teamId
        ids.push(p.teamId);
      }
    });
    return ids;
  }, [dragDropState.participants]);

  const handleAutoSeed = useCallback(async () => {
    if (!canManageStructure) return;
    if (!tournamentId || !bracketId) return;
    try {
      await tournamentApi.seedBracket(tournamentId, bracketId);
      // Загружаем только сетку - useEffect автоматически обновит isInBracket для участников
      await loadDraw();
    } catch (error) {
      console.error('Failed to auto seed:', error);
      alert('Не удалось выполнить автопосев');
    }
  }, [tournamentId, bracketId, loadDraw, canManageStructure]);

  const handleClearBracket = useCallback(async () => {
    if (!canManageStructure) return;
    if (!tournamentId || !bracketId) return;
    
    if (!confirm('Вы уверены, что хотите очистить сетку? Все участники будут возвращены в левый список.')) {
      return;
    }
    
    try {
      // Удаляем всех участников из позиций сетки
      const drawPositions = dragDropState.dropSlots.filter(
        slot => slot.currentParticipant && slot.currentParticipant.name !== 'BYE'
      );
      
      for (const slot of drawPositions) {
        if (slot.currentParticipant) {
          await api.delete(`/tournaments/${tournamentId}/brackets/${bracketId}/remove_participant/`, {
            data: { 
              match_id: slot.matchId,
              slot: slot.slot
            }
          });
        }
      }
      
      // Перезагрузить данные
      await loadDraw();
      await loadParticipants();
    } catch (error) {
      console.error('Failed to clear bracket:', error);
      alert('Не удалось очистить сетку');
    }
  }, [tournamentId, bracketId, dragDropState.dropSlots, loadDraw, loadParticipants, canManageStructure]);

  // Подсчет реальных участников в сетке (не BYE)
  const participantsInBracket = useMemo(() => {
    return dragDropState.dropSlots.filter(
      slot => slot.currentParticipant !== null && slot.currentParticipant.name !== 'BYE'
    ).length;
  }, [dragDropState.dropSlots]);

  // Подсчет свободных мест в сетке
  const freeSlotsInBracket = useMemo(() => {
    const plannedParticipants = tMeta?.planned_participants || 0;
    return Math.max(0, plannedParticipants - participantsInBracket);
  }, [participantsInBracket, tMeta?.planned_participants]);

  // Проверка: есть ли свободные места в сетке
  const hasUnplacedParticipants = useMemo(() => {
    return freeSlotsInBracket > 0;
  }, [freeSlotsInBracket]);

  // Загрузка форматов и регламентов для модального окна редактирования
  useEffect(() => {
    const loadFormatsAndRulesets = async () => {
      try {
        const [formatsResp, rulesets] = await Promise.all([
          api.get('/set-formats/'),
          tournamentApi.getRulesets('knockout')
        ]);
        setSetFormats(formatsResp.data.set_formats || []);
        setKoRulesets(rulesets);
      } catch (e) {
        console.error('Ошибка загрузки форматов и регламентов:', e);
      }
    };
    loadFormatsAndRulesets();
  }, []);

  const handleEditSettings = () => {
    setShowEditModal(true);
  };

  const handleEditSettingsSubmit = async (payload: any) => {
    if (!tMeta) return;
    try {
      setSaving(true);
      const updated = await tournamentApi.editSettings(tMeta.id, payload);
      setShowEditModal(false);
      // Полный редирект для перезагрузки данных
      window.location.href = `/tournaments/${updated.id}/knockout`;
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Не удалось изменить настройки турнира');
    } finally {
      setSaving(false);
    }
  };

  // Проверка: все ли участники размещены в сетке
  const allParticipantsInBracket = useMemo(() => {
    if (dragDropState.participants.length === 0) return false;
    
    // Подсчитать сколько участников в слотах (исключая BYE)
    const participantsInSlots = dragDropState.dropSlots.filter(
      slot => slot.currentParticipant !== null && slot.currentParticipant.name !== 'BYE'
    ).length;
    
    // Подсчитать сколько BYE слотов
    const byeSlots = dragDropState.dropSlots.filter(
      slot => slot.currentParticipant?.name === 'BYE'
    ).length;
    
    // Для олимпийской системы нужно заполнить все слоты первого раунда (кроме BYE)
    const firstRoundSlots = dragDropState.dropSlots.length;
    const requiredSlots = firstRoundSlots - byeSlots;
    
    return participantsInSlots === requiredSlots && requiredSlots > 0;
  }, [dragDropState.participants, dragDropState.dropSlots]);

  // Обработчик фиксации участников
  const handleLockParticipants = useCallback(async (locked: boolean) => {
    if (!canManageStructure) return;
    // Блокировка для завершённых турниров
    if (tMeta?.status === 'completed') return;
    
    if (!tournamentId || !bracketId) return;

    if (locked) {
      // Фиксация: отправить данные на backend
      try {
        // Найти participant_id (entry_id) по teamId
        const slotsData = dragDropState.dropSlots.map(slot => {
          let participantId = null;
          if (slot.currentParticipant) {
            const participant = dragDropState.participants.find(
              p => p.teamId === slot.currentParticipant!.id
            );
            participantId = participant?.id || null;
          }
          
          return {
            match_id: slot.matchId,
            slot: slot.slot,
            participant_id: participantId
          };
        });

        await api.post(`/tournaments/${tournamentId}/brackets/${bracketId}/lock_participants/`, { slots: slotsData });

        setDragDropState(prev => ({ ...prev, isSelectionLocked: true }));
        await loadDraw();
      } catch (error) {
        console.error('Failed to lock participants:', error);
        alert('Не удалось зафиксировать участников');
      }
    } else {
      // Снятие фиксации - обновить статус участников и изменить статус турнира на created
      try {
        await tournamentApi.unlockBracketParticipants(tournamentId, bracketId);
        
        setDragDropState(prev => {
          const participantsInSlots = new Set<number>();
          prev.dropSlots.forEach(slot => {
            if (slot.currentParticipant) {
              participantsInSlots.add(slot.currentParticipant.id);
            }
          });
          
          const updatedParticipants = prev.participants.map(p => ({
            ...p,
            isInBracket: participantsInSlots.has(p.teamId || 0)
          }));
          
          return { ...prev, participants: updatedParticipants, isSelectionLocked: false };
        });
      } catch (error) {
        console.error('Failed to unlock participants:', error);
        alert('Не удалось снять фиксацию участников');
      }
    }
  }, [tournamentId, bracketId, dragDropState.dropSlots, loadDraw, canManageStructure]);

  const handleMatchClick = useCallback((matchId: number) => {
    if (!canManageMatches) return;
    // Блокировка для завершённых турниров
    if (tMeta?.status === 'completed') return;
    
    if (!data || dragDropState.isSelectionLocked === false) return;
    
    const all = data.rounds.flatMap((r) => r.matches);
    const m = all.find((x) => x.id === matchId);
    if (!m) return;
    
    // Проверка: оба участника должны быть известны (не BYE)
    if (!m.team_1 || !m.team_2) return;
    
    setMatchActionDialog({
      isOpen: true,
      matchId: m.id,
      matchStatus: m.status as 'scheduled' | 'live' | 'completed',
      matchTitle: `${m.team_1?.name || 'TBD'} vs ${m.team_2?.name || 'TBD'}`
    });
  }, [data, dragDropState.isSelectionLocked, tMeta, canManageMatches]);

  const handleStartMatch = useCallback(async () => {
    if (!canManageMatches) return;
    // Блокировка для завершённых турниров
    if (tMeta?.status === 'completed') return;
    
    if (!tournamentId || !matchActionDialog.matchId) return;
    
    try {
      await matchApi.startMatch(tournamentId, matchActionDialog.matchId);
      await loadDraw();
    } catch (error) {
      console.error('Failed to start match:', error);
      alert('Не удалось начать матч');
    }
  }, [tournamentId, matchActionDialog.matchId, loadDraw, tMeta, canManageMatches]);

  const handleCancelMatch = useCallback(async () => {
    if (!canManageMatches) return;
    // Блокировка для завершённых турниров
    if (tMeta?.status === 'completed') return;
    
    if (!tournamentId || !matchActionDialog.matchId) return;
    
    try {
      // Для completed матчей используем специальный endpoint для удаления результата
      if (matchActionDialog.matchStatus === 'completed') {
        await matchApi.resetMatch(tournamentId, matchActionDialog.matchId);
      } else {
        // Для live матчей просто отменяем
        await matchApi.cancelMatch(tournamentId, matchActionDialog.matchId);
      }
      await loadDraw();
    } catch (error) {
      console.error('Failed to cancel match:', error);
      alert('Не удалось отменить матч');
    }
  }, [tournamentId, matchActionDialog.matchId, matchActionDialog.matchStatus, loadDraw, tMeta, canManageMatches]);

  const handleEnterScore = useCallback(() => {
    if (!canManageMatches) return;
    // Блокировка для завершённых турниров
    if (tMeta?.status === 'completed') return;
    
    if (!data || !matchActionDialog.matchId) return;
    
    const all = data.rounds.flatMap((r) => r.matches);
    const m = all.find((x) => x.id === matchActionDialog.matchId);
    if (!m || !m.team_1 || !m.team_2) return;
    
    // Открыть модальное окно ввода счёта с сохранением matchId
    setScoreModal({
      open: true,
      matchId: m.id,
      team1: { id: m.team_1.id, name: m.team_1.full_name || m.team_1.name },
      team2: { id: m.team_2.id, name: m.team_2.full_name || m.team_2.name },
    });
  }, [data, matchActionDialog.matchId, tMeta, canManageMatches]);
  
  const handleSaveScore = useCallback(async (
    winnerTeamId: number,
    loserTeamId: number,
    gamesWinner: number,
    gamesLoser: number
  ) => {
    // Блокировка для завершённых турниров
    if (tMeta?.status === 'completed') return;
    
    if (!scoreModal.matchId) {
      console.error('No match ID in scoreModal');
      alert('Ошибка: ID матча не найден');
      return;
    }
    
    await matchApi.savePlayoffScore(
      tournamentId,
      scoreModal.matchId,
      winnerTeamId,
      loserTeamId,
      gamesWinner,
      gamesLoser
    );
    await loadDraw();
  }, [tournamentId, scoreModal.matchId, loadDraw, tMeta]);

  return (
    <div className="knockout-page-container" ref={exportRef}>
      {/* Шапка */}
      <div style={{ position: 'relative', padding: '16px 16px 8px 16px', borderBottom: '1px solid #eee', background: '#fff' }}>
        <img src="/static/img/logo.png" alt="BeachPlay" style={{ position: 'absolute', right: 16, top: 16, height: 40 }} />
        {/* 1-я строка: имя турнира */}
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 2 }}>{tMeta?.name || 'Плей-офф'}</div>
        {/* 2-я строка: дата, система, формат, организатор */}
        <div className="meta" style={{ color: '#666', fontSize: 14 }}>
          {tMeta && (
            <>
              {tMeta.date ? formatDate(tMeta.date) : ''}
              {tMeta.get_system_display ? ` • ${tMeta.get_system_display}` : ''}
              {tMeta.get_participant_mode_display ? ` • ${tMeta.get_participant_mode_display}` : ''}
              {tMeta.organizer_name ? ` • Организатор: ${tMeta.organizer_name}` : ''}
            </>
          )}
        </div>
        {/* 3-я строка: статус, число участников, средний рейтинг, коэффициент, призовой фонд */}
        <div style={{ color: '#777', fontSize: 12, marginTop: 2 }}>
          {tMeta && (
            <>
              Статус: {tMeta.status === 'created' ? 'Регистрация' : tMeta.status === 'active' ? 'Идёт' : 'Завершён'}
              {typeof tMeta.participants_count === 'number' ? ` • Участников: ${tMeta.participants_count}` : ''}
              {tMeta.status !== 'created' && typeof tMeta.avg_rating_bp === 'number' ? ` • средний рейтинг турнира по BP: ${Math.round(tMeta.avg_rating_bp)}` : ''}
              {tMeta.status !== 'created' && typeof tMeta.rating_coefficient === 'number' ? ` • Коэффициент турнира: ${tMeta.rating_coefficient.toFixed(1)}` : ''}
              {tMeta.prize_fund ? ` • Призовой фонд: ${tMeta.prize_fund}` : ''}
            </>
          )}
        </div>

        {/* Переключатель стадий для многостадийных турниров */}
        {stages && stages.length > 1 && (
          <div style={{ marginTop: 8 }}>
            <TournamentStageSelector
              stages={stages}
              currentStageId={currentStageId ?? tournamentId}
              canEdit={canManageStructure}
              onStageChange={handleStageChange}
            />
          </div>
        )}
      </div>

      {/* Основной контент с раздельным скроллом */}
      <div className="knockout-content">
        {/* Левая панель с участниками */}
        {!dragDropState.isSelectionLocked && (
        <div className="participants-panel" data-export-exclude="true">
          <DraggableParticipantList
            participants={dragDropState.participants}
            mainParticipants={dragDropState.mainParticipants}
            reserveParticipants={dragDropState.reserveParticipants}
            onRemoveParticipant={handleRemoveParticipant}
            onAddParticipant={() => setPickerOpen(true)}
            onAddFromPreviousStage={tMeta?.parent_tournament ? () => setShowAddFromStageModal(true) : undefined}
            onAutoSeed={handleAutoSeed}
            onClearTables={handleClearBracket}
            maxParticipants={tMeta?.planned_participants || 32}
            canAddMore={true}
            tournamentSystem="knockout"
            isStage={!!tMeta?.parent_tournament}
          />
        </div>
        )}

        {/* Правая панель с сеткой */}
        <div className="bracket-panel" style={{ width: dragDropState.isSelectionLocked ? '100%' : undefined }} ref={bracketExportRef} data-export-exclude="true">
          {/* Панель управления сеткой */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }} data-export-exclude="true">
            <button 
              className="btn" 
              disabled={!bracketId} 
              onClick={() => setShowFullNames(!showFullNames)}
            >
              {showFullNames ? 'Отображаемое имя' : 'ФИО показать'}
            </button>
          </div>

          {loading && <div>Загрузка...</div>}
          {error && <div style={{ color: 'red' }}>{error}</div>}

          {data && (
            <BracketWithSVGConnectors
              data={data}
              dropSlots={dragDropState.dropSlots}
              onDrop={handleDrop}
              onRemoveFromSlot={handleRemoveFromSlot}
              isLocked={dragDropState.isSelectionLocked}
              showFullNames={showFullNames}
              onMatchClick={handleMatchClick}
              byePositions={byePositions}
            />
          )}

          {/* Чекбокс фиксации участников под сеткой */}
          {canManageStructure && tMeta?.status === 'created' && !dragDropState.isSelectionLocked && (
            <div style={{ marginTop: 16, padding: '12px', background: '#f8f9fa', borderRadius: 4 }} data-export-exclude="true">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: hasUnplacedParticipants ? 'not-allowed' : 'pointer', opacity: hasUnplacedParticipants ? 0.6 : 1 }}>
                <input
                  type="checkbox"
                  checked={false}
                  disabled={hasUnplacedParticipants}
                  onChange={(e) => {
                    if (e.target.checked) {
                      handleLockParticipants(true);
                    }
                  }}
                />
                <span style={{ fontWeight: 500 }}>Зафиксировать участников и сгенерировать расписание</span>
              </label>
              <p style={{ margin: '8px 0 0 28px', fontSize: 13, color: '#666' }}>
                {hasUnplacedParticipants
                  ? `Все участники должны быть размещены в сетке. Осталось разместить: ${freeSlotsInBracket}`
                  : `В сетке размещено ${participantsInBracket} из ${tMeta?.planned_participants || 0} участников. Вы можете зафиксировать участников и начать турнир.`}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Диалог действий с матчем */}
      <MatchActionDialog
        isOpen={matchActionDialog.isOpen}
        onClose={() => setMatchActionDialog({ isOpen: false, matchId: null, matchStatus: 'scheduled' })}
        matchStatus={matchActionDialog.matchStatus}
        onStartMatch={handleStartMatch}
        onCancelMatch={handleCancelMatch}
        onEnterScore={handleEnterScore}
        matchTitle={matchActionDialog.matchTitle}
      />
      
      {/* Модальное окно ввода счёта */}
      {scoreModal.open && (tMeta as any)?.set_format?.games_to === 0 && (tMeta as any)?.set_format?.max_sets !== 1 && scoreModal.team1 && scoreModal.team2 && (
        <FreeFormatScoreModal
          match={{
            id: scoreModal.matchId || 0,
            team_1: {
              id: scoreModal.team1.id,
              name: scoreModal.team1.name,
              display_name: scoreModal.team1.name
            },
            team_2: {
              id: scoreModal.team2.id,
              name: scoreModal.team2.name,
              display_name: scoreModal.team2.name
            },
            sets: []
          }}
          tournament={tMeta}
          onClose={() => setScoreModal({ open: false, matchId: null, team1: null, team2: null })}
          onSave={async (sets) => {
            if (tMeta?.status === 'completed') return;
            if (!scoreModal.matchId) return;
            
            // Преобразуем данные для API
            const setsToSend = sets
              .filter(s => s.custom_enabled || s.champion_tb_enabled)
              .map(s => {
                if (s.champion_tb_enabled) {
                  // Для чемпионского TB: очки из games_1/games_2 переносим в tb_1/tb_2
                  return {
                    index: s.index,
                    games_1: 0,
                    games_2: 0,
                    tb_1: s.games_1,
                    tb_2: s.games_2,
                    is_tiebreak_only: true
                  };
                } else {
                  // Обычный сет
                  return {
                    index: s.index,
                    games_1: s.games_1,
                    games_2: s.games_2,
                    tb_1: s.tb_enabled && s.tb_loser_points !== null ? (s.games_1 > s.games_2 ? null : null) : null,
                    tb_2: s.tb_enabled && s.tb_loser_points !== null ? (s.games_1 > s.games_2 ? null : null) : null,
                    is_tiebreak_only: false
                  };
                }
              });
            
            await matchApi.savePlayoffScoreFull(
              tournamentId,
              scoreModal.matchId,
              setsToSend
            );
            await loadDraw();
            setScoreModal({ open: false, matchId: null, team1: null, team2: null });
          }}
        />
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
            <textarea
              readOnly
              value={announcementText}
              style={{ width: '100%', height: 260, resize: 'vertical', marginTop: 8, whiteSpace: 'pre' }}
            />
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
                    onChange={() => setAnnouncementSettings(prev => prev ? { ...prev, announcement_mode: 'edit_single' } : prev)}
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
                    onChange={() => setAnnouncementSettings(prev => prev ? { ...prev, announcement_mode: 'new_messages' } : prev)}
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
      
      {scoreModal.open && ((tMeta as any)?.set_format?.games_to !== 0 || (tMeta as any)?.set_format?.max_sets === 1) && (
        <MatchScoreModal
          isOpen={scoreModal.open}
          onClose={() => setScoreModal({ open: false, matchId: null, team1: null, team2: null })}
          onSave={handleSaveScore}
          setFormat={(tMeta as any)?.set_format}
          onSaveFull={async (sets) => {
            if (tMeta?.status === 'completed') return;
            if (!scoreModal.matchId) return;
            await matchApi.savePlayoffScoreFull(
              tournamentId,
              scoreModal.matchId,
              sets
            );
            await loadDraw();
            setScoreModal({ open: false, matchId: null, team1: null, team2: null });
          }}
          team1={scoreModal.team1}
          team2={scoreModal.team2}
        />
      )}

      {/* Нижние общие кнопки */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start', padding: '16px', borderTop: '1px solid #eee' }} data-export-exclude="true">
        {canManageStructure && tMeta?.status === 'created' && (
          <button className="btn" disabled={saving} onClick={handleEditSettings}>Поменять настройки турнира</button>
        )}
        {canManageStructure && tMeta?.status === 'active' && (
          <button className="btn" disabled={saving || !tMeta} onClick={() => navigate(`/tournaments/${tMeta.id}/schedule`)}>
            Расписание
          </button>
        )}
        {canManageStructure && tMeta?.status === 'active' && canAddStage && (
          <button
            className="btn"
            style={{ background: '#28a745', borderColor: '#28a745' }}
            onClick={() => setShowCreateStageModal(true)}
          >
            Добавить стадию
          </button>
        )}
        {canManageStructure && tMeta?.status === 'active' && (
          <button className="btn" disabled={saving || !tMeta} onClick={handleCompleteTournamentClick}>
            Завершить турнир
          </button>
        )}
        {canDeleteTournament && (
          <button className="btn" disabled={saving || !tMeta} onClick={async () => {
            if (!tMeta || !canDeleteTournament || !window.confirm(`Удалить турнир "${tMeta.name}"?`)) return;
            setSaving(true);
            try {
              await tournamentApi.delete(tMeta.id);
              alert('Турнир удалён');
              window.location.href = '/tournaments';
            } catch (e) {
              console.error(e);
              alert('Ошибка удаления');
            } finally {
              setSaving(false);
            }
          }} style={{ background: '#dc3545', borderColor: '#dc3545' }}>Удалить турнир</button>
        )}
        {canManageStructure && tMeta?.status === 'active' && (
          <button
            className="btn"
            onClick={async () => {
              if (!tMeta) return;
              try {
                setSaving(true);
                await tournamentApi.unlockParticipants(tMeta.id);
                window.location.reload();
              } catch (error: any) {
                console.error('Failed to unlock participants:', error);
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
        {canManageStructure && tMeta?.has_zero_rating_players && tMeta?.status !== 'completed' && (
          <button
            className="btn"
            disabled={saving}
            onClick={() => setShowInitialRatingModal(true)}
          >
            Присвоить стартовый рейтинг
          </button>
        )}
        {role !== 'REFEREE' && (
          <>
            <button className="btn" disabled={saving} onClick={handleShare}>Поделиться</button>
            {tMeta && canManageStructure && (
              <button
                className="btn"
                type="button"
                disabled={loadingAnnouncement}
                onClick={handleShowAnnouncementText}
              >
                Текст анонса
              </button>
            )}
            {tMeta && canManageStructure && tMeta.status === 'created' && (
              <button
                className="btn"
                type="button"
                disabled={loadingAnnouncementSettings}
                onClick={handleOpenAnnouncementSettings}
              >
                Настройка авто-анонсов
              </button>
            )}
            {tMeta && tMeta.status === 'completed' && (
              <button
                className="btn"
                type="button"
                disabled={loadingTextResults}
                onClick={handleShowTextResults}
              >
                Результаты текстом
              </button>
            )}
            {tMeta && tMeta.status === 'completed' && role === 'ADMIN' && (
              <button
                className="btn"
                type="button"
                disabled={saving}
                onClick={handleRollbackTournamentCompletion}
                style={{ background: '#dc3545', borderColor: '#dc3545' }}
              >
                Откатить завершение турнира
              </button>
            )}
          </>
        )}
      </div>

      {/* Контейнер для экспорта: скрыт на странице, показывается только при экспорте */}
      <div data-export-only="true" data-bracket-export="true" style={{ display: 'none', padding: '16px', backgroundColor: '#fff' }}>
        {data && (
          <BracketWithSVGConnectors
            data={data}
            dropSlots={[]}
            onDrop={() => {}}
            onRemoveFromSlot={() => {}}
            isLocked={true}
            showFullNames={showFullNames}
            onMatchClick={() => {}}
            byePositions={byePositions}
          />
        )}
      </div>

      {/* Нижний DOM-футер для экспорта: скрыт на странице, показывается только при экспортe */}
      <div data-export-only="true" style={{ padding: '12px 24px 20px 24px', borderTop: '1px solid #eee', display: 'none', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14 }}>BeachPlay</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>скоро онлайн</div>
      </div>

      {/* Модальное окно выбора участника */}
      <KnockoutParticipantPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        tournamentId={tournamentId}
        isDoubles={tMeta?.participant_mode === 'doubles'}
        usedPlayerIds={usedPlayerIds}
        onSaved={handleParticipantSaved}
      />

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

      {/* Модалка редактирования настроек турнира */}
      {showEditModal && tMeta && (
        <EditTournamentModal
          tournament={tMeta}
          setFormats={setFormats}
          rulesets={koRulesets}
          onSubmit={handleEditSettingsSubmit}
          onClose={() => setShowEditModal(false)}
        />
      )}

      {tMeta && showInitialRatingModal && (
        <InitialRatingModal
          tournamentId={tMeta.id}
          open={showInitialRatingModal}
          onClose={() => setShowInitialRatingModal(false)}
          onApplied={async () => {
            setShowInitialRatingModal(false);
            window.location.reload();
          }}
        />
      )}

      {/* Модалка добавления участников из предыдущей стадии */}
      {showAddFromStageModal && tMeta?.parent_tournament && (
        <AddParticipantsFromStageModal
          isOpen={showAddFromStageModal}
          onClose={() => setShowAddFromStageModal(false)}
          tournamentId={tMeta.id}
          parentTournamentId={tMeta.parent_tournament}
          currentParticipantIds={dragDropState.participants
            .map(p => p.teamId)
            .filter((id): id is number => id !== undefined)}
          onSave={handleSaveParticipantsFromStage}
        />
      )}

      {/* Модалка незавершенных матчей */}
      <IncompleteMatchesModal
        isOpen={showIncompleteMatchesModal}
        onClose={() => setShowIncompleteMatchesModal(false)}
        onConfirm={() => {
          setShowIncompleteMatchesModal(false);
          // Проверяем игроков без рейтинга
          if (tMeta?.has_zero_rating_players) {
            setShowCompleteRatingChoice(true);
          } else {
            completeTournamentInternal(true); // force = true
          }
        }}
        incompleteMatches={incompleteMatches}
      />

      {/* Диалог выбора способа завершения турнира при наличии игроков без рейтинга */}
      {showCompleteRatingChoice && tMeta && (
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
                  completeTournamentInternal(incompleteMatches.length > 0);
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

      {/* Модалка создания стадии */}
      {showCreateStageModal && tMeta && masterSystem && (
        <CreateStageModal
          isOpen={showCreateStageModal}
          onClose={() => setShowCreateStageModal(false)}
          tournamentId={tMeta.id}
          masterSystem={masterSystem}
          masterParticipantMode={tMeta.participant_mode as 'singles' | 'doubles'}
          parentStageName={tMeta.stage_name || null}
          parentPlannedParticipants={tMeta.planned_participants || undefined}
          parentGroupsCount={undefined}
          parentDate={tMeta.date ? tMeta.date : undefined}
          parentStartTime={(tMeta as any).start_time || null}
          parentIsRatingCalc={tMeta.is_rating_calc ?? true}
          parentSetFormatId={(tMeta as any).set_format?.id || undefined}
          currentParticipants={[]}
          setFormats={[]}
          onStageCreated={async (stageId) => {
            setShowCreateStageModal(false);
            if (stageId) {
              navigate(`/tournaments/${stageId}/knockout`);
            }
          }}
        />
      )}
    </div>
  );
};
