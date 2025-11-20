import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { tournamentApi, schedulePatternApi, SchedulePattern, Tournament, KingScheduleResponse, KingCalculationMode, Ruleset, ratingApi } from '../services/api';
import { formatDate } from '../services/date';
import { ParticipantPickerModal } from '../components/ParticipantPickerModal';
import { MatchScoreModal } from '../components/MatchScoreModal';
import SchedulePatternModal from '../components/SchedulePatternModal';
import { computeKingGroupRanking } from '../utils/kingRanking';
import { useAuth } from '../context/AuthContext';

export const KingPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tournamentId = parseInt(id || '0', 10);
  const { user } = useAuth();
  const role = user?.role;
  const canManageTournament = role === 'ADMIN' || role === 'ORGANIZER';
  const canManageMatches = canManageTournament || role === 'REFEREE';

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [schedule, setSchedule] = useState<KingScheduleResponse | null>(null);
  const [calculationMode, setCalculationMode] = useState<KingCalculationMode>('g_minus');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockParticipants, setLockParticipants] = useState(false);
  const [showFullName, setShowFullName] = useState(false);
  const [showTech, setShowTech] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<null | { group: number; row: number }>(null);
  const [scoreInput, setScoreInput] = useState<null | {
    matchId: number;
    team1: { id: number; name: string };
    team2: { id: number; name: string };
    existingSets?: any[];
  }>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [schedulePatternModal, setSchedulePatternModal] = useState<{ groupName: string; participantsCount: number; currentPatternId?: number | null } | null>(null);
  // Все паттерны Кинг (кэш) и быстрый доступ по id
  const [kingPatternsById, setKingPatternsById] = useState<Record<number, SchedulePattern>>({});
  // Подсказка к режимам подсчета (mobile-friendly)
  const [showCalcTip, setShowCalcTip] = useState(false);
  const calcTipRef = useRef<HTMLDivElement | null>(null);
  // Карта рейтингов игроков
  const [playerRatings, setPlayerRatings] = useState<Map<number, number>>(new Map());
  const canDeleteTournament = !!tournament?.can_delete;

  useEffect(() => {
    const onDocClick = (e: MouseEvent | TouchEvent) => {
      if (!showCalcTip) return;
      const el = calcTipRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        setShowCalcTip(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
    };
  }, [showCalcTip]);

  // Загрузка данных турнира
  useEffect(() => {
    loadTournament();
  }, [tournamentId]);

  // Загрузка расписания
  useEffect(() => {
    if (tournament && (tournament.status === 'active' || tournament.status === 'completed')) {
      loadSchedule();
    }
  }, [tournament]);

  // Загрузка рейтингов игроков (из участников и расписания)
  useEffect(() => {
    const loadRatings = async () => {
      try {
        const ids = new Set<number>();
        // из участников турнира
        const parts: any[] = (tournament as any)?.participants || [];
        parts.forEach((p: any) => {
          const team: any = p.team || {};
          if (Array.isArray(team.players)) {
            team.players.forEach((pl: any) => { const pid = pl?.id ?? pl?.player_id; if (pid != null) ids.add(Number(pid)); });
          } else {
            const p1 = team.player_1 ?? team.player1_id; const p2 = team.player_2 ?? team.player2_id;
            if (p1 != null) ids.add(Number(p1)); if (p2 != null) ids.add(Number(p2));
          }
        });
        // из расписания (если активно)
        if ((tournament?.status === 'active') && schedule) {
          Object.values(schedule.schedule || {}).forEach((g: any) => {
            (g.rounds || []).forEach((r: any) => {
              (r.matches || []).forEach((m: any) => {
                (m.team1_players || []).forEach((pl: any) => { if (pl?.id != null) ids.add(Number(pl.id)); });
                (m.team2_players || []).forEach((pl: any) => { if (pl?.id != null) ids.add(Number(pl.id)); });
              });
            });
          });
        }
        if (ids.size === 0) { setPlayerRatings(new Map()); return; }
        const resp = await ratingApi.playerBriefs(Array.from(ids));
        const map = new Map<number, number>();
        for (const it of (resp.results || [])) {
          if (typeof it.id === 'number' && typeof it.current_rating === 'number') map.set(it.id, it.current_rating);
        }
        setPlayerRatings(map);
      } catch (_) {
        setPlayerRatings(new Map());
      }
    };
    loadRatings();
  }, [tournament, schedule]);

  // Загрузка регламентов (единожды)
  useEffect(() => {
    const load = async () => {
      try {
        const list = await tournamentApi.getRulesets('king');
        setRulesets(list);
      } catch (e) {
        console.error('Failed to load rulesets:', e);
      }
    };
    load();
  }, []);

  // Загрузка всех шаблонов расписания (для предпросмотра и сопоставления по id)
  useEffect(() => {
    const load = async () => {
      try {
        const all = await schedulePatternApi.getAll();
        const map: Record<number, SchedulePattern> = {};
        (all || []).forEach(p => { if (p && typeof p.id === 'number') map[p.id] = p; });
        setKingPatternsById(map);
      } catch (e) {
        console.warn('Не удалось загрузить шаблоны расписаний для предпросмотра:', e);
      }
    };
    load();
  }, []);

  const loadTournament = async () => {
    try {
      setLoading(true);
      const data = await tournamentApi.getById(tournamentId);
      setTournament(data);
      
      // Проверка, что это действительно турнир Кинг
      if (data.system !== 'king') {
        // Редирект на правильную страницу
        if (data.system === 'knockout') {
          navigate(`/tournaments/${tournamentId}/knockout`);
        } else {
          navigate(`/tournaments/${tournamentId}`);
        }
        return;
      }

      // Установить текущий режим подсчета
      if (data.king_calculation_mode) {
        setCalculationMode(data.king_calculation_mode);
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (!user && status === 403) {
        setError('Завершённые турниры доступны только зарегистрированным пользователям. Пожалуйста, войдите в систему.');
      } else {
        setError(err.response?.data?.error || 'Ошибка загрузки турнира');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRulesetChange = async (rulesetId: number) => {
    if (!canManageTournament) return;
    try {
      const result = await tournamentApi.setRuleset(tournamentId, rulesetId);
      if (result.ok) {
        await loadTournament();
        // schedule и таблица пересчитаются автоматически на основе обновленного ruleset
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка при изменении регламента');
    }
  };

  const loadSchedule = async () => {
    try {
      const data = await tournamentApi.getKingSchedule(tournamentId);
      setSchedule(data);
    } catch (err: any) {
      console.error('Ошибка загрузки расписания:', err);
    }
  };

  const handleLockParticipantsToggle = async (checked: boolean) => {
    if (!tournament || !canManageTournament) return;
    
    try {
      setSaving(true);
      if (checked) {
        const result = await tournamentApi.lockParticipantsKing(tournamentId);
        if (result.ok) {
          setLockParticipants(true);
          await loadTournament();
          await loadSchedule();
        }
      } else {
        // Снятие фиксации (если понадобится)
        await tournamentApi.unlockParticipants(tournamentId);
        setLockParticipants(false);
        await loadTournament();
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка при изменении фиксации участников');
    } finally {
      setSaving(false);
    }
  };

  const completeTournament = async () => {
    if (!tournament || !canManageTournament || !window.confirm('Завершить турнир?')) return;
    try {
      setSaving(true);
      await tournamentApi.complete(tournamentId);
      await loadTournament();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка при завершении турнира');
    } finally {
      setSaving(false);
    }
  };

  const deleteTournament = async () => {
    if (!tournament || !canDeleteTournament || !window.confirm('Удалить турнир безвозвратно?')) return;
    try {
      setSaving(true);
      await tournamentApi.delete(tournamentId);
      navigate('/tournaments');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка при удалении турнира');
      setSaving(false);
    }
  };

  const handleShare = async () => {
    try {
      const container = exportRef.current;
      if (!container) return;
      
      // Используем html2canvas для экспорта
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(container, {
        backgroundColor: '#ffffff',
        scale: 2,
      });
      
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `king_tournament_${tournament?.id || 'export'}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      alert('Не удалось подготовить изображение');
    }
  };

  const handleCalculationModeChange = async (mode: KingCalculationMode) => {
    try {
      const result = await tournamentApi.setKingCalculationMode(tournamentId, mode);
      if (result.ok) {
        setCalculationMode(mode);
        // Пересчет статистики произойдет автоматически
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка при изменении режима');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-600">Загрузка...</div>
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div className="p-4">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error || 'Турнир не найден'}
        </div>
      </div>
    );
  }

  const completed = tournament.status === 'completed';
  const effectiveLocked = lockParticipants || tournament.status === 'active' || completed;
  // Для КИНГ: как только турнир активирован, разблокировка не поддерживается — чекбокс отключаем
  const lockDisabled = tournament.status !== 'created' || completed || saving;

  return (
    <div className="container mx-auto p-4" ref={exportRef}>
      {/* Заголовок в стиле круговой системы */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-1">
          {tournament.name}
        </h1>
        <div className="text-sm text-gray-600">
          {tournament.date ? formatDate(tournament.date) : ''}
          {(tournament.get_system_display || 'Кинг') ? ` • ${tournament.get_system_display || 'Кинг'}` : ''}
          {tournament.get_participant_mode_display ? ` • ${tournament.get_participant_mode_display}` : ''}
          {tournament.organizer_name ? ` • Организатор: ${tournament.organizer_name}` : ''}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          Статус: {tournament.status === 'created' ? 'Создан' : tournament.status === 'active' ? 'Активен' : 'Завершён'}
          {typeof tournament.participants_count === 'number' ? ` • Участников: ${tournament.participants_count}` : ''}
        </div>
      </div>

      {/* Радиокнопки G- / M+ / NO и выбор регламента:
          - при active: можно менять (если есть права);
          - при completed: показываем для чтения, но не даём менять. */}
      {(tournament.status === 'active' || tournament.status === 'completed') && (
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
                    // Закрывать, только если фокус ушел вне контейнера
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
          {/* Регламент: выпадающий список (при completed только для чтения) */}
          <span className="font-semibold ml-4">Регламент:</span>
          <div className="flex-1 min-w-[240px]" style={{ maxWidth: '100%' }}>
            <select
              className="w-full border rounded px-2 py-1 text-sm"
              value={tournament.ruleset?.id || ''}
              disabled={!canManageTournament || completed}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (!Number.isNaN(val)) handleRulesetChange(val);
              }}
            >
              {/* Пустой вариант, если не загружено */}
              {(!rulesets || rulesets.length === 0) && (
                <option value="">Загрузка…</option>
              )}
              {rulesets.map((rs) => (
                <option key={rs.id} value={rs.id}>{rs.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Модалка выбора формата расписания (Кинг) */}
      {schedulePatternModal && (
        <SchedulePatternModal
          isOpen={true}
          onClose={() => setSchedulePatternModal(null)}
          groupName={schedulePatternModal.groupName}
          participantsCount={schedulePatternModal.participantsCount}
          currentPatternId={schedulePatternModal.currentPatternId}
          tournamentId={tournament.id}
          tournamentSystem={'king'}
          onSuccess={async () => {
            await loadTournament();
            await loadSchedule();
            setSchedulePatternModal(null);
          }}
        />
      )}

      {/* Таблица и расписание */}
      {tournament.status === 'created' && (
        <div>
          {Array.from({ length: tournament.groups_count || 1 }, (_, gi) => {
            const groupIndex = gi + 1;
            const totalParticipants = tournament.planned_participants || tournament.participants_count || 0;
            // Получаем участников для этой группы (используем поле group_index из API)
            const groupParticipants = (tournament.participants as any[] | undefined)?.filter((p: any) => p.group_index === groupIndex) || [];
            // Если участников уже распределили — используем фактическое количество
            // Иначе распределяем планово: первые (total % groups) групп получают на 1 больше
            const plannedSize = (() => {
              const g = Math.max(1, tournament.groups_count || 1);
              const base = Math.floor(totalParticipants / g);
              const rem = totalParticipants % g;
              return groupIndex <= rem ? base + 1 : base;
            })();
            // Важно: количество строк таблицы фиксируем по плану, чтобы можно было добавлять участников по местам
            const participantsInGroup = plannedSize;
            
            return (
              <div key={groupIndex} style={{ marginBottom: 22 }}>
                <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <strong>Группа {groupIndex}</strong>
                  <button data-export-exclude="true" className={`toggle ${showFullName ? 'active' : ''}`} onClick={() => setShowFullName(v => !v)}>
                    ФИО показать
                  </button>
                  <div style={{ marginLeft: 'auto' }} data-export-exclude="true">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={effectiveLocked}
                        disabled={lockDisabled}
                        onChange={(e) => handleLockParticipantsToggle(e.target.checked)}
                      />
                      <span>Зафиксировать участников</span>
                    </label>
                  </div>
                </div>

                <div style={{ overflow: 'auto', marginBottom: 20 }}>
                  <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 50 }}>№</th>
                        <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'left' }}>Участник</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: participantsInGroup }, (_, ri) => {
                        const rowIndex = ri + 1;
                        const rowLetter = String.fromCharCode(64 + rowIndex); // A, B, C, D...
                        const participant = groupParticipants.find((p: any) => p.row_index === rowIndex);
                        const participantTeam = participant?.team as any | undefined;
                        const participantName = participantTeam
                          ? (showFullName
                              ? (participantTeam.full_name || participantTeam.name || '—')
                              : (participantTeam.display_name || participantTeam.name || '—'))
                          : '—';
                        // рейтинг участника (ожидается одиночка)
                        const pid = (() => {
                          if (Array.isArray(participantTeam?.players) && participantTeam.players[0]?.id != null) return Number(participantTeam.players[0].id);
                          const p1 = participantTeam?.player_1 ?? participantTeam?.player1_id; if (p1 != null) return Number(p1);
                          return null;
                        })();
                        const pr = (pid != null && playerRatings.has(pid)) ? playerRatings.get(pid)! : null;
                        
                        return (
                          <tr key={rowIndex}>
                            <td style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{rowLetter}</td>
                            <td
                              className="cell-click"
                              style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'left', cursor: 'pointer' }}
                              onClick={() => !effectiveLocked && setPickerOpen({ group: groupIndex, row: rowIndex })}
                            >
                              <>
                                <span>{participantName}</span>
                                {typeof pr === 'number' && (
                                  <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.75 }}>{Math.round(pr)} <span style={{ fontSize: 9 }}>BP</span></span>
                                )}
                              </>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Порядок игр (до фиксации): из сохранённого паттерна или системный фолбэк */}
                <div className="text-sm mt-3" data-export-exclude="true" style={{ minWidth: 260 }}>
                  <div className="font-medium mb-1">Порядок игр:</div>
                  {(() => {
                    const numParticipants = participantsInGroup;
                    const groupName = `Группа ${groupIndex}`;
                    // Считываем выбранный паттерн из БД
                    let currentPatternId: number | null = null;
                    const raw = (tournament as any)?.group_schedule_patterns;
                    if (raw) {
                      try {
                        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        const nbspName = groupName.replace(' ', '\u00A0');
                        const val = obj?.[groupName] ?? obj?.[nbspName];
                        if (val != null && val !== '') currentPatternId = Number(val);
                      } catch (_) {}
                    }

                    const selectedPattern = (currentPatternId && kingPatternsById[currentPatternId]) ? kingPatternsById[currentPatternId] : null;
                    const isCustom = (selectedPattern as any)?.pattern_type === 'custom';
                    const isPatternValid = (() => {
                      if (!selectedPattern) return false;
                      const pc: any = (selectedPattern as any).participants_count;
                      if (isCustom) return Number(pc) === numParticipants;
                      const pcn = pc == null ? null : Number(pc);
                      return pcn == null || pcn === 0 || pcn === numParticipants; // системный
                    })();

                    // Вычисление базы индексации (0/1) по минимальному индексу во всех парах
                    const detectIndexBase = (roundsData: any[]): 0 | 1 => {
                      let minVal: number | null = null;
                      for (const r of roundsData) {
                        const source = Array.isArray(r?.pairs) ? r.pairs : (Array.isArray(r?.matches) ? r.matches : []);
                        for (const pair of source) {
                          const candidates: any[] = [];
                          if (Array.isArray(pair)) {
                            candidates.push(pair[0], pair[1]);
                          } else if (pair && typeof pair === 'object') {
                            candidates.push(pair.team1 ?? pair.left ?? pair.a, pair.team2 ?? pair.right ?? pair.b);
                          }
                          for (const side of candidates) {
                            const arr = Array.isArray(side) ? side : [side];
                            for (const v of arr) {
                              const n = Number(v);
                              if (Number.isFinite(n)) {
                                if (minVal === null || n < minVal) minVal = n;
                              }
                            }
                          }
                        }
                      }
                      return minVal === 1 ? 1 : 0;
                    };

                    const renderPatternRounds = (pattern: SchedulePattern) => {
                      let cs: any = (pattern as any).custom_schedule;
                      if (!cs) return null;
                      if (typeof cs === 'string') { try { cs = JSON.parse(cs); } catch { cs = {}; } }
                      const rounds = Array.isArray(cs?.rounds) ? cs.rounds : [];
                      if (rounds.length === 0) return null;
                      const indexBase = detectIndexBase(rounds);
                      const toLetter = (idx: number) => {
                        const i = Number(idx);
                        if (!Number.isFinite(i)) return '';
                        const code = indexBase === 0 ? (65 + i) : (64 + i);
                        return String.fromCharCode(code);
                      };
                      const formatSide = (side: any) => Array.isArray(side) ? side.map((v) => toLetter(v)).join('+') : toLetter(side);
                      return (
                        <div className="flex flex-col gap-1">
                          {rounds.map((round: any, idx: number) => {
                            const source = Array.isArray(round.pairs) ? round.pairs : (Array.isArray(round.matches) ? round.matches : []);
                            const label = `Тур ${round.round ?? (idx + 1)}:`;
                            return (
                              <div key={idx} className="grid grid-cols-[auto_1fr] gap-x-2">
                                {source.map((pair: any, mi: number) => {
                                  let a = pair?.[0]; let b = pair?.[1];
                                  if (a == null && b == null && pair && typeof pair === 'object') {
                                    a = pair.team1 ?? pair.left ?? pair.a ?? null;
                                    b = pair.team2 ?? pair.right ?? pair.b ?? null;
                                  }
                                  const left = formatSide(a);
                                  const right = formatSide(b);
                                  return (
                                    <React.Fragment key={mi}>
                                      <span className={mi === 0 ? '' : 'opacity-0 select-none'}>{label}</span>
                                      <span>{left} vs {right}</span>
                                    </React.Fragment>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      );
                    };

                    if (isPatternValid && selectedPattern && isCustom) {
                      return renderPatternRounds(selectedPattern);
                    }

                    // Фолбэк: локальный системный генератор
                    if (numParticipants < 4) {
                      return <div className="text-gray-500">Недостаточно участников для генерации расписания (минимум 4)</div>;
                    }
                    const generateKingMatches = (n: number): { round: number; matches: [number[], number[]][]; resting: number[] }[] => {
                      const result: { round: number; matches: [number[], number[]][]; resting: number[] }[] = [];
                      if (n < 4) return result;
                      // Специальные случаи 4/5/6 (согласованы с backend для читаемости)
                      if (n === 4) {
                        const base: [number[], number[]][] = [
                          [[0, 1], [2, 3]],
                          [[0, 2], [1, 3]],
                          [[0, 3], [1, 2]]
                        ];
                        base.forEach((m, i) => result.push({ round: i + 1, matches: [m], resting: [] }));
                        return result;
                      }
                      if (n === 5) {
                        const cfg: [number[], number[], number[]][] = [
                          [[0, 1], [2, 3], [4]],
                          [[0, 2], [3, 4], [1]],
                          [[0, 3], [1, 4], [2]],
                          [[0, 4], [1, 2], [3]],
                          [[1, 3], [2, 4], [0]]
                        ];
                        cfg.forEach(([t1, t2, rest], i) => result.push({ round: i + 1, matches: [[t1, t2]], resting: rest }));
                        return result;
                      }
                      if (n === 6) {
                        const cfg: [number[], number[], number[]][] = [
                          [[0, 1], [2, 3], [4, 5]],
                          [[1, 5], [3, 4], [0, 2]],
                          [[0, 2], [4, 5], [1, 3]],
                          [[2, 4], [1, 3], [0, 5]],
                          [[0, 4], [2, 5], [1, 3]],
                          [[0, 3], [1, 4], [2, 5]],
                          [[3, 5], [2, 4], [0, 1]],
                          [[0, 5], [1, 2], [3, 4]]
                        ];
                        cfg.forEach(([t1, t2, rest], i) => result.push({ round: i + 1, matches: [[t1, t2]], resting: rest }));
                        return result;
                      }
                      // Общий случай: round-robin пары -> объединяем каждые 2 пары в матч 2x2
                      const generateEvenRR = (m: number): Array<Array<[number, number]>> => {
                        const rounds: Array<Array<[number, number]>> = [];
                        const players = Array.from({ length: m }, (_, i) => i);
                        let arr = players.slice();
                        for (let r = 0; r < m - 1; r++) {
                          const pairs: Array<[number, number]> = [];
                          for (let i = 0; i < m / 2; i++) {
                            pairs.push([arr[i], arr[m - 1 - i]]);
                          }
                          rounds.push(pairs);
                          // поворот (первый фиксирован)
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
                            const a = extended[i];
                            const b = extended[extended.length - 1 - i];
                            if (a !== null && b !== null) pairs.push([a, b]);
                          }
                          rounds.push(pairs);
                          // циклический сдвиг
                          arr = [arr[arr.length - 1], ...arr.slice(0, arr.length - 1)];
                        }
                        return rounds;
                      };

                      const rr = (n % 2 === 0) ? generateEvenRR(n) : generateOddRR(n);
                      rr.forEach((pairs, rIdx) => {
                        const matches: [number[], number[]][] = [];
                        const used = new Set<number>();
                        for (let i = 0; i + 1 < pairs.length; i += 2) {
                          const t1 = [pairs[i][0], pairs[i][1]];
                          const t2 = [pairs[i + 1][0], pairs[i + 1][1]];
                          matches.push([t1, t2]);
                          used.add(t1[0]); used.add(t1[1]); used.add(t2[0]); used.add(t2[1]);
                        }
                        const all = new Set(Array.from({ length: n }, (_, i) => i));
                        const resting = Array.from([...all].filter(x => !used.has(x)));
                        result.push({ round: rIdx + 1, matches, resting });
                      });
                      return result;
                    };

                    const kingSchedule = generateKingMatches(numParticipants);
                    return (
                      <div className="flex flex-col gap-1">
                        {kingSchedule.map((roundData) => {
                          const label = `Тур ${roundData.round}:`;
                          return (
                            <div key={roundData.round} className="grid grid-cols-[auto_1fr] gap-x-2">
                              {roundData.matches.map((match, mi) => {
                                const [team1, team2] = match;
                                const team1Letters = team1.map(p => String.fromCharCode(65 + p)).join('+');
                                const team2Letters = team2.map(p => String.fromCharCode(65 + p)).join('+');
                                return (
                                  <React.Fragment key={mi}>
                                    <span className={mi === 0 ? '' : 'opacity-0 select-none'}>{label}</span>
                                    <span>{team1Letters} vs {team2Letters}</span>
                                  </React.Fragment>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                {/* Кнопка выбора формата расписания */}
                <div className="mt-2" data-export-exclude="true">
                  {!completed && !effectiveLocked && (
                    <button
                      onClick={() => {
                        const groupName = `Группа ${groupIndex}`;
                        let currentPatternId: number | null = null;
                        const raw = (tournament as any)?.group_schedule_patterns;
                        if (raw) {
                          if (typeof raw === 'string') {
                            try {
                              const parsed = JSON.parse(raw);
                              const nbspName = groupName.replace(' ', '\u00A0');
                              const val = parsed?.[groupName] ?? parsed?.[nbspName];
                              if (val != null && val !== '') currentPatternId = Number(val);
                            } catch (_) { /* ignore */ }
                          } else if (typeof raw === 'object') {
                            const nbspName = groupName.replace(' ', '\u00A0');
                            const val = raw?.[groupName] ?? raw?.[nbspName];
                            if (val != null && val !== '') currentPatternId = Number(val);
                          }
                        }
                        setSchedulePatternModal({ groupName, participantsCount: participantsInGroup, currentPatternId });
                      }}
                      className="px-3 py-1.5 text-sm text-white bg-green-600 rounded hover:bg-green-700 transition-colors"
                    >
                      Выбрать формат<br/>расписания
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Таблица результатов и расписание по группам:
          - показываем и для active, и для completed;
          - интерактивные действия внутри уже защищены проверками completed. */}
      {(tournament.status === 'active' || tournament.status === 'completed') && schedule && (
        <div className="space-y-8">
          {Object.entries(schedule.schedule).map(([groupIndex, groupData]) => {
            const rankMap = computeKingGroupRanking(tournament, groupData, groupIndex, calculationMode);
            const toRoman = (num: number) => {
              const romans: [number, string][] = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
              let n = Math.max(1, Math.floor(num)); let res=''; for(const [v,s] of romans){ while(n>=v){res+=s;n-=v;} } return res;
            };
            return (
            <div key={groupIndex} style={{ marginBottom: 22 }}>
              <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <strong>Группа {groupIndex}</strong>
                <button data-export-exclude="true" className={`toggle ${showTech ? 'active' : ''}`} onClick={() => setShowTech(v => !v)}>
                  Победы/Сеты/Сеты соот./Геймы соот.
                </button>
                <button data-export-exclude="true" className={`toggle ${showFullName ? 'active' : ''}`} onClick={() => setShowFullName(v => !v)}>
                  ФИО показать
                </button>
                {canManageTournament && (
                  <div style={{ marginLeft: 'auto' }} data-export-exclude="true">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={effectiveLocked}
                        disabled={lockDisabled}
                        onChange={(e) => handleLockParticipantsToggle(e.target.checked)}
                      />
                      <span>Зафиксировать участников</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Таблица участников с турами */}
              <div style={{ overflow: 'auto', marginBottom: 20 }}>
                <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 50 }}>№</th>
                      <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px' }}>Участник</th>
                      {groupData.rounds.map((round) => (
                        <th key={round.round} style={{ border: '1px solid #e7e7ea', padding: '6px 8px' }}>Тур {round.round}</th>
                      ))}
                      <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 70 }}>G-/M+</th>
                      <th className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 80 }}>Победы</th>
                      <th className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Сеты</th>
                      <th className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Сеты<br />соот.</th>
                      <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Геймы</th>
                      <th className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Геймы<br />соот.</th>
                      <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Место</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupData.participants.map((participant) => {
                      // Собираем playerIds участника по записям турнира (точное соответствие группе и строке)
                      const playerIds = new Set<number>();
                      const gi = parseInt(String(groupIndex), 10);
                      const entry = (tournament.participants as any[] | undefined)?.find((e: any) => e.group_index === gi && e.row_index === participant.row_index);
                      const pTeam: any = entry?.team || {};
                      if (Array.isArray(pTeam.players)) {
                        pTeam.players.forEach((pl: any) => { if (pl?.id) playerIds.add(pl.id); });
                      } else {
                        if (pTeam.player_1) playerIds.add(pTeam.player_1);
                        if (pTeam.player_2) playerIds.add(pTeam.player_2);
                      }

                      // Найти все матчи участника и подсчитать статистику
                      const participantMatches: any[] = [];
                      groupData.rounds.forEach((round: any) => {
                        round.matches.forEach((match: any) => {
                          const t1Has = match.team1_players.some((p: any) => playerIds.has(p.id));
                          const t2Has = match.team2_players.some((p: any) => playerIds.has(p.id));
                          if (t1Has || t2Has) {
                            participantMatches.push({ ...match, round: round.round, isTeam1: t1Has });
                          }
                        });
                      });

                      // Подсчет статистики
                      let wins = 0, losses = 0;
                      let setsWon = 0, setsLost = 0;
                      let gamesWon = 0, gamesLost = 0;

                      participantMatches.forEach(m => {
                        if (m.status === 'completed' && m.sets && m.sets.length > 0) {
                          const sets = m.sets;
                          sets.forEach((set: any) => {
                            const g1 = set.games_1 || 0;
                            const g2 = set.games_2 || 0;
                            if (m.isTeam1) {
                              gamesWon += g1;
                              gamesLost += g2;
                              if (g1 > g2) setsWon++;
                              else setsLost++;
                            } else {
                              gamesWon += g2;
                              gamesLost += g1;
                              if (g2 > g1) setsWon++;
                              else setsLost++;
                            }
                          });
                          
                          // Определяем победителя
                          const team1Sets = sets.filter((s: any) => (s.games_1 || 0) > (s.games_2 || 0)).length;
                          const team2Sets = sets.filter((s: any) => (s.games_2 || 0) > (s.games_1 || 0)).length;
                          const isWinner = m.isTeam1 ? team1Sets > team2Sets : team2Sets > team1Sets;
                          if (isWinner) wins++;
                          else losses++;
                        }
                      });

                      const setsRatio = `${setsWon}/${setsLost}`;

                      return (
                        <tr key={participant.id}>
                          {/* Буква строки */}
                          <td style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{String.fromCharCode(64 + (participant.row_index || 0))}</td>
                          <td
                            className={`cell-click${effectiveLocked ? ' locked' : ''}`}
                            style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'left', fontWeight: effectiveLocked ? 700 : 400 }}
                            onClick={() => !effectiveLocked && !completed && setPickerOpen({ group: parseInt(groupIndex), row: participant.row_index })}
                            title={showFullName ? participant.name : participant.display_name}
                          >
                            {(() => {
                              const nm = showFullName ? participant.name : participant.display_name;
                              // Берём playerId через entry из tournament.participants по group_index/row_index
                              const gi = parseInt(String(groupIndex), 10);
                              const entry = (tournament.participants as any[] | undefined)?.find((e: any) => e.group_index === gi && e.row_index === participant.row_index);
                              const team: any = entry?.team || {};
                              let pid: number | null = null;
                              if (Array.isArray(team.players) && team.players[0]?.id != null) pid = Number(team.players[0].id);
                              else if (team.player_1 != null) pid = Number(team.player_1);
                              const pr = (pid != null && playerRatings.has(pid)) ? playerRatings.get(pid)! : null;
                              return (
                                <>
                                  <span>{nm}</span>
                                  {typeof pr === 'number' && (
                                    <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.75 }}>{Math.round(pr)} <span style={{ fontSize: 9 }}>BP</span></span>
                                  )}
                                </>
                              );
                            })()}
                          </td>
                          {/* Предварительный расчет очков по турам для участника + вывод всех ячеек строки */}
                          {(() => {
                            const scheduleRounds: any[] = groupData.rounds || [];
                            const allMatches: any[] = (tournament as any)?.matches || [];

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
                              let sum = 0;
                              let oppSum = 0;
                              let hadAnySet = false;
                              sets.forEach((s: any) => {
                                const isTBOnly = !!s.is_tiebreak_only;
                                const hasTB = s.tb_1 != null || s.tb_2 != null;
                                const idx = Number(s.index || 0);
                                if (isTBOnly) {
                                  hadAnySet = true;
                                  const my = iAmTeam1 ? Number(s.tb_1 ?? 0) : Number(s.tb_2 ?? 0);
                                  const op = iAmTeam1 ? Number(s.tb_2 ?? 0) : Number(s.tb_1 ?? 0);
                                  sum += my; oppSum += op;
                                  if (my > op) computedSetsWon++; else if (op > my) computedSetsLost++;
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

                              // Подсчёт матча как победа/поражение по набранным сетам
                              const mySets = computedSetsWon + 0; // already incremented per set
                              const opSets = computedSetsLost + 0;
                              // Нельзя определять победителя по кумулятивным (требуется на матч), поэтому определим на основе сравнения суммарно по сетам этого матча
                              // Пересчитаем winner только по сетам текущего матча
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
                              const e2 = (tournament.participants as any[] | undefined)?.find((e: any) => e.group_index === gi2 && e.row_index === pt.row_index);
                              const t2: any = e2?.team || {};
                              if (Array.isArray(t2.players)) t2.players.forEach((pl: any) => { if (pl?.id) pIds.add(pl.id); });
                              else { if (t2.player_1) pIds.add(t2.player_1); if (t2.player_2) pIds.add(t2.player_2); }
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
                              const excessPoints = playedPoints.slice(minMatches).reduce((a,b)=>a+b, 0);
                              // Если участник сыграл ровно минимальное число матчей — показываем "—"
                              gmDisplay = (playedCount === minMatches) ? '—' : `-${excessPoints}`;
                              effectiveGamesSum = playedPoints.slice(0, minMatches).reduce((a,b)=>a+b, 0);
                            } else if (calculationMode === 'm_plus') {
                              const missing = Math.max(0, maxMatches - playedCount);
                              const avg = playedCount > 0 ? Math.round(playedPoints.reduce((a,b)=>a+b, 0) / playedCount) : 0;
                              const add = missing * avg;
                              // Если участник уже сыграл максимум — показываем "—"
                              gmDisplay = (playedCount === maxMatches) ? '—' : `+${add}`;
                              effectiveGamesSum = playedPoints.reduce((a,b)=>a+b, 0) + add;
                              gamesRatioDisplay = '1';
                              gamesDisplay = effectiveGamesSum; // одиночное число в M+
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

                            // Пересчёт «Сеты» и «Сеты соот.» с учётом G-/M+
                            // Соберём по-раундно количество выигранных/проигранных сетов в каждом сыгранном матче
                            const setsWonByRound: Array<number | null> = [];
                            const setsLostByRound: Array<number | null> = [];
                            scheduleRounds.forEach((round: any, rIdx: number) => {
                              const sms: any[] = (round.matches || []) as any[];
                              const schedMatch = sms.find((sm: any) => (sm.team1_players||[]).some((p:any)=>playerIds.has(Number(p.id))) || (sm.team2_players||[]).some((p:any)=>playerIds.has(Number(p.id))));
                              if (!schedMatch) { setsWonByRound[rIdx] = null; setsLostByRound[rIdx] = null; return; }
                              const iAmTeam1 = (schedMatch.team1_players||[]).some((p:any)=>playerIds.has(Number(p.id)));
                              const full = allMatches.find((fm: any) => fm.id === schedMatch.id);
                              const sets = (full?.sets || []) as any[];
                              if (!sets.length) { setsWonByRound[rIdx] = null; setsLostByRound[rIdx] = null; return; }
                              let mW = 0, mL = 0, hadAny = false;
                              sets.forEach((s: any) => {
                                const isTBOnly = !!s.is_tiebreak_only;
                                const hasTB = s.tb_1 != null || s.tb_2 != null;
                                const idx = Number(s.index || 0);
                                if (isTBOnly) {
                                  hadAny = true;
                                  const t1 = Number(s.tb_1 ?? 0), t2 = Number(s.tb_2 ?? 0);
                                  if (t1 > t2) { if (iAmTeam1) mW++; else mL++; } else if (t2 > t1) { if (iAmTeam1) mL++; else mW++; }
                                } else if (hasTB && idx === 3) {
                                  hadAny = true;
                                  const t1 = Number(s.tb_1 ?? 0), t2 = Number(s.tb_2 ?? 0);
                                  if (t1 > t2) { if (iAmTeam1) mW++; else mL++; } else if (t2 > t1) { if (iAmTeam1) mL++; else mW++; }
                                } else {
                                  const g1 = Number(s.games_1 || 0), g2 = Number(s.games_2 || 0);
                                  if (g1 !== 0 || g2 !== 0) hadAny = true;
                                  if (g1 > g2) { if (iAmTeam1) mW++; else mL++; } else if (g2 > g1) { if (iAmTeam1) mL++; else mW++; }
                                }
                              });
                              if (!hadAny) { setsWonByRound[rIdx] = null; setsLostByRound[rIdx] = null; return; }
                              setsWonByRound[rIdx] = mW; setsLostByRound[rIdx] = mL;
                            });

                            let setsRatioDisplay: string | number = `${computedSetsWon}/${computedSetsLost}`;
                            let setsFractionDisplay: string = (computedSetsWon + computedSetsLost) > 0
                              ? (computedSetsWon / (computedSetsWon + computedSetsLost)).toFixed(2)
                              : '0.00';

                            if (calculationMode !== 'no') {
                              const indicesSets = setsWonByRound.map((v, i) => v !== null ? i : -1).filter(i => i !== -1);
                              if (calculationMode === 'g_minus') {
                                const takeIdx = indicesSets.slice(0, minMatches);
                                const sW = takeIdx.reduce((acc, i) => acc + (setsWonByRound[i] || 0), 0);
                                const sL = takeIdx.reduce((acc, i) => acc + (setsLostByRound[i] || 0), 0);
                                setsRatioDisplay = `${sW}/${sL}`;
                                const denom = sW + sL;
                                setsFractionDisplay = denom > 0 ? (sW / denom).toFixed(2) : '0.00';
                              } else if (calculationMode === 'm_plus') {
                                const playedS = indicesSets.length;
                                const sWSum = indicesSets.reduce((acc, i) => acc + (setsWonByRound[i] || 0), 0);
                                const avgS = playedS > 0 ? Math.round(sWSum / playedS) : 0;
                                const missingS = Math.max(0, maxMatches - playedS);
                                const addS = missingS * avgS;
                                const effSW = sWSum + addS;
                                // По аналогии с геймами: в режиме M+ показываем одно число и коэффициент 1
                                setsRatioDisplay = String(effSW);
                                setsFractionDisplay = '1';
                              }
                            }

                            return (
                              <>
                                {scheduleRounds.map((round: any, idx: number) => {
                                  const val = pointsByRound[idx];
                                  if (val === null) {
                                    const isRest = !((round.matches || []) as any[]).some((sm: any)=> (sm.team1_players||[]).concat(sm.team2_players||[]).some((p:any)=> playerIds.has(Number(p.id))));
                                    return (
                                      <td key={round.round} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center', background: isRest ? '#f1f5f9' : undefined }}>—</td>
                                    );
                                  }
                                  return (
                                    <td key={round.round} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center', fontWeight: 600 }}>{val}</td>
                                  );
                                })}
                                <td style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{gmDisplay}</td>
                                <td className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{computedWins}</td>
                                <td className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{setsRatioDisplay}</td>
                                <td className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{setsFractionDisplay}</td>
                                <td style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{gamesDisplay}</td>
                                <td className={showTech ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{gamesRatioDisplay}</td>
                                {/* Место: римской цифрой полужирно */}
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

              {/* Расписание игр (после фиксации: две области — слева текст A+B vs C+D, справа плитки матчей) */}
              <div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: 12 }}>Расписание игр</h3>
                {(() => {
                  // Построим карту: playerId -> буква строки (A..). Нормализуем ключи к Number
                  const playerToLetter = new Map<number, string>();
                  (groupData.participants || []).forEach((pt: any) => {
                    const letter = String.fromCharCode(64 + (pt.row_index || 0));
                    const team: any = pt.team || {};
                    const p1 = team.player_1 ?? team.player1_id;
                    const p2 = team.player_2 ?? team.player2_id;
                    if (p1 != null) playerToLetter.set(Number(p1), letter);
                    if (p2 != null) playerToLetter.set(Number(p2), letter);
                    if (Array.isArray(team.players)) {
                      team.players.forEach((pl: any) => {
                        const pid = pl?.id ?? pl?.player_id;
                        if (pid != null) playerToLetter.set(Number(pid), letter);
                      });
                    }
                  });

                  const canClick = effectiveLocked && !completed && canManageMatches;

                  return (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      {/* Левая колонка: текстовые строки A+B vs C+D по алгоритму индексов (как в Created) */}
                      <div style={{ minWidth: 260 }}>
                        {(() => {
                          const n = (groupData.participants || []).length;
                          const toLetter = (i: number) => String.fromCharCode(65 + i); // 0->A
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
                          const build = (cnt: number): { round: number; matches: [number[], number[]][] }[] => {
                            const res: { round: number; matches: [number[], number[]][] }[] = [];
                            if (cnt === 4) {
                              const cfg: [number[], number[]][] = [[[0,1],[2,3]], [[0,2],[1,3]], [[0,3],[1,2]]];
                              cfg.forEach((m,i)=>res.push({ round: i+1, matches: [m] }));
                              return res;
                            }
                            if (cnt === 5) {
                              const cfg: [number[], number[], number[]][] = [[[0,1],[2,3],[4]], [[0,2],[3,4],[1]], [[0,3],[1,4],[2]], [[0,4],[1,2],[3]], [[1,3],[2,4],[0]]];
                              cfg.forEach(([a,b],i)=>res.push({ round: i+1, matches: [[a,b]] }));
                              return res;
                            }
                            if (cnt === 6) {
                              const cfg: [number[], number[], number[]][] = [[[0,1],[2,3],[4,5]], [[1,5],[3,4],[0,2]], [[0,2],[4,5],[1,3]], [[2,4],[1,3],[0,5]], [[0,4],[2,5],[1,3]], [[0,3],[1,4],[2,5]], [[3,5],[2,4],[0,1]], [[0,5],[1,2],[3,4]]];
                              cfg.forEach(([a,b],i)=>res.push({ round: i+1, matches: [[a,b]] }));
                              return res;
                            }
                            const rr = (cnt % 2 === 0) ? generateEvenRR(cnt) : generateOddRR(cnt);
                            rr.forEach((pairs, rIdx) => {
                              const matches: [number[], number[]][] = [];
                              for (let i = 0; i + 1 < pairs.length; i += 2) {
                                matches.push([[pairs[i][0], pairs[i][1]], [pairs[i+1][0], pairs[i+1][1]]]);
                              }
                              res.push({ round: rIdx + 1, matches });
                            });
                            return res;
                          };
                          const rounds = build(n);
                          return (
                            <div className="flex flex-col gap-1">
                              {rounds.map((r) => (
                                <div key={r.round} className="grid grid-cols-[auto_1fr] gap-x-8">
                                  {r.matches.map((m, mi) => (
                                    <React.Fragment key={mi}>
                                      <span className={mi === 0 ? 'font-medium' : 'opacity-0 select-none'}>{`Тур ${r.round}:`}</span>
                                      <span className="text-sm">{m[0].map(toLetter).join('+')} vs {m[1].map(toLetter).join('+')}</span>
                                    </React.Fragment>
                                  ))}
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
                              const team1Players = match.team1_players;
                              const team2Players = match.team2_players;
                              const team1Name = team1Players.map((p: any) => showFullName ? p.name : p.display_name).join(' + ');
                              const team2Name = team2Players.map((p: any) => showFullName ? p.name : p.display_name).join(' + ');
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
                                  onClick={() => {
                                    if (!canClick) return;
                                    setScoreInput({
                                      matchId: match.id,
                                      team1: { id: team1Players[0]?.id || 0, name: team1Name },
                                      team2: { id: team2Players[0]?.id || 0, name: team2Name },
                                      existingSets: (match as any).sets || []
                                    });
                                  }}
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
                                  <div style={{ fontWeight: 700 }}>
                                    {match.score || 'vs'}
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
                                      const avg = Math.round(vals.reduce((a: number, b: number)=>a+b,0) / vals.length);
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
                  );
                })()}
              </div>
            </div>
          )})}
        </div>
      )}

      {/* Сообщение для созданного турнира */}
      {tournament.status === 'created' && (
        <div className="bg-blue-50 border border-blue-200 rounded p-4">
          <p className="text-blue-800">
            Добавьте участников и установите чекбокс "Зафиксировать участников" для генерации расписания матчей.
          </p>
        </div>
      )}

      {/* Модалка выбора участника */}
      {pickerOpen && (
        <ParticipantPickerModal
          open={true}
          onClose={() => setPickerOpen(null)}
          tournamentId={tournamentId}
          groupIndex={pickerOpen.group}
          rowIndex={pickerOpen.row}
          isDoubles={tournament.participant_mode === 'doubles'}
          usedPlayerIds={[]}
          onSaved={async () => {
            setPickerOpen(null);
            await loadTournament();
          }}
        />
      )}

      {/* Модалка ввода счета */}
      {scoreInput && (
        <MatchScoreModal
          isOpen={true}
          onClose={() => setScoreInput(null)}
          team1={scoreInput.team1}
          team2={scoreInput.team2}
          setFormat={(tournament as any)?.set_format}
          onSave={async () => {
            // Простое сохранение счета (не используется для Кинг)
            console.log('Simple save not implemented for King');
          }}
          onSaveFull={async (sets) => {
            if (!tournament || !scoreInput) return;
            await api.post(`/tournaments/${tournament.id}/match_save_score_full/`, {
              match_id: scoreInput.matchId,
              sets,
            });
            setScoreInput(null);
            loadTournament();
            loadSchedule();
          }}
        />
      )}

      {/* Нижняя панель действий */}
      <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }} data-export-exclude="true">
        {canManageTournament && !completed && (
          <button className="btn" onClick={completeTournament} disabled={saving}>Завершить турнир</button>
        )}
        {canDeleteTournament && (
          <button className="btn" onClick={deleteTournament} disabled={saving} style={{ background: '#dc3545', borderColor: '#dc3545' }}>Удалить турнир</button>
        )}
        <button className="btn" onClick={handleShare}>Поделиться</button>
      </div>
    </div>
  );
};
