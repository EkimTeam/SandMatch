import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { scheduleApi, ScheduleConflictsResponse, ScheduleDTO, SchedulePlannedTimesResponse, tournamentApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

export const SchedulePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { user } = useAuth();

  const tournamentId = id ? Number(id) : NaN;

  const role = user?.role;
  const canManage = role === 'ADMIN' || role === 'ORGANIZER';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleDTO | null>(null);

  const [courtsCount, setCourtsCount] = useState<number>(6);
  const [matchDuration, setMatchDuration] = useState<number>(40);
  const [startTime, setStartTime] = useState<string>('10:00');

  const [planned, setPlanned] = useState<SchedulePlannedTimesResponse | null>(null);
  const [conflicts, setConflicts] = useState<ScheduleConflictsResponse | null>(null);
  const [pool, setPool] = useState<any[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const conflictsSlotIds = useMemo(() => {
    const ids = new Set<number>();
    for (const run of conflicts?.runs || []) {
      for (const p of run.players || []) {
        for (const occ of p.occurrences || []) {
          if (occ.slot_id) ids.add(occ.slot_id);
        }
      }
    }
    return ids;
  }, [conflicts]);

  const slotsByRunCourt = useMemo(() => {
    const map = new Map<string, any>();
    if (!schedule) return map;

    const runIndexById = new Map<number, number>();
    schedule.runs.forEach(r => runIndexById.set(r.id, r.index));

    const courtIndexById = new Map<number, number>();
    schedule.courts.forEach(c => courtIndexById.set(c.id, c.index));

    for (const s of schedule.slots || []) {
      const ri = runIndexById.get(s.run);
      const ci = courtIndexById.get(s.court);
      if (!ri || !ci) continue;
      map.set(`${ri}:${ci}`, s);
    }
    return map;
  }, [schedule]);

  const poolUnassigned = useMemo(() => pool.filter((m: any) => !m?.is_assigned), [pool]);
  const poolAssigned = useMemo(() => pool.filter((m: any) => m?.is_assigned), [pool]);

  const matchById = useMemo(() => {
    const map = new Map<number, any>();
    for (const m of pool || []) {
      if (m?.id) map.set(Number(m.id), m);
    }
    return map;
  }, [pool]);

  const slotIdByRunCourt = useMemo(() => {
    const map = new Map<string, number>();
    if (!schedule) return map;

    const runIndexById = new Map<number, number>();
    schedule.runs.forEach(r => runIndexById.set(r.id, r.index));

    const courtIndexById = new Map<number, number>();
    schedule.courts.forEach(c => courtIndexById.set(c.id, c.index));

    for (const s of schedule.slots || []) {
      const ri = runIndexById.get(s.run);
      const ci = courtIndexById.get(s.court);
      if (!ri || !ci) continue;
      map.set(`${ri}:${ci}`, s.id);
    }
    return map;
  }, [schedule]);

  const getMatchTitle = (matchId: number | null | undefined): string => {
    if (!matchId) return '';
    const m = matchById.get(Number(matchId));
    if (!m) return `Матч #${matchId}`;
    const t1 = m?.team_1?.full_name || m?.team_1?.display_name || m?.team_1?.name;
    const t2 = m?.team_2?.full_name || m?.team_2?.display_name || m?.team_2?.name;
    if (t1 && t2) return `${t1} vs ${t2}`;
    if (t1 || t2) return `${t1 || 'TBD'} vs ${t2 || 'TBD'}`;
    return `Матч #${matchId}`;
  };

  const refreshSideData = async (scheduleId: number) => {
    const [pt, cf, mp] = await Promise.all([
      scheduleApi.plannedTimes(scheduleId),
      scheduleApi.conflicts(scheduleId),
      scheduleApi.matchesPool(scheduleId),
    ]);
    setPlanned(pt);
    setConflicts(cf);
    setPool(mp.matches || []);
  };

  const buildSavePayloadFromSchedule = (sch: ScheduleDTO) => {
    return {
      match_duration_minutes: matchDuration,
      courts: sch.courts.map(c => ({
        index: c.index,
        name: c.name,
        first_start_time: c.first_start_time,
      })),
      runs: sch.runs.map(r => ({
        index: r.index,
        start_mode: r.start_mode,
        start_time: r.start_time,
        not_earlier_time: r.not_earlier_time,
      })),
      slots: sch.slots
        .map(s => {
          const run = sch.runs.find(r => r.id === s.run);
          const court = sch.courts.find(c => c.id === s.court);
          return {
            run_index: run?.index || 0,
            court_index: court?.index || 0,
            slot_type: s.slot_type,
            match_id: s.match,
            text_title: s.text_title,
            text_subtitle: s.text_subtitle,
            override_title: s.override_title,
            override_subtitle: s.override_subtitle,
          };
        })
        .filter(x => x.run_index && x.court_index),
      global_breaks: sch.global_breaks.map(b => ({
        position: b.position,
        time: b.time,
        text: b.text,
      })),
    };
  };

  const autoAssignAndSave = async (sch: ScheduleDTO) => {
    const mp = await scheduleApi.matchesPool(sch.id);
    const matches = mp.matches || [];
    const unassigned = matches.filter((m: any) => !m?.is_assigned);

    const courts = [...sch.courts].sort((a, b) => a.index - b.index);
    const runs = [...sch.runs].sort((a, b) => a.index - b.index);

    const newSlots: any[] = [];
    let ptr = 0;

    for (const r of runs) {
      for (const c of courts) {
        const key = `${r.index}:${c.index}`;
        const existingSlotId = slotIdByRunCourt.get(key);
        const existing = existingSlotId ? sch.slots.find(s => s.id === existingSlotId) : undefined;
        const alreadyHasMatch = !!existing?.match;
        if (alreadyHasMatch) {
          continue;
        }

        const next = unassigned[ptr];
        if (!next?.id) break;
        ptr += 1;

        newSlots.push({
          run_index: r.index,
          court_index: c.index,
          slot_type: 'match',
          match_id: next.id,
          text_title: null,
          text_subtitle: null,
          override_title: null,
          override_subtitle: null,
        });
      }
    }

    const payload: any = buildSavePayloadFromSchedule(sch);
    payload.slots = [...(payload.slots || []), ...newSlots];

    const res = await scheduleApi.save(sch.id, payload);
    setSchedule(res.schedule);
    await refreshSideData(res.schedule.id);
  };

  const load = async () => {
    if (!Number.isFinite(tournamentId)) {
      setError('Некорректный ID турнира');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const t = await tournamentApi.getById(tournamentId);
      if (t?.start_time) setStartTime(t.start_time as any);
      if (t?.date && typeof t.date === 'string') {
        // date stays server side, we only use start_time in generation
      }

      const res = await tournamentApi.getSchedule(tournamentId);
      const sch = res?.schedule || null;
      setSchedule(sch);
      if (sch?.match_duration_minutes) setMatchDuration(sch.match_duration_minutes);
      if (sch?.courts?.length) setCourtsCount(sch.courts.length);
      const st = sch?.courts?.sort((a, b) => a.index - b.index)?.[0]?.first_start_time || sch?.runs?.sort((a, b) => a.index - b.index)?.[0]?.start_time;
      if (st) setStartTime(st);

      if (sch?.id) {
        await refreshSideData(sch.id);
      } else {
        setPlanned(null);
        setConflicts(null);
        setPool([]);
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  const handleGenerate = async () => {
    if (!canManage) return;
    setSaving(true);
    try {
      const res: any = await tournamentApi.generateSchedule(tournamentId, {
        courts_count: courtsCount,
        match_duration_minutes: matchDuration,
        start_time: startTime,
      });
      if (!res?.ok) {
        alert(res?.detail || res?.error || 'Не удалось создать расписание');
        return;
      }
      setSchedule(res.schedule);
      await refreshSideData(res.schedule.id);
      await autoAssignAndSave(res.schedule);
    } finally {
      setSaving(false);
    }
  };

  const handleApplySettings = async () => {
    if (!schedule || !canManage) return;
    setSaving(true);
    try {
      const next: ScheduleDTO = {
        ...schedule,
        match_duration_minutes: matchDuration,
        courts: schedule.courts.map(c => ({
          ...c,
          first_start_time: startTime,
        })),
        runs: schedule.runs
          .slice()
          .sort((a, b) => a.index - b.index)
          .map(r => {
            if (r.index === 1) {
              return { ...r, start_mode: 'fixed', start_time: startTime, not_earlier_time: null };
            }
            return { ...r, start_mode: 'then', start_time: null, not_earlier_time: null };
          }),
      };

      const payload = buildSavePayloadFromSchedule(next);
      const res = await scheduleApi.save(schedule.id, payload as any);
      setSchedule(res.schedule);
      await refreshSideData(res.schedule.id);
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось применить настройки');
    } finally {
      setSaving(false);
    }
  };

  const handleAutoFill = async () => {
    if (!schedule || !canManage) return;
    setSaving(true);
    try {
      await autoAssignAndSave(schedule);
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось автозаполнить');
    } finally {
      setSaving(false);
    }
  };

  const applyAssign = (runIndex: number, courtIndex: number, matchId: number | null) => {
    if (!schedule) return;
    const run = schedule.runs.find(r => r.index === runIndex);
    const court = schedule.courts.find(c => c.index === courtIndex);
    if (!run || !court) return;

    const existingSlot = slotsByRunCourt.get(`${runIndex}:${courtIndex}`);
    const prevMatchId: number | null = existingSlot?.match ? Number(existingSlot.match) : null;

    setSchedule(prev => {
      if (!prev) return prev;
      const existing = prev.slots.find(s => s.run === run.id && s.court === court.id);
      if (existing) {
        return {
          ...prev,
          slots: prev.slots.map(s => (s.id === existing.id ? { ...s, slot_type: 'match', match: matchId } : s)),
        };
      }
      return {
        ...prev,
        slots: [
          ...prev.slots,
          {
            id: -Date.now(),
            run: run.id,
            court: court.id,
            slot_type: 'match',
            match: matchId,
            text_title: null,
            text_subtitle: null,
            override_title: null,
            override_subtitle: null,
          },
        ],
      };
    });

    setPool(prev => {
      // оптимистично обновим индикатор в backlog
      const next = prev.map(m => {
        if (!m?.id) return m;
        if (matchId && Number(m.id) === Number(matchId)) return { ...m, is_assigned: true };
        if (prevMatchId && Number(m.id) === Number(prevMatchId) && (!matchId || Number(prevMatchId) !== Number(matchId))) {
          return { ...m, is_assigned: false };
        }
        return m;
      });
      return next;
    });
  };

  const handleSave = async () => {
    if (!schedule) return;
    setSaving(true);
    try {
      const payload = {
        ...buildSavePayloadFromSchedule(schedule),
      };

      const res = await scheduleApi.save(schedule.id, payload as any);
      setSchedule(res.schedule);
      await refreshSideData(res.schedule.id);
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const handleExportPdf = async () => {
    if (!schedule) return;
    setExporting(true);
    try {
      const blob = await scheduleApi.exportPdf(schedule.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schedule_${schedule.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось экспортировать PDF');
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <div className="card">Загрузка…</div>;

  if (error) {
    return (
      <div className="card">
        <div style={{ marginBottom: 12, fontWeight: 600 }}>Ошибка</div>
        <div style={{ marginBottom: 12 }}>{error}</div>
        <button className="btn" onClick={() => nav(`/tournaments/${tournamentId}`)}>Назад</button>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 1400 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Расписание</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {schedule && (
            <>
              <button className="btn" disabled={saving || !canManage} onClick={handleSave}>Сохранить</button>
              <button className="btn" disabled={exporting} onClick={handleExportPdf}>Экспорт PDF</button>
            </>
          )}
        </div>
      </div>

      {!schedule && (
        <div className="card">
          <div style={{ marginBottom: 10, fontWeight: 600 }}>Расписание ещё не создано</div>
          {!canManage ? (
            <div>Создание расписания доступно только организатору/админу.</div>
          ) : (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <div className="text-sm" style={{ marginBottom: 4 }}>Корты</div>
                <input className="input" type="number" min={1} value={courtsCount} onChange={e => setCourtsCount(Number(e.target.value))} />
              </div>
              <div>
                <div className="text-sm" style={{ marginBottom: 4 }}>Длительность матча, мин</div>
                <input className="input" type="number" min={10} value={matchDuration} onChange={e => setMatchDuration(Number(e.target.value))} />
              </div>
              <div>
                <div className="text-sm" style={{ marginBottom: 4 }}>Старт</div>
                <input className="input" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
              </div>
              <button className="btn" disabled={saving} onClick={handleGenerate}>Создать</button>
            </div>
          )}
        </div>
      )}

      {schedule && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12, alignItems: 'start' }}>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Backlog матчей</div>
            <div className="text-sm" style={{ marginBottom: 10, opacity: 0.8 }}>
              Выбери матч, затем кликни по ячейке запуска/корта.
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button className="btn" onClick={() => setSelectedMatchId(null)}>
                Снять выбор
              </button>
              <button className="btn" onClick={handleAutoFill} disabled={!canManage || saving}>
                Автозаполнить
              </button>
              <div className="text-sm" style={{ alignSelf: 'center', opacity: 0.75 }}>
                Выбран: {selectedMatchId ? `#${selectedMatchId}` : '—'}
              </div>
            </div>

            <div style={{ maxHeight: 520, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontWeight: 600 }}>Не назначены ({poolUnassigned.length})</div>
              {poolUnassigned.slice(0, 200).map((m: any) => {
                const isSelected = selectedMatchId === m.id;
                return (
                  <button
                    key={m.id}
                    className="btn"
                    style={{
                      textAlign: 'left',
                      background: isSelected ? '#111827' : undefined,
                      color: isSelected ? '#fff' : undefined,
                    }}
                    onClick={() => setSelectedMatchId(m.id)}
                  >
                    <span style={{ display: 'inline-block', width: 18 }}>
                      <span style={{ color: '#dc3545', fontWeight: 700 }}>●</span>
                    </span>
                    #{m.id} {m?.team_1?.full_name || m?.team_1?.display_name || 'TBD'} vs {m?.team_2?.full_name || m?.team_2?.display_name || 'TBD'}
                  </button>
                );
              })}

              <div style={{ fontWeight: 600, marginTop: 10 }}>Назначены ({poolAssigned.length})</div>
              {poolAssigned.slice(0, 50).map((m: any) => (
                <div key={m.id} className="text-sm" style={{ opacity: 0.8 }}>
                  <span style={{ display: 'inline-block', width: 18 }}>
                    <span style={{ color: '#28a745', fontWeight: 700 }}>●</span>
                  </span>
                  #{m.id} {m?.team_1?.full_name || m?.team_1?.display_name || 'TBD'} vs {m?.team_2?.full_name || m?.team_2?.display_name || 'TBD'}
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <div className="text-sm" style={{ marginBottom: 4 }}>Длительность матча, мин</div>
              <input className="input" type="number" min={10} value={matchDuration} onChange={e => setMatchDuration(Number(e.target.value))} disabled={!canManage} />
            </div>
            <div>
              <div className="text-sm" style={{ marginBottom: 4 }}>Кортов</div>
              <input className="input" type="number" min={1} value={courtsCount} onChange={e => setCourtsCount(Number(e.target.value))} disabled={!canManage} />
            </div>
            <div>
              <div className="text-sm" style={{ marginBottom: 4 }}>Начало</div>
              <input className="input" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} disabled={!canManage} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={handleApplySettings} disabled={!canManage || saving}>
                Применить настройки
              </button>
              <button className="btn" onClick={handleGenerate} disabled={!canManage || saving}>
                Пересоздать и расставить
              </button>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="text-sm">Дата: <strong>{schedule.date}</strong></div>
            </div>
          </div>

          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee', minWidth: 140 }}>Запуск</th>
                {schedule.courts.sort((a,b)=>a.index-b.index).map(c => (
                  <th key={c.id} style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #f2f2f2', borderLeft: '1px solid #e5e7eb' }}>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedule.runs.sort((a,b)=>a.index-b.index).map(r => {
                const plannedTime = planned?.runs?.find(x => x.index === r.index)?.planned_start_time;
                return (
                  <tr key={r.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid #f2f2f2', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 600 }}>Запуск {r.index}</div>
                      <div className="text-sm" style={{ opacity: 0.8 }}>План: {plannedTime || '—'}</div>
                    </td>
                    {schedule.courts.sort((a,b)=>a.index-b.index).map(c => {
                      const slot = slotsByRunCourt.get(`${r.index}:${c.index}`);
                      const isConflict = slot?.id ? conflictsSlotIds.has(slot.id) : false;
                      const hasMatch = !!slot?.match;
                      return (
                        <td
                          key={c.id}
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #f2f2f2',
                            borderLeft: '1px solid #e5e7eb',
                            background: isConflict ? '#FEE2E2' : undefined,
                            verticalAlign: 'top'
                          }}
                          onClick={() => {
                            if (!canManage) return;
                            if (selectedMatchId) {
                              applyAssign(r.index, c.index, selectedMatchId);
                            } else if (hasMatch) {
                              applyAssign(r.index, c.index, null);
                            }
                          }}
                        >
                          <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {slot?.override_title || slot?.text_title || (slot?.match ? getMatchTitle(slot.match) : '') || ''}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
};
