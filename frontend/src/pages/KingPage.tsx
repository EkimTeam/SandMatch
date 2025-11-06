import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { tournamentApi, Tournament, KingScheduleResponse, KingCalculationMode, Ruleset } from '../services/api';
import { ParticipantPickerModal } from '../components/ParticipantPickerModal';
import { MatchScoreModal } from '../components/MatchScoreModal';
import { computeKingGroupRanking } from '../utils/kingRanking';

export const KingPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tournamentId = parseInt(id || '0', 10);

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

  // Загрузка данных турнира
  useEffect(() => {
    loadTournament();
  }, [tournamentId]);

  // Загрузка расписания
  useEffect(() => {
    if (tournament && tournament.status === 'active') {
      loadSchedule();
    }
  }, [tournament]);

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

  const loadTournament = async () => {
    try {
      setLoading(true);
      const data = await tournamentApi.getById(tournamentId);
      console.log('Loaded tournament data:', data);
      console.log('Participants:', data.participants);
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
      setError(err.response?.data?.error || 'Ошибка загрузки турнира');
    } finally {
      setLoading(false);
    }
  };

  const handleRulesetChange = async (rulesetId: number) => {
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
    if (!tournament) return;
    
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
    if (!tournament || !window.confirm('Завершить турнир?')) return;
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
    if (!tournament || !window.confirm('Удалить турнир безвозвратно?')) return;
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
      {/* Заголовок */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">{tournament.name}</h1>
        <div className="flex gap-4 text-sm text-gray-600">
          <span>Система: Кинг</span>
          <span>Статус: {tournament.status === 'created' ? 'Создан' : tournament.status === 'active' ? 'Активен' : 'Завершён'}</span>
          <span>Участников: {tournament.participants_count}</span>
        </div>
      </div>

      {/* Радиокнопки G- / M+ / NO */}
      {tournament.status === 'active' && (
        <div className="mb-4 flex items-center gap-4 flex-wrap" data-export-exclude="true">
          <span className="font-semibold">Режим подсчета:</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              value="g_minus"
              checked={calculationMode === 'g_minus'}
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
              onChange={(e) => handleCalculationModeChange(e.target.value as KingCalculationMode)}
              className="cursor-pointer"
            />
            <span>NO</span>
          </label>
          {(() => {
            const tip = "При разном количестве сыгранных матчей:\n"+
              "'G-' — не учитывает последний матч(и), которые больше минимально сыгранных для игрока матчей.\n"+
              "'M+' — за несыгранные до максимального количества матч(и) добавляется среднее число геймов.\n"+
              "'NO' — не учитывает разное количество сыгранных матчей.";
            return (
              <span title={tip} className="text-gray-500 cursor-help select-none">ℹ️</span>
            );
          })()}
          {/* Регламент: выпадающий список */}
          <span className="font-semibold ml-4">Регламент:</span>
          <div className="flex-1 min-w-[240px]" style={{ maxWidth: '100%' }}>
            <select
              className="w-full border rounded px-2 py-1 text-sm"
              value={tournament.ruleset?.id || ''}
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

      {/* Таблица и расписание */}
      {tournament.status === 'created' && (
        <div>
          {Array.from({ length: tournament.groups_count || 1 }, (_, gi) => {
            const groupIndex = gi + 1;
            const totalParticipants = tournament.planned_participants || 0;
            const participantsInGroup = Math.ceil(totalParticipants / (tournament.groups_count || 1));
            
            // Получаем участников для этой группы (используем поле group_index из API)
            const groupParticipants = (tournament.participants as any[] | undefined)?.filter((p: any) => p.group_index === groupIndex) || [];
            
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
                        
                        return (
                          <tr key={rowIndex}>
                            <td style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{rowLetter}</td>
                            <td
                              className="cell-click"
                              style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'left', cursor: 'pointer' }}
                              onClick={() => !effectiveLocked && setPickerOpen({ group: groupIndex, row: rowIndex })}
                            >
                              {participantName}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Расписание игр (до фиксации: только текстовый список + кнопка) */}
                <div style={{ marginTop: 20 }}>
                  <div className="text-sm mt-3" data-export-exclude="true" style={{ minWidth: 260 }}>
                    <div className="font-medium mb-1">Порядок игр:</div>
                    {(() => {
                      // Генерируем расписание King на основе количества участников
                      const numParticipants = participantsInGroup;
                      if (numParticipants < 4) {
                        return <div className="text-gray-500">Недостаточно участников для генерации расписания (минимум 4)</div>;
                      }
                      
                      // Генерация матчей King по алгоритму из KingTournament.py
                      const generateKingMatches = (n: number): { round: number; matches: [number[], number[]][]; resting: number[] }[] => {
                        const rounds: { round: number; matches: [number[], number[]][]; resting: number[] }[] = [];
                        
                        if (n === 4) {
                          // 4 игрока - 3 раунда
                          const matches: [number[], number[]][] = [
                            [[0, 1], [2, 3]],
                            [[0, 2], [1, 3]],
                            [[0, 3], [1, 2]]
                          ];
                          matches.forEach((match, i) => {
                            rounds.push({ round: i + 1, matches: [match], resting: [] });
                          });
                        } else if (n === 5) {
                          // 5 игроков - 5 раундов
                          const roundsConfig: [number[], number[], number[]][] = [
                            [[0, 1], [2, 3], [4]],
                            [[0, 2], [3, 4], [1]],
                            [[0, 3], [1, 4], [2]],
                            [[0, 4], [1, 2], [3]],
                            [[1, 3], [2, 4], [0]]
                          ];
                          roundsConfig.forEach(([team1, team2, rest], i) => {
                            rounds.push({ round: i + 1, matches: [[team1, team2]], resting: rest });
                          });
                        } else if (n === 6) {
                          // 6 игроков - 8 раундов
                          const roundsConfig: [number[], number[], number[]][] = [
                            [[0, 1], [2, 3], [4, 5]],
                            [[1, 5], [3, 4], [0, 2]],
                            [[0, 2], [4, 5], [1, 3]],
                            [[2, 4], [1, 3], [0, 5]],
                            [[0, 4], [2, 5], [1, 3]],
                            [[0, 3], [1, 4], [2, 5]],
                            [[3, 5], [2, 4], [0, 1]],
                            [[0, 5], [1, 2], [3, 4]]
                          ];
                          roundsConfig.forEach(([team1, team2, rest], i) => {
                            rounds.push({ round: i + 1, matches: [[team1, team2]], resting: rest });
                          });
                        } else {
                          // Для 7+ игроков - упрощенная генерация
                          // TODO: Реализовать полный алгоритм из KingTournament.py
                          return rounds;
                        }
                        
                        return rounds;
                      };
                      
                      const kingSchedule = generateKingMatches(numParticipants);
                      
                      if (kingSchedule.length === 0) {
                        return <div className="text-gray-500">Расписание для {numParticipants} участников пока не реализовано</div>;
                      }
                      
                      return (
                        <div className="flex flex-col gap-1">
                          {kingSchedule.map((roundData) => (
                            <div key={roundData.round} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <span>Тур {roundData.round}:</span>
                              {roundData.matches.map((match, mi) => {
                                const [team1, team2] = match;
                                const team1Letters = team1.map(p => String.fromCharCode(65 + p)).join('+');
                                const team2Letters = team2.map(p => String.fromCharCode(65 + p)).join('+');
                                return (
                                  <span key={mi}>
                                    {team1Letters} vs {team2Letters}
                                  </span>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  
                  {/* Кнопка выбора формата расписания */}
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
                            } catch (_) {
                              // ignore parse error
                            }
                          } else if (typeof raw === 'object') {
                            const nbspName = groupName.replace(' ', '\u00A0');
                            const val = raw?.[groupName] ?? raw?.[nbspName];
                            if (val != null && val !== '') currentPatternId = Number(val);
                          }
                        }
                        // TODO: Открыть модалку выбора формата расписания
                        console.log('Open schedule pattern modal', { groupName, participantsInGroup, currentPatternId });
                      }}
                      className="mt-2 px-3 py-1.5 text-sm text-white bg-green-600 rounded hover:bg-green-700 transition-colors"
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

      {tournament.status === 'active' && schedule && (
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
                            {showFullName ? participant.name : participant.display_name}
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
                  // Построим карту: playerId -> буква строки (A..)
                  const playerToLetter = new Map<number, string>();
                  (groupData.participants || []).forEach((pt: any) => {
                    const letter = String.fromCharCode(64 + (pt.row_index || 0));
                    const team: any = pt.team || {};
                    if (team.player_1) playerToLetter.set(team.player_1, letter);
                    if (team.player_2) playerToLetter.set(team.player_2, letter);
                    if (Array.isArray(team.players)) {
                      team.players.forEach((pl: any) => {
                        if (pl?.id) playerToLetter.set(pl.id, letter);
                      });
                    }
                  });

                  const canClick = effectiveLocked && !completed;

                  return (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      {/* Левая колонка: текстовые строки по алгоритму (A+B vs C+D) */}
                      <div style={{ minWidth: 260 }}>
                        {(() => {
                          const n = (groupData.participants || []).length;
                          const gen = (cnt: number): { round: number; matches: [number[], number[]][] }[] => {
                            const res: { round: number; matches: [number[], number[]][] }[] = [];
                            if (cnt === 4) {
                              const cfg: [number[], number[]][] = [[[0,1],[2,3]], [[0,2],[1,3]], [[0,3],[1,2]]];
                              cfg.forEach((m,i)=>res.push({ round: i+1, matches: [m] }));
                            } else if (cnt === 5) {
                              const cfg: [number[], number[], number[]][] = [[[0,1],[2,3],[4]], [[0,2],[3,4],[1]], [[0,3],[1,4],[2]], [[0,4],[1,2],[3]], [[1,3],[2,4],[0]]];
                              cfg.forEach(([a,b],i)=>res.push({ round: i+1, matches: [[a,b]] }));
                            } else if (cnt === 6) {
                              const cfg: [number[], number[], number[]][] = [[[0,1],[2,3],[4,5]], [[1,5],[3,4],[0,2]], [[0,2],[4,5],[1,3]], [[2,4],[1,3],[0,5]], [[0,4],[2,5],[1,3]], [[0,3],[1,4],[2,5]], [[3,5],[2,4],[0,1]], [[0,5],[1,2],[3,4]]];
                              cfg.forEach(([a,b],i)=>res.push({ round: i+1, matches: [[a,b]] }));
                            }
                            return res;
                          };
                          const rounds = gen(n);
                          return rounds.map(r => (
                            <div key={r.round} className="text-sm" style={{ marginBottom: 8 }}>
                              <span className="font-medium">Тур {r.round}:</span>{' '}
                              {r.matches.map((m, mi) => {
                                const t1 = m[0].map(x => String.fromCharCode(65 + x)).join('+');
                                const t2 = m[1].map(x => String.fromCharCode(65 + x)).join('+');
                                return <span key={mi} style={{ marginRight: 8 }}>{t1} vs {t2}</span>;
                              })}
                            </div>
                          ));
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
        {!completed && (
          <button className="btn" onClick={completeTournament} disabled={saving}>Завершить турнир</button>
        )}
        <button className="btn" onClick={deleteTournament} disabled={saving} style={{ background: '#dc3545', borderColor: '#dc3545' }}>Удалить турнир</button>
        <button className="btn" onClick={handleShare}>Поделиться</button>
      </div>
    </div>
  );
};
