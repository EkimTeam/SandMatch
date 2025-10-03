import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BracketData } from '../types/bracket';
import { BracketWithSVGConnectors } from '../components/BracketWithSVGConnectors';
import { DraggableParticipantList } from '../components/DraggableParticipantList';
import { KnockoutParticipantPicker } from '../components/KnockoutParticipantPicker';
import { tournamentApi, matchApi } from '../services/api';
import { formatDate } from '../services/date';
import { DraggableParticipant, DropSlot, DragDropState } from '../types/dragdrop';
import { MatchActionDialog } from '../components/MatchActionDialog';
import { MatchScoreModal } from '../components/MatchScoreModal';
import '../styles/knockout-dragdrop.css';

export const KnockoutPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
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

  // Состояние для Drag & Drop
  const [dragDropState, setDragDropState] = useState<DragDropState>({
    participants: [],
    dropSlots: [],
    isSelectionLocked: false
  });

  // Модальное окно выбора участника
  const [pickerOpen, setPickerOpen] = useState(false);
  
  // Позиции BYE (блокированные для drag-and-drop)
  const [byePositions, setByePositions] = useState<Set<number>>(new Set());
  // Гард от двойных вызовов в StrictMode: сохраняем, для какого bracketId уже грузили BYE
  const byeLoadedRef = useRef<Record<number, boolean>>({});
  
  // Переключатель отображения имён (display_name vs Фамилия Имя)
  const [showFullNames, setShowFullNames] = useState(false);
  
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
        ctx.fillText('SandMatch', 24, finalHeight - footerBar / 2);
        ctx.font = '600 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        const soon = 'скоро онлайн';
        const textWidth = ctx.measureText(soon).width;
        ctx.fillText(soon, finalWidth - 24 - textWidth, finalHeight - footerBar / 2);

        const dataUrl = finalCanvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `sandmatch_knockout_${tMeta?.id || 'export'}.png`;
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
      const resp = await tournamentApi.getBracketDraw(tournamentId, bracketId);
      // Создаём новый объект для гарантированного обновления React
      setData({ ...resp } as BracketData);
      
      // Загрузить статус турнира для чекбокса "Зафиксировать"
      try {
        const tournament = await tournamentApi.getById(tournamentId);
        setDragDropState(prev => ({
          ...prev,
          isSelectionLocked: tournament.status === 'active' || tournament.status === 'completed'
        }));
        
        // Сохранить метаданные турнира для проверки статуса
        setTMeta(tournament);
      } catch (e) {
        console.error('Failed to load tournament status:', e);
      }
      
      // Загрузить BYE позиции (один раз на bracketId)
      try {
        if (bracketId && !byeLoadedRef.current[bracketId]) {
          const byeResp = await fetch(`/api/tournaments/${tournamentId}/brackets/${bracketId}/bye_positions/`);
          if (byeResp.ok) {
            const byeData = await byeResp.json();
            setByePositions(new Set(byeData.bye_positions || []));
            byeLoadedRef.current[bracketId] = true;
          } else {
            // Попробуем прочитать текст ошибки для диагностики
            let msg = 'Не удалось загрузить BYE позиции';
            try { const err = await byeResp.json(); msg = err?.error || msg; } catch {}
            console.warn(msg);
          }
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
      const participants: DraggableParticipant[] = participantsList
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          teamId: p.team_id,
          isInBracket: false // будет обновлено при проверке слотов
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')); // Сортировка по имени
      
      setDragDropState(prev => ({ ...prev, participants }));
    } catch (error) {
      console.error('Failed to load participants:', error);
    }
  }, [tournamentId]);

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
        const participantsInSlots = new Set<number>();
        dropSlots.forEach(slot => {
          if (slot.currentParticipant) {
            participantsInSlots.add(slot.currentParticipant.id);
          }
        });
        
        const updatedParticipants = prev.participants.map(p => ({
          ...p,
          isInBracket: participantsInSlots.has(p.teamId || 0)
        }));
        
        return { 
          ...prev, 
          participants: updatedParticipants,
          dropSlots,
          // Не включаем фиксацию автоматически — пользователь делает это вручную
          isSelectionLocked: prev.isSelectionLocked
        };
      });
    }
  }, [data]);

  useEffect(() => {
    // загрузим метаданные турнира для шапки
    (async () => {
      if (!tournamentId) return;
      try {
        const resp = await fetch(`/api/tournaments/${tournamentId}/`);
        if (resp.ok) {
          const j = await resp.json();
          setTMeta(j);
        }
      } catch {}
    })();
    loadParticipants();
    // Если bracketId не задан в URL — попробуем создать/получить его автоматически
    (async () => {
      if (!tournamentId) return;
      if (!bracketId) {
        try {
          const resp = await tournamentApi.createKnockoutBracket(tournamentId, { size: 8, has_third_place: true });
          const bid = resp?.bracket?.id;
          if (bid) {
            setBracketId(bid);
            setSearchParams(prev => {
              const sp = new URLSearchParams(prev);
              sp.set('bracket', String(bid));
              return sp;
            }, { replace: true });
          }
        } catch (e: any) {
          setError(e?.response?.data?.error || 'Не удалось получить сетку');
        }
      } else {
        // bracketId уже есть в URL
        setSearchParams(prev => {
          const sp = new URLSearchParams(prev);
          sp.set('bracket', String(bracketId));
          return sp;
        }, { replace: true });
      }
      await loadDraw();
    })();
  }, [loadDraw, bracketId, tournamentId, loadParticipants]);

  // createBracket/demos удалены — управление сетками теперь через бэк/модалку создания турнира
  // demoCreateSeed8 удалена

  // Обработчики Drag & Drop
  const handleDrop = useCallback(async (
    matchId: number,
    slot: 'team_1' | 'team_2',
    participant: DraggableParticipant
  ) => {
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

      // TODO: Сохранение на бэкенде
      // await tournamentApi.addParticipantToBracket(tournamentId, bracketId, matchId, slot, participant.id);
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
  }, [tournamentId, bracketId, dragDropState.dropSlots]);

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
      // Отправить запрос на backend для удаления из матча
      const response = await fetch(`/api/tournaments/${tournamentId}/brackets/${bracketId}/remove_from_slot/`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: matchId, slot })
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || 'Не удалось удалить участника из слота');
        return;
      }

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
    if (!tournamentId) return;
    
    try {
      // Удалить из БД
      const response = await fetch(`/api/tournaments/${tournamentId}/remove_participant/`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_id: participantId })
      });
      
      if (!response.ok) {
        const data = await response.json();
        alert(data.error || 'Не удалось удалить участника');
        return;
      }
      
      // Обновить UI
      setDragDropState(prev => ({
        ...prev,
        participants: prev.participants.filter(p => p.id !== participantId)
      }));
    } catch (error) {
      console.error('Failed to remove participant:', error);
      alert('Не удалось удалить участника');
    }
  }, [tournamentId]);

  const handleAddParticipant = useCallback(() => {
    setPickerOpen(true);
  }, []);

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
    if (!tournamentId || !bracketId) return;
    try {
      await tournamentApi.seedBracket(tournamentId, bracketId);
      await loadDraw();
      await loadParticipants();
    } catch (error) {
      console.error('Failed to auto seed:', error);
      alert('Не удалось выполнить автопосев');
    }
  }, [tournamentId, bracketId, loadDraw, loadParticipants]);

  const canAddMoreParticipants = useMemo(() => {
    return dragDropState.participants.length < (tMeta?.planned_participants || 32);
  }, [dragDropState.participants.length, tMeta?.planned_participants]);

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

        const response = await fetch(`/api/tournaments/${tournamentId}/brackets/${bracketId}/lock_participants/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slots: slotsData })
        });

        if (!response.ok) {
          const data = await response.json();
          alert(data.error || 'Не удалось зафиксировать участников');
          return;
        }

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
  }, [tournamentId, bracketId, dragDropState.dropSlots, loadDraw]);

  const handleMatchClick = useCallback((matchId: number) => {
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
  }, [data, dragDropState.isSelectionLocked, tMeta]);

  const handleStartMatch = useCallback(async () => {
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
  }, [tournamentId, matchActionDialog.matchId, loadDraw, tMeta]);

  const handleCancelMatch = useCallback(async () => {
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
  }, [tournamentId, matchActionDialog.matchId, matchActionDialog.matchStatus, loadDraw, tMeta]);

  const handleEnterScore = useCallback(() => {
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
  }, [data, matchActionDialog.matchId, tMeta]);
  
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
        <img src="/static/img/logo.png" alt="SandMatch" style={{ position: 'absolute', right: 16, top: 16, height: 40 }} />
        <div style={{ fontSize: 24, fontWeight: 700 }}>{tMeta?.name || 'Плей-офф'}</div>
        <div className="meta" style={{ color: '#666' }}>
          {tMeta ? `${formatDate(tMeta.date)} • ${tMeta.get_system_display} • ${tMeta.get_participant_mode_display}` : ''}
        </div>
      </div>

      {/* Основной контент с раздельным скроллом */}
      <div className="knockout-content">
        {/* Левая панель с участниками */}
        {!dragDropState.isSelectionLocked && (
        <div className="participants-panel" data-export-exclude="true">
          <DraggableParticipantList
            participants={dragDropState.participants}
            onRemoveParticipant={handleRemoveParticipant}
            onAddParticipant={() => setPickerOpen(true)}
            onAutoSeed={handleAutoSeed}
            maxParticipants={tMeta?.planned_participants || 32}
            canAddMore={canAddMoreParticipants}
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
            
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: (allParticipantsInBracket || dragDropState.isSelectionLocked) && tMeta?.status !== 'completed' ? 'pointer' : 'not-allowed', opacity: (allParticipantsInBracket || dragDropState.isSelectionLocked) && tMeta?.status !== 'completed' ? 1 : 0.5 }}>
                <input
                  type="checkbox"
                  checked={dragDropState.isSelectionLocked}
                  disabled={tMeta?.status === 'completed' || (!allParticipantsInBracket && !dragDropState.isSelectionLocked)}
                  onChange={(e) => handleLockParticipants(e.target.checked)}
                />
                Зафиксировать участников
              </label>
            </div>
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

      {/* Нижние общие кнопки */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start', padding: '16px', borderTop: '1px solid #eee' }} data-export-exclude="true">
        {tMeta?.status !== 'completed' && (
          <button className="btn" disabled={saving || !tMeta} onClick={async () => {
            if (!tMeta) return;
            setSaving(true);
            try {
              await fetch(`/api/tournaments/${tMeta.id}/complete/`, { method: 'POST' });
              alert('Турнир завершён');
              // Перенаправить на страницу списка турниров
              window.location.href = '/tournaments';
            } catch (e) {
              console.error(e);
              alert('Ошибка завершения турнира');
            } finally {
              setSaving(false);
            }
          }}>Завершить турнир</button>
        )}
        <button className="btn" disabled={saving || !tMeta} onClick={async () => {
          if (!tMeta || !window.confirm(`Удалить турнир "${tMeta.name}"?`)) return;
          setSaving(true);
          try {
            await fetch(`/api/tournaments/${tMeta.id}/`, { method: 'DELETE' });
            alert('Турнир удалён');
            window.location.href = '/tournaments';
          } catch (e) {
            console.error(e);
            alert('Ошибка удаления');
          } finally {
            setSaving(false);
          }
        }} style={{ background: '#dc3545', borderColor: '#dc3545' }}>Удалить турнир</button>
        <button className="btn" disabled={saving} onClick={handleShare}>Поделиться</button>
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
        <div style={{ fontSize: 14 }}>SandMatch</div>
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
    </div>
  );
};
