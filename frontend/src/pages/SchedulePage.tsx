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
  const [tournamentSystem, setTournamentSystem] = useState<string | null>(null);
  const [rrTeamRowById, setRrTeamRowById] = useState<Map<number, number>>(new Map());

  const [planned, setPlanned] = useState<SchedulePlannedTimesResponse | null>(null);
  const [conflicts, setConflicts] = useState<ScheduleConflictsResponse | null>(null);
  const [pool, setPool] = useState<any[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [dragMatchId, setDragMatchId] = useState<number | null>(null);
  const [dragSource, setDragSource] = useState<{ runIndex: number; courtIndex: number } | null>(null);
  const [dragOverCell, setDragOverCell] = useState<{ runIndex: number; courtIndex: number } | null>(null);
  const [dragOverUnassigned, setDragOverUnassigned] = useState<boolean>(false);

  const [localConflictsSlotIds, setLocalConflictsSlotIds] = useState<Set<number> | null>(null);

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedSchedule, setLastSavedSchedule] = useState<ScheduleDTO | null>(null);

  const [viewMode, setViewMode] = useState<'grid' | 'timeline'>('grid');
  const [showFact, setShowFact] = useState<boolean>(true);
  const [liveState, setLiveState] = useState<Map<number, { status: string; started_at: string | null; finished_at: string | null }>>(new Map());

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

  const poolUnassigned = useMemo(() => pool.filter((m: any) => !m?.is_assigned), [pool]);
  const poolAssigned = useMemo(() => pool.filter((m: any) => m?.is_assigned), [pool]);

  const matchById = useMemo(() => {
    const map = new Map<number, any>();
    for (const m of pool || []) {
      if (m?.id) map.set(Number(m.id), m);
    }
    return map;
  }, [pool]);

  useEffect(() => {
    if (!schedule) {
      setLocalConflictsSlotIds(null);
      return;
    }

    const runIndexById = new Map<number, number>();
    schedule.runs.forEach(r => runIndexById.set(r.id, r.index));

    const slotsByRun = new Map<number, Array<{ slotId: number; matchId: number; playerIds: number[] }>>();

    for (const s of schedule.slots || []) {
      if (!s?.match || !s?.id) continue;
      const m = matchById.get(Number(s.match));
      if (!m) continue;
      const runIndex = runIndexById.get(s.run);
      if (!runIndex) continue;

      const pids: number[] = [];
      const t1p1 = m?.team_1?.player_1?.id;
      const t1p2 = m?.team_1?.player_2?.id;
      const t2p1 = m?.team_2?.player_1?.id;
      const t2p2 = m?.team_2?.player_2?.id;
      if (t1p1) pids.push(Number(t1p1));
      if (t1p2) pids.push(Number(t1p2));
      if (t2p1) pids.push(Number(t2p1));
      if (t2p2) pids.push(Number(t2p2));

      if (!pids.length && tournamentSystem !== 'knockout') continue;
      const arr = slotsByRun.get(runIndex) || [];
      arr.push({ slotId: Number(s.id), matchId: Number(s.match), playerIds: pids });
      slotsByRun.set(runIndex, arr);
    }

    const conflictIds = new Set<number>();
    for (const [, entries] of slotsByRun) {
      const counts = new Map<number, number>();
      for (const e of entries) {
        for (const pid of e.playerIds) counts.set(pid, (counts.get(pid) || 0) + 1);
      }
      const conflictPlayers = new Set<number>();
      for (const [pid, cnt] of counts) {
        if (cnt > 1) conflictPlayers.add(pid);
      }
      if (!conflictPlayers.size) continue;
      for (const e of entries) {
        if (e.playerIds.some(pid => conflictPlayers.has(pid))) {
          conflictIds.add(e.slotId);
        }
      }
    }

    if (tournamentSystem === 'knockout') {
      const matchByIdLocal = matchById;

      const getBracketId = (m: any): string => {
        const b = m?.bracket;
        if (b == null) return '';
        if (typeof b === 'number' || typeof b === 'string') return String(b);
        const bid = (b as any)?.id;
        return bid != null ? String(bid) : '';
      };

      const getPrereqKeys = (m: any): string[] => {
        const bracketId = getBracketId(m);
        const r = Number(m?.round_index ?? NaN);
        const o = Number(m?.order_in_round ?? NaN);
        if (!bracketId || !Number.isFinite(r) || !Number.isFinite(o)) return [];
        if (m?.is_third_place) {
          const pr = r - 2;
          if (pr < 0) return [];
          return [`${bracketId}:${pr}:1`, `${bracketId}:${pr}:2`];
        }
        if (r <= 0) return [];
        return [`${bracketId}:${r - 1}:${2 * o - 1}`, `${bracketId}:${r - 1}:${2 * o}`];
      };

      for (const [, entries] of slotsByRun) {
        const byKey = new Map<string, { slotId: number; matchId: number }>();
        for (const e of entries) {
          const m = matchByIdLocal.get(Number(e.matchId));
          const bracketId = getBracketId(m);
          const r = Number(m?.round_index ?? NaN);
          const o = Number(m?.order_in_round ?? NaN);
          if (!bracketId || !Number.isFinite(r) || !Number.isFinite(o)) continue;
          byKey.set(`${bracketId}:${r}:${o}`, { slotId: e.slotId, matchId: e.matchId });
        }

        for (const e of entries) {
          const m = matchByIdLocal.get(Number(e.matchId));
          if (!m) continue;
          const prereqKeys = getPrereqKeys(m);
          for (const k of prereqKeys) {
            const src = byKey.get(k);
            if (src) {
              conflictIds.add(e.slotId);
              conflictIds.add(src.slotId);
            }
          }
        }
      }
    }

    setLocalConflictsSlotIds(conflictIds);
  }, [schedule, matchById, tournamentSystem]);

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

  const matchMetaLabel = (m: any): string => {
    if (!m) return '';
    const gi = m?.group_index;
    const group = gi !== null && gi !== undefined && gi !== '' ? `гр.${gi}` : '';

    if (tournamentSystem === 'round_robin') {
      const t1id = m?.team_1?.id;
      const t2id = m?.team_2?.id;
      const r1 = t1id ? rrTeamRowById.get(Number(t1id)) : undefined;
      const r2 = t2id ? rrTeamRowById.get(Number(t2id)) : undefined;
      const pair = r1 && r2 ? `${r1}-${r2}` : '';
      return [group, pair].filter(Boolean).join(' • ');
    }
    if (tournamentSystem === 'king') {
      const a = String(m?.team_1?.display_name || '').replace(/\s*\/\s*/g, '+');
      const b = String(m?.team_2?.display_name || '').replace(/\s*\/\s*/g, '+');
      const vs = a && b ? `${a} vs ${b}` : '';
      return [group, vs].filter(Boolean).join(' • ');
    }
    if (tournamentSystem === 'knockout') {
      return String(m?.round_name || '').trim() || `Раунд ${m?.round_index ?? ''}`.trim();
    }
    return group;
  };

  const renderMatchTiny = (m: any) => {
    const s1 = teamSurnames(m?.team_1);
    const s2 = teamSurnames(m?.team_2);
    const a = s1.length ? s1.join(' / ') : 'TBD';
    const b = s2.length ? s2.join(' / ') : 'TBD';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.05 }}>
        <div style={{ fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a}</div>
        <div style={{ fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b}</div>
      </div>
    );
  };

  const matchScoreLabel = (m: any): string => {
    const sets = Array.isArray(m?.sets) ? m.sets : null;
    if (!sets || !sets.length) {
      const score = String(m?.score || '').trim();
      if (score) return score;
      return '';
    }

    const parts: string[] = [];
    for (const s of sets) {
      if (!s) continue;
      const g1 = s.games_1;
      const g2 = s.games_2;
      if (g1 == null || g2 == null) continue;

      let setLabel = `${g1}:${g2}`;

      const loserTb = (() => {
        if (s.tb_loser_points != null) return Number(s.tb_loser_points);
        const tb1 = s.tb_1;
        const tb2 = s.tb_2;
        if (tb1 == null || tb2 == null) return null;
        return g1 > g2 ? Number(tb2) : Number(tb1);
      })();

      if (loserTb != null && !Number.isNaN(loserTb)) {
        setLabel = `${setLabel}(${loserTb})`;
      }

      parts.push(setLabel);
    }

    return parts.join(' ');
  };

  const handleClearSchedule = async () => {
    if (!schedule || !canManage) return;
    if (!window.confirm('Очистить расписание? Все назначенные матчи будут сняты.')) return;
    setSaving(true);
    try {
      const cleared: ScheduleDTO = {
        ...schedule,
        slots: (schedule.slots || []).map(s => ({ ...s, match: null, slot_type: 'match' })),
      };
      const payload: any = buildSavePayloadFromSchedule(cleared);
      const res = await scheduleApi.save(schedule.id, payload);
      setSchedule(res.schedule);
      setLastSavedSchedule(res.schedule);
      setIsDirty(false);
      await refreshSideData(res.schedule.id);
      setSelectedMatchId(null);
      clearDrag();
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось очистить расписание');
    } finally {
      setSaving(false);
    }
  };

  const handleAddRun = async () => {
    if (!schedule || !canManage) return;
    setSaving(true);
    try {
      const res = await scheduleApi.addRun(schedule.id);
      if (!(res as any)?.ok) {
        alert((res as any)?.detail || (res as any)?.error || 'Не удалось добавить запуск');
        return;
      }
      setSchedule(res.schedule);
      setLastSavedSchedule(res.schedule);
      setIsDirty(false);
      await refreshSideData(res.schedule.id);
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось добавить запуск');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRun = async (runId: number) => {
    if (!schedule || !canManage) return;
    if (!window.confirm('Удалить пустой запуск?')) return;
    setSaving(true);
    try {
      const res = await scheduleApi.deleteRun(schedule.id, runId);
      if (!(res as any)?.ok) {
        alert((res as any)?.detail || (res as any)?.error || 'Не удалось удалить запуск');
        return;
      }
      setSchedule(res.schedule);
      setLastSavedSchedule(res.schedule);
      setIsDirty(false);
      await refreshSideData(res.schedule.id);
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось удалить запуск');
    } finally {
      setSaving(false);
    }
  };

  const assignMany = (changes: Array<{ runIndex: number; courtIndex: number; matchId: number | null }>) => {
    if (!schedule) return;

    const getPrevMatchId = (runIndex: number, courtIndex: number): number | null => {
      const slot = slotsByRunCourt.get(`${runIndex}:${courtIndex}`);
      return slot?.match ? Number(slot.match) : null;
    };

    const prevMap = new Map<string, number | null>();
    for (const ch of changes) {
      prevMap.set(`${ch.runIndex}:${ch.courtIndex}`, getPrevMatchId(ch.runIndex, ch.courtIndex));
    }

    setSchedule(prev => {
      if (!prev) return prev;

      // dedupe by (run,court) to prevent "ghost" matches when duplicates exist
      const slotByKey = new Map<string, any>();
      for (const s of prev.slots || []) {
        slotByKey.set(`${s.run}:${s.court}`, s);
      }

      for (const ch of changes) {
        const run = prev.runs.find(r => r.index === ch.runIndex);
        const court = prev.courts.find(c => c.index === ch.courtIndex);
        if (!run || !court) continue;
        const key = `${run.id}:${court.id}`;
        const existing = slotByKey.get(key);
        if (existing) {
          slotByKey.set(key, { ...existing, slot_type: 'match', match: ch.matchId });
        } else {
          slotByKey.set(key, {
            id: -Date.now() + Math.floor(Math.random() * 1000),
            run: run.id,
            court: court.id,
            slot_type: 'match',
            match: ch.matchId,
            text_title: null,
            text_subtitle: null,
            override_title: null,
            override_subtitle: null,
          });
        }
      }

      return { ...prev, slots: Array.from(slotByKey.values()) };
    });

    setIsDirty(true);

    setPool(prev => {
      const makeAssigned = new Set<number>();
      const makeUnassigned = new Set<number>();

      for (const ch of changes) {
        const prevMatch = prevMap.get(`${ch.runIndex}:${ch.courtIndex}`);
        if (prevMatch) makeUnassigned.add(Number(prevMatch));
        if (ch.matchId) makeAssigned.add(Number(ch.matchId));
      }

      for (const id of makeAssigned) {
        if (makeUnassigned.has(id)) makeUnassigned.delete(id);
      }

      return prev.map(m => {
        if (!m?.id) return m;
        const mid = Number(m.id);
        if (makeAssigned.has(mid)) return { ...m, is_assigned: true };
        if (makeUnassigned.has(mid)) return { ...m, is_assigned: false };
        return m;
      });
    });
  };

  const clearDrag = () => {
    setDragMatchId(null);
    setDragSource(null);
    setDragOverCell(null);
    setDragOverUnassigned(false);
  };

  const startDragFromPool = (matchId: number) => {
    setDragMatchId(matchId);
    setDragSource(null);
  };

  const startDragFromCell = (runIndex: number, courtIndex: number, matchId: number) => {
    setDragMatchId(matchId);
    setDragSource({ runIndex, courtIndex });
  };

  const dropOnCell = (runIndex: number, courtIndex: number) => {
    if (!canManage) return;
    if (!dragMatchId) return;

    const targetSlot = slotsByRunCourt.get(`${runIndex}:${courtIndex}`);
    const targetMatchId: number | null = targetSlot?.match ? Number(targetSlot.match) : null;

    // если перетаскиваем из ячейки в саму себя
    if (dragSource && dragSource.runIndex === runIndex && dragSource.courtIndex === courtIndex) {
      clearDrag();
      return;
    }

    if (dragSource) {
      // move/swap
      const changes: Array<{ runIndex: number; courtIndex: number; matchId: number | null }> = [
        { runIndex, courtIndex, matchId: dragMatchId },
        { runIndex: dragSource.runIndex, courtIndex: dragSource.courtIndex, matchId: targetMatchId },
      ];
      assignMany(changes);
      clearDrag();
      return;
    }

    // from pool -> replace target (displaced becomes unassigned)
    assignMany([{ runIndex, courtIndex, matchId: dragMatchId }]);
    clearDrag();
  };

  const dropToUnassigned = () => {
    if (!canManage) return;
    if (!dragMatchId) return;

    if (dragSource) {
      assignMany([{ runIndex: dragSource.runIndex, courtIndex: dragSource.courtIndex, matchId: null }]);
    }
    clearDrag();
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

  useEffect(() => {
    if (!schedule?.id) {
      setLiveState(new Map());
      return;
    }
    if (viewMode !== 'timeline') return;

    let stopped = false;
    let timer: any = null;

    const tick = async () => {
      if (stopped) return;
      try {
        const data = await scheduleApi.liveState(schedule.id);
        if (stopped) return;
        const map = new Map<number, any>();
        for (const m of data?.matches || []) {
          if (!m?.id) continue;
          map.set(Number(m.id), {
            status: String(m.status || ''),
            started_at: m.started_at ?? null,
            finished_at: m.finished_at ?? null,
          });
        }
        setLiveState(map);
      } catch {
        // noop
      } finally {
        if (!stopped) timer = setTimeout(tick, 12000);
      }
    };

    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [schedule?.id, viewMode]);

  const parseHmToDate = (dateStr: string, hm: string): Date | null => {
    if (!dateStr || !hm) return null;
    const t = hm.length >= 5 ? hm.slice(0, 5) : hm;
    const iso = `${dateStr}T${t}:00`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const timelineData = useMemo(() => {
    if (!schedule) return null;
    const slotMs = 15 * 60 * 1000;
    const ceilToSlot = (ms: number) => Math.ceil(ms / slotMs) * slotMs;
    const plannedByRun = new Map<number, string>();
    for (const r of planned?.runs || []) {
      if (!r?.index) continue;
      if (r.planned_start_time) plannedByRun.set(Number(r.index), String(r.planned_start_time));
    }

    const courts = (schedule.courts || []).slice().sort((a, b) => a.index - b.index);
    const runs = (schedule.runs || []).slice().sort((a, b) => a.index - b.index);
    const slots = schedule.slots || [];

    const runIndexById = new Map<number, number>();
    runs.forEach(r => runIndexById.set(r.id, r.index));
    const courtIndexById = new Map<number, number>();
    courts.forEach(c => courtIndexById.set(c.id, c.index));

    const slotsByCourtIndex = new Map<number, Array<{ runIndex: number; matchId: number }>>();
    for (const s of slots) {
      if (!s?.match || s?.slot_type !== 'match') continue;
      const ri = runIndexById.get(s.run);
      const ci = courtIndexById.get(s.court);
      if (!ri || !ci) continue;
      const arr = slotsByCourtIndex.get(ci) || [];
      arr.push({ runIndex: ri, matchId: Number(s.match) });
      slotsByCourtIndex.set(ci, arr);
    }

    for (const [ci, arr] of slotsByCourtIndex) {
      arr.sort((a, b) => a.runIndex - b.runIndex);
      slotsByCourtIndex.set(ci, arr);
    }

    const durationMin = matchDuration || schedule.match_duration_minutes || 40;
    const durationMs = durationMin * 60 * 1000;
    const durationSlotsMs = Math.ceil(durationMs / slotMs) * slotMs;

    const perCourt: Array<{
      courtIndex: number;
      courtName: string;
      items: Array<{
        matchId: number;
        planStart: Date;
        renderStart: Date;
        renderEnd: Date;
        status?: string;
        started_at?: string | null;
      }>;
    }> = [];

    let globalMin: number | null = null;
    let globalMax: number | null = null;

    for (const c of courts) {
      const ci = c.index;
      const entries = slotsByCourtIndex.get(ci) || [];
      let prevEndMs: number | null = null;
      const items: any[] = [];

      for (const e of entries) {
        const hm = plannedByRun.get(e.runIndex);
        const plan = hm ? parseHmToDate(schedule.date, hm) : null;
        if (!plan) continue;

        const live = liveState.get(Number(e.matchId));
        const actual = showFact && live?.started_at ? new Date(String(live.started_at)) : null;
        const actualMs = actual && !Number.isNaN(actual.getTime()) ? actual.getTime() : null;

        const planMs = plan.getTime();
        const baseMs = actualMs != null ? Math.max(planMs, actualMs) : planMs;
        const rawStartMs: number = prevEndMs != null ? Math.max(baseMs, prevEndMs) : baseMs;
        const renderStartMs: number = showFact ? ceilToSlot(rawStartMs) : rawStartMs;
        const renderEndMs: number = showFact ? (renderStartMs + durationSlotsMs) : (renderStartMs + durationMs);
        prevEndMs = renderEndMs;

        if (globalMin == null || renderStartMs < globalMin) globalMin = renderStartMs;
        if (globalMax == null || renderEndMs > globalMax) globalMax = renderEndMs;

        items.push({
          matchId: Number(e.matchId),
          planStart: new Date(planMs),
          renderStart: new Date(renderStartMs),
          renderEnd: new Date(renderEndMs),
          status: live?.status,
          started_at: live?.started_at ?? null,
        });
      }

      perCourt.push({ courtIndex: ci, courtName: c.name, items });
    }

    if (globalMin == null || globalMax == null) {
      const fallbackHm = plannedByRun.get(1) || startTime;
      const d0 = parseHmToDate(schedule.date, fallbackHm || '10:00');
      if (d0) {
        globalMin = d0.getTime();
        globalMax = d0.getTime() + 6 * 60 * 60 * 1000;
      } else {
        globalMin = Date.now();
        globalMax = globalMin + 6 * 60 * 60 * 1000;
      }
    }

    const roundTo15 = (ms: number) => Math.floor(ms / (15 * 60 * 1000)) * (15 * 60 * 1000);
    const scheduleStartHm = plannedByRun.get(1) || startTime;
    const scheduleStartDate = parseHmToDate(schedule.date, scheduleStartHm || '10:00');
    const startMs = roundTo15((scheduleStartDate ? scheduleStartDate.getTime() : globalMin) as number);
    const endMs = roundTo15(globalMax + 14 * 60 * 1000);

    return {
      startMs,
      endMs,
      courts,
      perCourt,
      durationMin,
    };
  }, [schedule, planned, liveState, showFact, matchDuration, startTime]);

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

  const formatHm = (v: string | null | undefined) => {
    if (!v) return '';
    const s = String(v);
    return s.length >= 5 ? s.slice(0, 5) : s;
  };

  const runStartLabel = (runIndex: number) => {
    if (!schedule) return '';
    const r = schedule.runs.find(x => x.index === runIndex);
    if (!r) return '';
    const plannedTime = planned?.runs?.find(x => x.index === runIndex)?.planned_start_time;

    if (r.start_mode === 'fixed') {
      const t = formatHm(r.start_time) || formatHm(plannedTime);
      return t ? t : 'Начало';
    }
    if (r.start_mode === 'not_earlier') {
      const t = formatHm(r.not_earlier_time) || formatHm(plannedTime);
      return t ? `Не ранее ${t}` : 'Не ранее';
    }
    return 'Затем';
  };

  const teamSurnames = (team: any): string[] => {
    if (!team) return ['TBD'];
    const raw = String(team.full_name || team.display_name || team.name || '').trim();
    if (!raw) return ['TBD'];

    // pairs often come like: "Surname1 Name1 / Surname2 Name2" or similar
    const parts = raw
      .split('/')
      .map(x => x.trim())
      .filter(Boolean);

    const surnames = parts
      .map(p => {
        const first = p.split(' ').map(x => x.trim()).filter(Boolean)[0];
        return first || 'TBD';
      })
      .filter(Boolean);

    return surnames.length ? surnames.slice(0, 2) : ['TBD'];
  };

  const renderMatchCompact = (m: any, variant: 'backlog' | 'schedule') => {
    const s1 = teamSurnames(m?.team_1);
    const s2 = teamSurnames(m?.team_2);
    const isDoubles = s1.length > 1 || s2.length > 1;

    const surnameStyle: React.CSSProperties = {
      fontSize: 16,
      fontWeight: 400,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      textAlign: 'center',
      width: '100%',
    };

    if (variant === 'backlog') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.15, width: '100%' }}>
          <div style={{ ...surnameStyle, textAlign: 'left' }}>{s1.join(' / ')}</div>
          <div style={{ ...surnameStyle, textAlign: 'left' }}>{s2.join(' / ')}</div>
        </div>
      );
    }

    const scheduleMeta = matchMetaLabel(m);

    // schedule
    if (!isDoubles) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.15, width: '100%', alignItems: 'center' }}>
          {scheduleMeta ? (
            <div style={{ fontSize: 11, opacity: 0.75, textAlign: 'right', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {scheduleMeta}
            </div>
          ) : null}
          <div style={surnameStyle}>{s1[0]}</div>
          <div style={{ fontSize: 12, fontWeight: 800, textAlign: 'center' }}>против</div>
          <div style={surnameStyle}>{s2[0]}</div>
        </div>
      );
    }

    const a1 = s1[0] || 'TBD';
    const a2 = s1[1] || 'TBD';
    const b1 = s2[0] || 'TBD';
    const b2 = s2[1] || 'TBD';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.15, width: '100%', alignItems: 'center' }}>
        {scheduleMeta ? (
          <div style={{ fontSize: 11, opacity: 0.75, textAlign: 'right', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {scheduleMeta}
          </div>
        ) : null}
        <div style={surnameStyle}>{a1}</div>
        <div style={surnameStyle}>{a2}</div>
        <div style={{ fontSize: 12, fontWeight: 800, textAlign: 'center' }}>против</div>
        <div style={surnameStyle}>{b1}</div>
        <div style={surnameStyle}>{b2}</div>
      </div>
    );
  };

  const autoAssignAndSave = async (sch: ScheduleDTO) => {
    const mp = await scheduleApi.matchesPool(sch.id);
    const matches = mp.matches || [];
    const sortedRuns = (sch.runs || []).slice().sort((a, b) => a.index - b.index);
    const sortedCourts = (sch.courts || []).slice().sort((a, b) => a.index - b.index);

    const matchByIdFromPool = new Map<number, any>();
    for (const m of matches) {
      if (m?.id) matchByIdFromPool.set(Number(m.id), m);
    }

    const matchQueue: Array<{ m: any; preferredCourt?: number | null }> = [];
    const already = new Set<number>();

    // 1) Сначала берем уже назначенные матчи в порядке (run -> court), чтобы "поздние" уезжали вниз.
    const runIndexById = new Map<number, number>();
    for (const r of sortedRuns) runIndexById.set(r.id, r.index);
    const courtIndexById = new Map<number, number>();
    for (const c of sortedCourts) courtIndexById.set(c.id, c.index);

    const scheduledSlots = (sch.slots || [])
      .filter(s => s?.slot_type === 'match' && s?.match)
      .map(s => ({
        runIndex: runIndexById.get(s.run) || 0,
        courtIndex: courtIndexById.get(s.court) || 0,
        matchId: Number(s.match),
      }))
      .filter(x => x.runIndex > 0 && x.courtIndex > 0 && Number.isFinite(x.matchId))
      .sort((a, b) => (a.runIndex - b.runIndex) || (a.courtIndex - b.courtIndex));

    for (const s of scheduledSlots) {
      if (already.has(s.matchId)) continue;
      const mm = matchByIdFromPool.get(s.matchId);
      if (!mm) continue;
      already.add(s.matchId);
      matchQueue.push({ m: mm, preferredCourt: s.courtIndex });
    }

    // 2) Затем добиваем остальными матчами (не назначенными или отсутствующими в слотах)
    for (const mm of matches) {
      const mid = Number(mm?.id);
      if (!mid || already.has(mid)) continue;
      already.add(mid);
      matchQueue.push({ m: mm, preferredCourt: null });
    }

    // Стартуем с "чистого" расписания: все ячейки пустые, а матчи раскладываем заново.
    const existing = new Map<string, number | null>();
    for (const r of sortedRuns) {
      for (const c of sortedCourts) {
        existing.set(`${r.index}:${c.index}`, null);
      }
    }

    const matchPlayerIds = (m: any): number[] => {
      const pids: number[] = [];
      const t1p1 = m?.team_1?.player_1?.id;
      const t1p2 = m?.team_1?.player_2?.id;
      const t2p1 = m?.team_2?.player_1?.id;
      const t2p2 = m?.team_2?.player_2?.id;
      if (t1p1) pids.push(Number(t1p1));
      if (t1p2) pids.push(Number(t1p2));
      if (t2p1) pids.push(Number(t2p1));
      if (t2p2) pids.push(Number(t2p2));
      return pids;
    };

    const getBracketId = (m: any): string => {
      const b = m?.bracket;
      if (b == null) return '';
      if (typeof b === 'number' || typeof b === 'string') return String(b);
      const bid = (b as any)?.id;
      return bid != null ? String(bid) : '';
    };

    const koMatchKey = (m: any): string => {
      const b = getBracketId(m);
      const r = m?.round_index;
      const o = m?.order_in_round;
      if (!b || r == null || o == null) return '';
      return `${b}:${Number(r)}:${Number(o)}`;
    };

    const koPrereqKeys = (m: any): string[] => {
      const b = getBracketId(m);
      const r = Number(m?.round_index ?? NaN);
      const o = Number(m?.order_in_round ?? NaN);
      if (!b || !Number.isFinite(r) || !Number.isFinite(o)) return [];
      if (m?.is_third_place) {
        const pr = r - 2;
        if (pr < 0) return [];
        return [`${b}:${pr}:1`, `${b}:${pr}:2`];
      }
      if (r <= 0) return [];
      return [`${b}:${r - 1}:${2 * o - 1}`, `${b}:${r - 1}:${2 * o}`];
    };

    const runStateByIndex = new Map<number, { players: Set<number>; koKeys: Set<string> }>();
    for (const r of sortedRuns) {
      runStateByIndex.set(r.index, { players: new Set<number>(), koKeys: new Set<string>() });
    }

    const ensureRun = (runIndex: number) => {
      if (runStateByIndex.has(runIndex)) return;
      runStateByIndex.set(runIndex, { players: new Set<number>(), koKeys: new Set<string>() });
      if (!sortedRuns.find(r => r.index === runIndex)) {
        sortedRuns.push({
          id: -Date.now() + Math.floor(Math.random() * 1000),
          index: runIndex,
          start_mode: 'then',
          start_time: null,
          not_earlier_time: null,
        } as any);
        sortedRuns.sort((a, b) => a.index - b.index);
      }
      for (const c of sortedCourts) {
        if (!existing.has(`${runIndex}:${c.index}`)) existing.set(`${runIndex}:${c.index}`, null);
      }
    };

    const canPlaceInRun = (m: any, runIndex: number) => {
      const st = runStateByIndex.get(runIndex) || { players: new Set<number>(), koKeys: new Set<string>() };
      const pids = matchPlayerIds(m);
      if (pids.some(pid => st.players.has(pid))) return false;

      if (tournamentSystem === 'knockout') {
        const key = koMatchKey(m);
        const prereqs = koPrereqKeys(m);
        if (key && st.koKeys.has(key)) return false;
        for (const pk of prereqs) {
          if (st.koKeys.has(pk)) return false;
        }
        for (const placedKey of st.koKeys) {
          const parts = placedKey.split(':');
          if (parts.length !== 3) continue;
          const placed = matches.find((x: any) => koMatchKey(x) === placedKey);
          if (!placed) continue;
          const placedPrereqs = koPrereqKeys(placed);
          if (key && placedPrereqs.includes(key)) return false;
        }
      }

      return true;
    };

    const placeInto = (m: any, runIndex: number, courtIndex: number) => {
      ensureRun(runIndex);
      const key = `${runIndex}:${courtIndex}`;
      existing.set(key, Number(m.id));
      const st = runStateByIndex.get(runIndex);
      if (st) {
        for (const pid of matchPlayerIds(m)) st.players.add(pid);
        if (tournamentSystem === 'knockout') {
          const k = koMatchKey(m);
          if (k) st.koKeys.add(k);
        }
      }
    };

    let cursorRun = sortedRuns[0]?.index || 1;
    let cursorCourtPos = 0;

    const nextCell = () => {
      cursorCourtPos += 1;
      if (cursorCourtPos >= sortedCourts.length) {
        cursorCourtPos = 0;
        cursorRun += 1;
      }
    };

    for (const item of matchQueue) {
      const m = item.m;
      const preferredCourt = Number(item.preferredCourt) || sortedCourts[cursorCourtPos]?.index || 1;
      const currentRun = cursorRun;
      const currentKey = `${currentRun}:${preferredCourt}`;

      if (!existing.has(currentKey)) ensureRun(currentRun);
      const occupied = existing.get(currentKey);

      const tryRun = (runIndex: number): boolean => {
        ensureRun(runIndex);
        const startIdx = sortedCourts.findIndex(c => c.index === preferredCourt);
        const order = startIdx >= 0 ? [...sortedCourts.slice(startIdx), ...sortedCourts.slice(0, startIdx)] : sortedCourts;
        for (const c of order) {
          const k = `${runIndex}:${c.index}`;
          if (existing.get(k)) continue;
          if (!canPlaceInRun(m, runIndex)) continue;
          placeInto(m, runIndex, c.index);
          return true;
        }
        return false;
      };

      if (!occupied && canPlaceInRun(m, currentRun)) {
        placeInto(m, currentRun, preferredCourt);
        nextCell();
        continue;
      }

      let placed = false;
      for (let ri = currentRun + 1; ri <= currentRun + 200; ri++) {
        if (tryRun(ri)) {
          placed = true;
          break;
        }
      }

      nextCell();
      if (!placed) {
        continue;
      }
    }

    // Уплотняем влево внутри каждого запуска: если в запуске есть матчи на правых кортах,
    // то заполняем сначала левые (без изменения набора матчей в запуске).
    const allRunIndices = Array.from(new Set(Array.from(existing.keys()).map(k => Number(k.split(':')[0])).filter(n => Number.isFinite(n) && n > 0)));
    const maxRunIndexObserved = allRunIndices.length ? Math.max(...allRunIndices) : 1;
    for (let ri = 1; ri <= maxRunIndexObserved; ri++) {
      const mids: number[] = [];
      for (const c of sortedCourts) {
        const mid = existing.get(`${ri}:${c.index}`);
        if (mid) mids.push(Number(mid));
      }
      for (let i = 0; i < sortedCourts.length; i++) {
        const c = sortedCourts[i];
        existing.set(`${ri}:${c.index}`, i < mids.length ? mids[i] : null);
      }
    }

    const payload: any = {
      ...buildSavePayloadFromSchedule({ ...sch, runs: sortedRuns } as any),
    };

    const slotByKey = new Map<string, any>();
    for (const s of payload.slots || []) {
      slotByKey.set(`${s.run_index}:${s.court_index}`, s);
    }

    const maxRunIndex = Math.max(...Array.from(existing.keys()).map(k => Number(k.split(':')[0])).filter(n => Number.isFinite(n)), 1);
    const finalRuns = sortedRuns
      .slice()
      .sort((a, b) => a.index - b.index)
      .filter(r => r.index <= maxRunIndex);
    payload.runs = finalRuns.map((r: any) => ({
      index: r.index,
      start_mode: r.start_mode,
      start_time: r.start_time,
      not_earlier_time: r.not_earlier_time,
    }));

    for (let ri = 1; ri <= maxRunIndex; ri++) {
      for (const c of sortedCourts) {
        const mid = existing.get(`${ri}:${c.index}`);
        const k = `${ri}:${c.index}`;
        if (mid) {
          slotByKey.set(k, { run_index: ri, court_index: c.index, slot_type: 'match', match_id: mid });
        }
      }
    }

    payload.slots = Array.from(slotByKey.values());

    const res = await scheduleApi.save(sch.id, payload);
    setSchedule(res.schedule);
    setLastSavedSchedule(res.schedule);
    setIsDirty(false);
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
      if (t?.system) setTournamentSystem(String(t.system));

      // For RR label like "1-2" we need row_index of teams (same logic as in TournamentDetailPage)
      const nextMap = new Map<number, number>();
      const parts: any[] = (t as any)?.participants || [];
      for (const p of parts) {
        const teamId = p?.team?.id;
        const rowIndex = p?.row_index;
        if (teamId && rowIndex) {
          nextMap.set(Number(teamId), Number(rowIndex));
        }
      }
      setRrTeamRowById(nextMap);

      if (t?.start_time) setStartTime(t.start_time as any);
      if (t?.date && typeof t.date === 'string') {
        // date stays server side, we only use start_time in generation
      }

      const res = await tournamentApi.getSchedule(tournamentId);
      const sch = res?.schedule || null;
      setSchedule(sch);
      setLastSavedSchedule(sch);
      setIsDirty(false);
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
      setLastSavedSchedule(res.schedule);
      setIsDirty(false);
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

    setIsDirty(true);

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
      setLastSavedSchedule(res.schedule);
      setIsDirty(false);
      await refreshSideData(res.schedule.id);
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardChanges = async () => {
    if (!schedule) return;
    if (!lastSavedSchedule) return;
    setSaving(true);
    try {
      const restored = JSON.parse(JSON.stringify(lastSavedSchedule)) as ScheduleDTO;
      setSchedule(restored);
      setIsDirty(false);
      await refreshSideData(restored.id);
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
        {schedule && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              className="btn"
              onClick={() => setViewMode('grid')}
              disabled={viewMode === 'grid'}
            >
              Сетка
            </button>
            <button
              className="btn"
              onClick={() => setViewMode('timeline')}
              disabled={viewMode === 'timeline'}
            >
              Таймлайн
            </button>
            {viewMode === 'timeline' && (
              <button className="btn" onClick={() => setShowFact(v => !v)}>
                {showFact ? 'Факт: вкл' : 'Факт: выкл'}
              </button>
            )}
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {schedule && viewMode === 'grid' && (
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

      {schedule && viewMode === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12, alignItems: 'start' }}>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Матчи для назначения</div>
            <div className="text-sm" style={{ marginBottom: 10, opacity: 0.8 }}>
              Можно перетаскивать мышью в ячейки расписания или назначать кликом.
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => setSelectedMatchId(null)}>
                Снять выбор
              </button>
              <button className="btn" onClick={handleAutoFill} disabled={!canManage || saving}>
                Авто
              </button>
              <button className="btn" onClick={handleClearSchedule} disabled={!canManage || saving}>
                Очистить
              </button>
              <div className="text-sm" style={{ alignSelf: 'center', opacity: 0.75 }}>
                Выбран: {selectedMatchId ? `#${selectedMatchId}` : '—'}
              </div>
            </div>

            <div style={{ maxHeight: 520, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  fontWeight: 600,
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1px dashed #d1d5db',
                  background: dragOverUnassigned ? '#f3f4f6' : undefined,
                }}
                onDragOver={e => {
                  if (!canManage) return;
                  e.preventDefault();
                  setDragOverUnassigned(true);
                }}
                onDragLeave={() => setDragOverUnassigned(false)}
                onDrop={e => {
                  if (!canManage) return;
                  e.preventDefault();
                  dropToUnassigned();
                }}
              >
                Не назначены ({poolUnassigned.length})
              </div>
              {poolUnassigned.slice(0, 200).map((m: any) => {
                const isSelected = selectedMatchId === m.id;
                const meta = matchMetaLabel(m) || `#${m.id}`;
                return (
                  <div
                    key={m.id}
                    className="btn"
                    draggable={canManage}
                    onDragStart={e => {
                      if (!canManage) return;
                      startDragFromPool(Number(m.id));
                    }}
                    onDragEnd={() => clearDrag()}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      textAlign: 'left',
                      cursor: canManage ? 'grab' : 'default',
                      padding: '6px 10px',
                      minHeight: 44,
                      background: isSelected ? '#111827' : undefined,
                      color: isSelected ? '#fff' : undefined,
                    }}
                    onClick={() => setSelectedMatchId(m.id)}
                  >
                    <span style={{ display: 'inline-block', width: 18 }}>
                      <span style={{ color: '#dc3545', fontWeight: 700 }}>●</span>
                    </span>
                    <span
                      style={{
                        width: 160,
                        fontSize: 11,
                        opacity: 0.8,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        lineHeight: 1.15,
                        display: '-webkit-box',
                        WebkitLineClamp: 2 as any,
                        WebkitBoxOrient: 'vertical' as any,
                      }}
                    >
                      {meta}
                    </span>
                    {renderMatchCompact(m, 'backlog')}
                  </div>
                );
              })}

              <div style={{ fontWeight: 600, marginTop: 10 }}>Назначены ({poolAssigned.length})</div>
              {poolAssigned.slice(0, 50).map((m: any) => (
                <div key={m.id} className="text-sm" style={{ opacity: 0.8 }}>
                  <span style={{ display: 'inline-block', width: 18 }}>
                    <span style={{ color: '#28a745', fontWeight: 700 }}>●</span>
                  </span>
                  <span
                    style={{
                      width: 160,
                      fontSize: 11,
                      opacity: 0.8,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      lineHeight: 1.15,
                      display: '-webkit-box',
                      WebkitLineClamp: 2 as any,
                      WebkitBoxOrient: 'vertical' as any,
                    }}
                  >
                    {matchMetaLabel(m) || `#${m.id}`}
                  </span>
                  {m?.team_1?.full_name || m?.team_1?.display_name || 'TBD'} / {m?.team_2?.full_name || m?.team_2?.display_name || 'TBD'}
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
              <button className="btn" onClick={handleAddRun} disabled={!canManage || saving || !schedule}>
                Добавить запуск
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
                  <th key={c.id} style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #f2f2f2', borderLeft: '1px solid #e5e7eb' }}>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    {c.first_start_time && (
                      <div className="text-sm" style={{ opacity: 0.75 }}>Начало {formatHm(c.first_start_time)}</div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedule.runs.sort((a,b)=>a.index-b.index).map(r => {
                const plannedTime = planned?.runs?.find(x => x.index === r.index)?.planned_start_time;
                const slotsForRun = (schedule.slots || []).filter(s => s.run === r.id);
                const isEmptyRun = slotsForRun.every(s => {
                  const hasMatch = !!s?.match;
                  const hasText = !!(s?.text_title || s?.text_subtitle || s?.override_title || s?.override_subtitle);
                  return !hasMatch && !hasText;
                });
                const maxRunIndex = Math.max(...(schedule.runs || []).map(x => x.index), 1);
                const canDeleteThisRun = canManage && isEmptyRun && r.index === maxRunIndex;
                return (
                  <tr key={r.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid #f2f2f2', verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontWeight: 600 }}>Запуск {r.index}</div>
                        {canDeleteThisRun && (
                          <button className="btn" onClick={() => handleDeleteRun(r.id)} disabled={saving}>
                            Удалить
                          </button>
                        )}
                      </div>
                      <div className="text-sm" style={{ opacity: 0.8 }}>План: {plannedTime || '—'}</div>
                    </td>
                    {schedule.courts.sort((a,b)=>a.index-b.index).map(c => {
                      const slot = slotsByRunCourt.get(`${r.index}:${c.index}`);
                      const conflictSet = localConflictsSlotIds || conflictsSlotIds;
                      const isConflict = slot?.id ? conflictSet.has(slot.id) : false;
                      const hasMatch = !!slot?.match;
                      const cellMatchId: number | null = slot?.match ? Number(slot.match) : null;
                      const isDragOver = dragOverCell?.runIndex === r.index && dragOverCell?.courtIndex === c.index;
                      return (
                        <td
                          key={c.id}
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #f2f2f2',
                            borderLeft: '1px solid #e5e7eb',
                            background: isConflict ? '#FEE2E2' : isDragOver ? '#eef2ff' : undefined,
                            verticalAlign: 'middle',
                            textAlign: 'center',
                          }}
                          onDragOver={e => {
                            if (!canManage) return;
                            e.preventDefault();
                            setDragOverCell({ runIndex: r.index, courtIndex: c.index });
                            setDragOverUnassigned(false);
                          }}
                          onDragLeave={() => {
                            setDragOverCell(prev => {
                              if (prev?.runIndex === r.index && prev?.courtIndex === c.index) return null;
                              return prev;
                            });
                          }}
                          onDrop={e => {
                            if (!canManage) return;
                            e.preventDefault();
                            dropOnCell(r.index, c.index);
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
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <div className="text-sm" style={{ opacity: 0.75 }}>
                              {runStartLabel(r.index)}
                            </div>
                            <div
                            draggable={canManage && !!cellMatchId}
                            onDragStart={e => {
                              if (!canManage) return;
                              if (!cellMatchId) return;
                              startDragFromCell(r.index, c.index, cellMatchId);
                              try {
                                e.dataTransfer.setData('text/plain', String(cellMatchId));
                                e.dataTransfer.effectAllowed = 'move';
                              } catch {
                                // noop
                              }
                            }}
                            onDragEnd={() => clearDrag()}
                            style={{
                              cursor: canManage && !!cellMatchId ? 'grab' : 'default',
                              fontWeight: 600,
                              width: '100%',
                              display: 'flex',
                              justifyContent: 'center',
                            }}
                          >
                            {slot?.override_title
                              ? slot.override_title
                              : slot?.slot_type === 'text'
                                ? slot?.text_title || ''
                                : slot?.match
                                  ? renderMatchCompact(matchById.get(Number(slot.match)) || matchById.get(Number(cellMatchId)), 'schedule')
                                  : ''}
                          </div>
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

      {schedule && viewMode === 'timeline' && timelineData && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ minWidth: 90 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Время</div>
              <div
                style={{
                  position: 'relative',
                  height: Math.max(300, (timelineData.endMs - timelineData.startMs) / (15 * 60 * 1000) * 28),
                }}
              >
                {Array.from(
                  { length: Math.max(1, Math.ceil((timelineData.endMs - timelineData.startMs) / (15 * 60 * 1000))) },
                  (_, i) => {
                    const t = new Date(timelineData.startMs + i * 15 * 60 * 1000);
                    const hh = String(t.getHours()).padStart(2, '0');
                    const mm = String(t.getMinutes()).padStart(2, '0');
                    const top = i * 28;
                    return (
                      <div
                        key={i}
                        style={{
                          position: 'absolute',
                          top,
                          left: 0,
                          right: 0,
                          height: 28,
                          borderTop: '1px solid #f3f4f6',
                          fontSize: 11,
                          opacity: 0.8,
                        }}
                      >
                        {mm === '00' ? `${hh}:${mm}` : ''}
                      </div>
                    );
                  }
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${timelineData.courts.length}, 220px)`, gap: 10 }}>
              {timelineData.perCourt.map(col => {
                const height = Math.max(300, (timelineData.endMs - timelineData.startMs) / (15 * 60 * 1000) * 28);
                return (
                  <div key={col.courtIndex}>
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>{col.courtName}</div>
                    <div
                      style={{
                        position: 'relative',
                        height,
                        borderLeft: '1px solid #e5e7eb',
                        borderRight: '1px solid #e5e7eb',
                      }}
                    >
                      {Array.from(
                        { length: Math.max(1, Math.ceil((timelineData.endMs - timelineData.startMs) / (15 * 60 * 1000))) },
                        (_, i) => (
                          <div
                            key={i}
                            style={{
                              position: 'absolute',
                              top: i * 28,
                              left: 0,
                              right: 0,
                              height: 28,
                              borderTop: '1px solid #f3f4f6',
                            }}
                          />
                        )
                      )}

                      {col.items.map(it => {
                        const startMs = it.renderStart.getTime();
                        const endMs = it.renderEnd.getTime();
                        const slotMs = 15 * 60 * 1000;
                        const top = ((startMs - timelineData.startMs) / slotMs) * 28;
                        const h = Math.max(20, ((endMs - startMs) / (15 * 60 * 1000)) * 28);
                        const m = matchById.get(Number(it.matchId));
                        const planned = it.planStart;
                        const planHm = `${String(planned.getHours()).padStart(2, '0')}:${String(planned.getMinutes()).padStart(2, '0')}`;
                        const factHm = it.started_at
                          ? (() => {
                              const d = new Date(String(it.started_at));
                              if (Number.isNaN(d.getTime())) return '';
                              return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                            })()
                          : '';
                        const st = String(it.status || '').toLowerCase();
                        const bg = st === 'completed' ? '#d1fae5' : st === 'live' ? '#dbeafe' : '#fff';

                        const statusLine = (() => {
                          if (st === 'completed') {
                            const sc = matchScoreLabel(m);
                            return sc ? `завершен ${sc}` : 'завершен';
                          }
                          if (st === 'live') {
                            return `начат ${factHm || planHm}`;
                          }
                          return `план ${planHm}`;
                        })();

                        return (
                          <div
                            key={it.matchId}
                            style={{
                              position: 'absolute',
                              left: 6,
                              right: 6,
                              top,
                              height: h,
                              border: '1px solid #e5e7eb',
                              borderRadius: 8,
                              padding: 4,
                              background: bg,
                              overflow: 'hidden',
                            }}
                            title={getMatchTitle(it.matchId)}
                          >
                            <div style={{ fontSize: 10, opacity: 0.75, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {statusLine}
                            </div>
                            <div style={{ fontSize: 10, opacity: 0.75, marginBottom: 2, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {matchMetaLabel(m) || `#${it.matchId}`}
                            </div>
                            <div style={{ lineHeight: 1.05 }}>
                              {renderMatchTiny(m || { id: it.matchId })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {schedule && isDirty && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 50,
            background: '#fff3cd',
            borderTop: '1px solid #ffeeba',
            padding: '10px 16px',
          }}
          data-export-exclude="true"
        >
          <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700 }}>Есть несохранённые изменения</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn" onClick={handleSave} disabled={saving || !canManage}>
                Сохранить
              </button>
              <button className="btn" onClick={handleDiscardChanges} disabled={saving}>
                Отменить изменения
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
