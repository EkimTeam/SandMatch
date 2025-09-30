import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BracketData } from '../types/bracket';
import { BracketWithSVGConnectors } from '../components/BracketWithSVGConnectors';
import { DraggableParticipantList } from '../components/DraggableParticipantList';
import { KnockoutParticipantPicker } from '../components/KnockoutParticipantPicker';
import { tournamentApi, matchApi } from '../services/api';
import { formatDate } from '../services/date';
import { DraggableParticipant, DropSlot, DragDropState } from '../types/dragdrop';
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

  // Состояние для Drag & Drop
  const [dragDropState, setDragDropState] = useState<DragDropState>({
    participants: [],
    dropSlots: [],
    isSelectionLocked: false
  });

  // Модальное окно выбора участника
  const [pickerOpen, setPickerOpen] = useState(false);

  const loadDraw = useCallback(async () => {
    if (!tournamentId || !bracketId) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await tournamentApi.getBracketDraw(tournamentId, bracketId);
      setData(resp as BracketData);
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
      let allSlotsFilled = true;
      
      data.rounds.forEach(round => {
        if (round.round_index === 0) { // Только первый раунд
          round.matches.forEach(match => {
            const team1Participant = match.team_1 ? {
              id: match.team_1.id,
              name: match.team_1.name,
              isInBracket: true
            } : null;
            
            const team2Participant = match.team_2 ? {
              id: match.team_2.id,
              name: match.team_2.name,
              isInBracket: true
            } : null;
            
            if (!team1Participant || !team2Participant) {
              allSlotsFilled = false;
            }
            
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
          isSelectionLocked: allSlotsFilled && dropSlots.length > 0
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

  const seed = async () => {
    if (!tournamentId || !bracketId) return;
    setLoading(true);
    setError(null);
    try {
      await tournamentApi.seedBracket(tournamentId, bracketId);
      await loadDraw();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Не удалось выполнить посев');
    } finally {
      setLoading(false);
    }
  };

  // demoCreateSeed8 удалена

  // Обработчики Drag & Drop
  const handleDrop = useCallback(async (
    matchId: number,
    slot: 'team_1' | 'team_2',
    participant: DraggableParticipant
  ) => {
    if (!tournamentId || !bracketId) return;

    // Проверка занятости слота
    const targetSlot = dragDropState.dropSlots.find(
      s => s.matchId === matchId && s.slot === slot
    );
    if (targetSlot?.currentParticipant) {
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

      // Обновить UI
      setDragDropState(prev => {
        const updatedDropSlots = prev.dropSlots.map(dropSlot =>
          dropSlot.matchId === matchId && dropSlot.slot === slot
            ? { ...dropSlot, currentParticipant: null }
            : dropSlot
        );
        
        // Пересчитать isInBracket для всех участников
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
      
      // Перезагрузить сетку для синхронизации
      await loadDraw();
    } catch (error) {
      console.error('Failed to remove participant from bracket:', error);
      alert('Не удалось удалить участника из сетки');
    }
  }, [tournamentId, bracketId, dragDropState.dropSlots, loadDraw]);

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
    
    // Подсчитать сколько участников в слотах
    const participantsInSlots = dragDropState.dropSlots.filter(slot => slot.currentParticipant !== null).length;
    
    // Для олимпийской системы нужно заполнить все слоты первого раунда
    const firstRoundSlots = dragDropState.dropSlots.length;
    
    return participantsInSlots === firstRoundSlots && firstRoundSlots > 0;
  }, [dragDropState.participants, dragDropState.dropSlots]);

  // Обработчик фиксации участников
  const handleLockParticipants = useCallback(async (locked: boolean) => {
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
      // Снятие фиксации - обновить статус участников
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
    }
  }, [tournamentId, bracketId, dragDropState.dropSlots, loadDraw]);

  const onMatchClick = async (matchId: number) => {
    if (!data) return;
    const all = data.rounds.flatMap((r) => r.matches);
    const m = all.find((x) => x.id === matchId);
    if (!m) return;
    if (!m.team_1 || !m.team_2) return;
    // Определим целевой матч для подсветки после сохранения
    const targetId = m.connection_info && (m.connection_info as any).target_match_id ? (m.connection_info as any).target_match_id as number : null;
    const a = prompt(`Счёт для ${m.team_1.name} vs ${m.team_2.name} — геймы победителя:`);
    const b = prompt('Геймы проигравшего:');
    if (!a || !b) return;
    const gamesFirst = Number(a);
    const gamesSecond = Number(b);
    if (Number.isNaN(gamesFirst) || Number.isNaN(gamesSecond) || gamesFirst === gamesSecond) {
      alert('Некорректный счёт');
      return;
    }
    try {
      await matchApi.savePlayoffScore(
        tournamentId,
        m.id,
        m.team_1.id,
        m.team_2.id,
        gamesFirst,
        gamesSecond
      );
      // Подсветим текущий и целевой матч
      const hl = new Set<number>();
      hl.add(m.id);
      if (targetId) hl.add(targetId);
      setHighlight(hl);
      await loadDraw();
      // Снимем подсветку через секунду
      setTimeout(() => setHighlight(new Set()), 1000);
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Не удалось сохранить счёт');
    }
  };

  return (
    <div className="knockout-page-container">
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
        <div className="participants-panel">
          <DraggableParticipantList
            participants={dragDropState.participants}
            onRemoveParticipant={handleRemoveParticipant}
            onAddParticipant={handleAddParticipant}
            onAutoSeed={handleAutoSeed}
            maxParticipants={tMeta?.planned_participants || 32}
            canAddMore={canAddMoreParticipants}
          />
        </div>
        )}

        {/* Правая панель с сеткой */}
        <div className="bracket-panel" style={{ width: dragDropState.isSelectionLocked ? '100%' : undefined }}>
          {/* Панель управления сеткой */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            <button className="btn" disabled={!bracketId} onClick={seed}>Автозасев</button>
            <button className="btn" disabled={!bracketId} onClick={loadDraw}>Обновить</button>
            
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: allParticipantsInBracket || dragDropState.isSelectionLocked ? 'pointer' : 'not-allowed', opacity: allParticipantsInBracket || dragDropState.isSelectionLocked ? 1 : 0.5 }}>
                <input
                  type="checkbox"
                  checked={dragDropState.isSelectionLocked}
                  disabled={!allParticipantsInBracket && !dragDropState.isSelectionLocked}
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
              onMatchClick={onMatchClick}
              highlightIds={highlight}
              dropSlots={dragDropState.dropSlots}
              onDrop={handleDrop}
              onRemoveFromSlot={handleRemoveFromSlot}
              isLocked={dragDropState.isSelectionLocked}
            />
          )}
        </div>
      </div>

      {/* Нижние общие кнопки */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start', padding: '16px', borderTop: '1px solid #eee' }}>
        <button className="btn" disabled={saving || !tMeta} onClick={async () => {
          if (!tMeta) return;
          setSaving(true);
          try { await fetch(`/api/tournaments/${tMeta.id}/complete/`, { method: 'POST' }); } finally { setSaving(false); }
          await loadDraw();
        }}>Завершить турнир</button>
        <button className="btn" style={{ background: '#dc3545', borderColor: '#dc3545' }} disabled={saving || !tMeta} onClick={async () => {
          if (!tMeta) return;
          if (!confirm('Удалить турнир без возможности восстановления?')) return;
          setSaving(true);
          try { await fetch(`/api/tournaments/${tMeta.id}/remove/`, { method: 'POST' }); } finally { setSaving(false); }
          navigate('/tournaments');
        }}>Удалить турнир</button>
        <button className="btn" disabled title="Скоро">Поделиться</button>
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
