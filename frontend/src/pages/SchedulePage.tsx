import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { scheduleApi, ScheduleConflictsResponse, ScheduleDTO, SchedulePlannedTimesResponse, tournamentApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

export const SchedulePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const tournamentId = id ? Number(id) : NaN;

  const role = user?.role;
  const canManage = role === 'ADMIN' || role === 'ORGANIZER';

  const isDraftMode = useMemo(() => {
    try {
      const sp = new URLSearchParams(location.search);
      return sp.get('draft') === '1';
    } catch {
      return false;
    }
  }, [location.search]);

  const isDraftPreviewMode = useMemo(() => {
    if (!isDraftMode) return false;
    try {
      const sp = new URLSearchParams(location.search);
      return sp.get('preview') === '1';
    } catch {
      return false;
    }
  }, [isDraftMode, location.search]);

  const canEdit = canManage;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleDTO | null>(null);

  const [showScopesModal, setShowScopesModal] = useState(false);
  const [scopeTournamentTitleById, setScopeTournamentTitleById] = useState<Map<number, string>>(new Map());
  const [tournamentScheduleNameById, setTournamentScheduleNameById] = useState<Map<number, string>>(new Map());
  const [availableTournamentQuery, setAvailableTournamentQuery] = useState<string>('');
  const [availableTournaments, setAvailableTournaments] = useState<
    Array<{ id: number; name: string; date: string | null; start_time: string | null; status: string; created_by: number | null }>
  >([]);
  const [availableTournamentsLoading, setAvailableTournamentsLoading] = useState<boolean>(false);
  const [selectedTournamentToAddId, setSelectedTournamentToAddId] = useState<number | null>(null);
  const [tournamentStartTimeById, setTournamentStartTimeById] = useState<Map<number, string | null>>(new Map());
  const [scopeStartTimeTextById, setScopeStartTimeTextById] = useState<Map<number, string>>(new Map());
  const [waveStartTimeTextById, setWaveStartTimeTextById] = useState<Map<number, string>>(new Map());
  const [waveEarliestTimeTextById, setWaveEarliestTimeTextById] = useState<Map<number, string>>(new Map());

  const [courtsCount, setCourtsCount] = useState<number>(6);
  const [matchDuration, setMatchDuration] = useState<number>(40);
  const [courtsCountText, setCourtsCountText] = useState<string>('6');
  const [matchDurationText, setMatchDurationText] = useState<string>('40');
  const [startTime, setStartTime] = useState<string>('10:00');
  const [tournamentSystem, setTournamentSystem] = useState<string | null>(null);
  const [tournamentName, setTournamentName] = useState<string>('');
  const [rrTeamRowById, setRrTeamRowById] = useState<Map<number, number>>(new Map());
  const [rrTeamByGroupRow, setRrTeamByGroupRow] = useState<Map<string, any>>(new Map());
  const [rrPairByMatchId, setRrPairByMatchId] = useState<Map<number, [number, number]>>(new Map());
  const [kingLetterByGroupPlayerId, setKingLetterByGroupPlayerId] = useState<Map<string, string>>(new Map());
  const [surnameCounts, setSurnameCounts] = useState<Map<string, number>>(new Map());

  const hhmm = (raw: string | null | undefined): string => {
    const s = String(raw || '').trim();
    if (!s) return '';
    const parts = s.split(':');
    if (parts.length >= 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    return s;
  };

  const formatIsoDateToRu = (iso: any): string => {
    const s = String(iso || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    return s;
  };

  const isProAmRoundRobin = useMemo(() => {
    if (tournamentSystem !== 'round_robin') return false;
    const name = (tournamentName || '').toLowerCase();
    return name.includes('proam') || name.includes('проам');
  }, [tournamentName, tournamentSystem]);

  const proAmGroupLetter = useMemo(() => {
    const letters = [
      'А',
      'Б',
      'В',
      'Г',
      'Д',
      'Е',
      'Ж',
      'З',
      'И',
      'Й',
      'К',
      'Л',
      'М',
      'Н',
      'О',
      'П',
      'Р',
      'С',
      'Т',
      'У',
      'Ф',
      'Х',
      'Ц',
      'Ч',
      'Ш',
      'Щ',
      'Э',
      'Ю',
      'Я',
    ];

    return (groupIndex: any): string => {
      const n = Number(groupIndex);
      if (!Number.isFinite(n) || n <= 0) return String(groupIndex ?? '');
      return n <= letters.length ? letters[n - 1] : String(groupIndex);
    };
  }, []);

  const [isBacklogCollapsed, setIsBacklogCollapsed] = useState<boolean>(false);

  const [planned, setPlanned] = useState<SchedulePlannedTimesResponse | null>(null);
  const [conflicts, setConflicts] = useState<ScheduleConflictsResponse | null>(null);
  const [pool, setPool] = useState<any[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [dragMatchId, setDragMatchId] = useState<number | null>(null);
  const [dragSource, setDragSource] = useState<{ runIndex: number; courtIndex: number } | null>(null);
  const [dragOverCell, setDragOverCell] = useState<{ runIndex: number; courtIndex: number } | null>(null);
  const [dragOverUnassigned, setDragOverUnassigned] = useState<boolean>(false);

  const [dragColumnIndex, setDragColumnIndex] = useState<number | null>(null);
  const [dragOverColumnIndex, setDragOverColumnIndex] = useState<number | null>(null);
  const [dragRowIndex, setDragRowIndex] = useState<number | null>(null);
  const [dragOverRowIndex, setDragOverRowIndex] = useState<number | null>(null);

  const [pickedFromCell, setPickedFromCell] = useState<{ runIndex: number; courtIndex: number; matchId: number } | null>(null);

  const [localConflictsSlotIds, setLocalConflictsSlotIds] = useState<Set<number> | null>(null);

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFormat, setExportFormat] = useState<'pdf' | 'docx' | 'xlsx' | 'numbers'>('pdf');

  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedSchedule, setLastSavedSchedule] = useState<ScheduleDTO | null>(null);

  const [editingCourtIndex, setEditingCourtIndex] = useState<number | null>(null);
  const [editingSlotStartLabel, setEditingSlotStartLabel] = useState<
    | null
    | {
        slotId: number;
        mode: 'then' | 'not_earlier';
        time: string;
      }
  >(null);

  const [viewMode, setViewMode] = useState<'grid' | 'timeline'>(() => {
    try {
      const sp = new URLSearchParams(location.search);
      const raw = (sp.get('view') || '').toLowerCase();
      return raw === 'timeline' ? 'timeline' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const [showFact, setShowFact] = useState<boolean>(() => {
    try {
      const sp = new URLSearchParams(location.search);
      const raw = (sp.get('fact') || '').toLowerCase();
      return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on' || raw === 'y';
    } catch {
      return true;
    }
  });
  const [liveState, setLiveState] = useState<
    Map<
      number,
      {
        status: string;
        started_at: string | null;
        finished_at: string | null;
        sets?: Array<{
          games_1: number | null;
          games_2: number | null;
          tb_1?: number | null;
          tb_2?: number | null;
          is_tiebreak_only?: boolean;
        }>;
      }
    >
  >(new Map());

  const sortedScopes = useMemo(() => {
    const scopes = (schedule?.scopes || []).slice();
    scopes.sort((a: any, b: any) => {
      const waves: any[] = Array.isArray((schedule as any)?.waves) ? ((schedule as any).waves as any[]) : [];
      const wOrder = (wid: any): number => {
        const id = wid == null ? null : Number(wid);
        if (!id) return 1;
        const w = waves.find(x => Number((x as any)?.id) === id);
        const o = Number((w as any)?.order ?? 0);
        return Number.isFinite(o) && o > 0 ? o : 1;
      };
      const awo = wOrder((a as any)?.wave);
      const bwo = wOrder((b as any)?.wave);
      if (awo !== bwo) return awo - bwo;
      const ao = Number((a as any)?.order ?? 0);
      const bo = Number((b as any)?.order ?? 0);
      if (ao !== bo) return ao - bo;
      return Number((a as any)?.id ?? 0) - Number((b as any)?.id ?? 0);
    });
    return scopes;
  }, [schedule?.scopes, (schedule as any)?.waves]);

  const sortedWaves = useMemo(() => {
    const waves: any[] = Array.isArray((schedule as any)?.waves) ? (((schedule as any).waves || []) as any[]) : [];
    const res = waves.slice();
    res.sort((a: any, b: any) => (Number(a?.order ?? 0) - Number(b?.order ?? 0)) || (Number(a?.id ?? 0) - Number(b?.id ?? 0)));
    return res;
  }, [(schedule as any)?.waves]);

  const waveIdByScopeId = useMemo(() => {
    const m = new Map<number, number | null>();
    for (const s of sortedScopes) {
      const sid = Number((s as any)?.id);
      if (!sid) continue;
      const wid = (s as any)?.wave;
      m.set(sid, wid == null ? null : Number(wid));
    }
    return m;
  }, [sortedScopes]);

  useEffect(() => {
    const next = new Map<number, string>();
    for (const s of sortedScopes || []) {
      const id = Number((s as any)?.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const raw = (s as any)?.start_time ? String((s as any)?.start_time) : '';
      next.set(id, raw);
    }
    setScopeStartTimeTextById(next);
  }, [sortedScopes]);

  useEffect(() => {
    let canceled = false;

    const run = async () => {
      const scopes = sortedScopes || [];
      const ids = Array.from(new Set(scopes.map(s => Number(s?.tournament)).filter(Boolean)));
      if (!ids.length) {
        setScopeTournamentTitleById(new Map());
        setTournamentStartTimeById(new Map());
        setTournamentScheduleNameById(new Map());
        return;
      }

      try {
        const items = await Promise.all(
          ids.map(async tid => {
            try {
              const t = await tournamentApi.getById(tid);
              return [
                tid,
                String((t as any)?.name || `#${tid}`),
                String((t as any)?.name_for_schedule || '').trim(),
                hhmm((t as any)?.start_time),
              ] as const;
            } catch {
              return [tid, `#${tid}`, '', ''] as const;
            }
          }),
        );
        if (canceled) return;
        const map = new Map<number, string>();
        const schNameMap = new Map<number, string>();
        const stMap = new Map<number, string>();
        for (const [tid, title, schName, st] of items) {
          map.set(tid, title);
          if (schName) schNameMap.set(tid, schName);
          if (st) stMap.set(tid, st);
        }
        setScopeTournamentTitleById(map);
        setTournamentScheduleNameById(schNameMap);
        setTournamentStartTimeById(stMap);
      } catch {
        if (canceled) return;
        setScopeTournamentTitleById(new Map());
        setTournamentStartTimeById(new Map());
        setTournamentScheduleNameById(new Map());
      }
    };

    run();
    return () => {
      canceled = true;
    };
  }, [sortedScopes]);

  const handleScopesReorder = async (scopeIds: number[]) => {
    if (!schedule) return;
    setSaving(true);
    try {
      const res: any = await scheduleApi.scopesReorder(schedule.id, scopeIds);
      if (!res?.ok) {
        alert(res?.detail || res?.error || 'Не удалось изменить порядок турниров');
        return;
      }
      setSchedule(res.schedule);
      setLastSavedSchedule(res.schedule);
      await refreshSideData(res.schedule.id);
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось изменить порядок турниров');
    } finally {
      setSaving(false);
    }
  };

  const handleWaveAdd = async () => {
    if (!schedule) return;
    setSaving(true);
    try {
      const res: any = await scheduleApi.wavesAdd(schedule.id, {});
      if (!res?.ok) {
        alert(res?.detail || res?.error || 'Не удалось добавить волну');
        return;
      }
      setSchedule(res.schedule);
      await refreshSideData(res.schedule.id);
    } catch (e: any) {
      alert(e?.message || 'Не удалось добавить волну');
    } finally {
      setSaving(false);
    }
  };

  const handleWaveUpdate = async (waveId: number, patch: any) => {
    if (!schedule) return;
    setSaving(true);
    try {
      const res: any = await scheduleApi.wavesUpdate(schedule.id, { wave_id: waveId, ...patch });
      if (!res?.ok) {
        alert(res?.detail || res?.error || 'Не удалось обновить волну');
        return;
      }
      setSchedule(res.schedule);
      await refreshSideData(res.schedule.id);
    } catch (e: any) {
      alert(e?.message || 'Не удалось обновить волну');
    } finally {
      setSaving(false);
    }
  };

  const handleWaveRemove = async (waveId: number) => {
    if (!schedule) return;
    if (!window.confirm('Удалить волну? Турниры из неё будут перемещены в первую волну.')) return;
    setSaving(true);
    try {
      const res: any = await scheduleApi.wavesRemove(schedule.id, { wave_id: waveId });
      if (!res?.ok) {
        alert(res?.detail || res?.error || 'Не удалось удалить волну');
        return;
      }
      setSchedule(res.schedule);
      await refreshSideData(res.schedule.id);
    } catch (e: any) {
      alert(e?.message || 'Не удалось удалить волну');
    } finally {
      setSaving(false);
    }
  };

  const handleWavesReorder = async (waveIds: number[]) => {
    if (!schedule) return;
    setSaving(true);
    try {
      const res: any = await scheduleApi.wavesReorder(schedule.id, waveIds);
      if (!res?.ok) {
        alert(res?.detail || res?.error || 'Не удалось изменить порядок волн');
        return;
      }
      setSchedule(res.schedule);
      await refreshSideData(res.schedule.id);
    } catch (e: any) {
      alert(e?.message || 'Не удалось изменить порядок волн');
    } finally {
      setSaving(false);
    }
  };

  const handleScopeMoveToWave = async (scopeId: number, waveId: number) => {
    if (!schedule) return;
    setSaving(true);
    try {
      const res: any = await scheduleApi.scopesMoveToWave(schedule.id, { scope_id: scopeId, wave_id: waveId });
      if (!res?.ok) {
        alert(res?.detail || res?.error || 'Не удалось переместить турнир в волну');
        return;
      }
      setSchedule(res.schedule);
      await refreshSideData(res.schedule.id);
    } catch (e: any) {
      alert(e?.message || 'Не удалось переместить турнир в волну');
    } finally {
      setSaving(false);
    }
  };

  const handleScopeUpdate = async (scopeId: number, patch: any) => {
    if (!schedule) return;
    setSaving(true);
    try {
      const res: any = await scheduleApi.scopesUpdate(schedule.id, { scope_id: scopeId, ...patch });
      if (!res?.ok) {
        alert(res?.detail || res?.error || 'Не удалось обновить настройки турнира');
        return;
      }
      setSchedule(res.schedule);
      setLastSavedSchedule(res.schedule);
      await refreshSideData(res.schedule.id);
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось обновить настройки турнира');
    } finally {
      setSaving(false);
    }
  };

  const handleScopeRemove = async (scopeId: number) => {
    if (!schedule) return;
    if (!window.confirm('Удалить турнир из мульти-расписания?')) return;
    setSaving(true);
    try {
      const res: any = await scheduleApi.scopesRemove(schedule.id, { scope_id: scopeId });
      if (!res?.ok) {
        alert(res?.detail || res?.error || 'Не удалось удалить турнир');
        return;
      }
      setSchedule(res.schedule);
      setLastSavedSchedule(res.schedule);
      await refreshSideData(res.schedule.id);
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось удалить турнир');
    } finally {
      setSaving(false);
    }
  };

  const handleScopeAdd = async () => {
    if (!schedule) return;
    const tid = selectedTournamentToAddId;
    if (!tid) {
      alert('Выберите турнир');
      return;
    }
    setSaving(true);
    try {
      const res: any = await scheduleApi.scopesAdd(schedule.id, { tournament_id: tid });
      if (!res?.ok) {
        alert(res?.detail || res?.error || 'Не удалось добавить турнир');
        return;
      }
      setSchedule(res.schedule);
      setLastSavedSchedule(res.schedule);
      setSelectedTournamentToAddId(null);
      await refreshSideData(res.schedule.id);
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось добавить турнир');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!showScopesModal || !schedule?.id) return;
    let canceled = false;
    const run = async () => {
      setAvailableTournamentsLoading(true);
      try {
        const res = await scheduleApi.scopesAvailableTournaments(schedule.id, availableTournamentQuery || undefined);
        if (canceled) return;
        const items = res?.tournaments || [];
        setAvailableTournaments(items);
        const map = new Map<number, string>();
        for (const t of items) {
          const st = hhmm((t as any)?.start_time);
          if (st) map.set(Number(t.id), st);
        }
        setTournamentStartTimeById(map);
      } catch {
        if (canceled) return;
        setAvailableTournaments([]);
        setTournamentStartTimeById(new Map());
      } finally {
        if (!canceled) setAvailableTournamentsLoading(false);
      }
    };

    const timer = window.setTimeout(run, 250);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [showScopesModal, schedule?.id, availableTournamentQuery]);

  useEffect(() => {
    if (canManage) return;
    setViewMode('timeline');
    setShowFact(true);
  }, [canManage]);

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

  const updateCourtName = (courtIndex: number, name: string) => {
    if (!schedule) return;
    setSchedule(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        courts: (prev.courts || []).map(c => (c.index === courtIndex ? { ...c, name } : c)),
      };
    });
    setIsDirty(true);
  };

  const updateSlotOverrideSubtitle = (slotId: number, override_subtitle: string | null) => {
    if (!schedule) return;
    setSchedule(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        slots: (prev.slots || []).map(s => (s.id === slotId ? { ...s, override_subtitle } : s)),
      };
    });
    setIsDirty(true);
  };

  useEffect(() => {
    if (!schedule) {
      setLocalConflictsSlotIds(null);
      return;
    }

    const runIndexById = new Map<number, number>();
    schedule.runs.forEach(r => runIndexById.set(r.id, r.index));

    const slotsByRun = new Map<number, Array<{ slotId: number; matchId: number; playerIds: string[] }>>();

    const parseRrVirtualKeys = (m: any): string[] => {
      const gi = m?.group_index;
      const group = gi != null && gi !== '' ? Number(gi) : NaN;
      if (!Number.isFinite(group)) return [];

      // Backend encodes virtual positions into round_name like "гр.1 • 2-3".
      const rn = String(m?.round_name || '').trim();
      const mPair = rn.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (!mPair) return [];
      const a = Number(mPair[1]);
      const b = Number(mPair[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
      return [`rr:${group}:${a}`, `rr:${group}:${b}`];
    };

    const parseKingLetterKeys = (m: any): string[] => {
      const gi = m?.group_index;
      const group = gi != null && gi !== '' ? Number(gi) : NaN;
      if (!Number.isFinite(group)) return [];

      // Prefer team display names like "A+B".
      const aRaw = String(m?.team_1?.display_name || m?.team_1?.full_name || '').trim();
      const bRaw = String(m?.team_2?.display_name || m?.team_2?.full_name || '').trim();
      const combined = [aRaw, bRaw].filter(Boolean).join(' vs ');
      const text = combined || String(m?.round_name || '').trim();

      // Extract letters A..Z from "A+B vs C+D".
      const mLetters = text.match(/([A-Z])\s*\+\s*([A-Z]).*?([A-Z])\s*\+\s*([A-Z])/i);
      if (!mLetters) return [];
      const letters = [mLetters[1], mLetters[2], mLetters[3], mLetters[4]].map(x => String(x).toUpperCase());
      return letters.map(l => `k:${group}:${l}`);
    };

    for (const s of schedule.slots || []) {
      if (!s?.match || !s?.id) continue;
      const m = matchById.get(Number(s.match));
      if (!m) continue;
      const runIndex = runIndexById.get(s.run);
      if (!runIndex) continue;

      const keys: string[] = [];

      const t1p1 = m?.team_1?.player_1?.id;
      const t1p2 = m?.team_1?.player_2?.id;
      const t2p1 = m?.team_2?.player_1?.id;
      const t2p2 = m?.team_2?.player_2?.id;
      if (t1p1) keys.push(`p:${Number(t1p1)}`);
      if (t1p2) keys.push(`p:${Number(t1p2)}`);
      if (t2p1) keys.push(`p:${Number(t2p1)}`);
      if (t2p2) keys.push(`p:${Number(t2p2)}`);

      if (!keys.length && tournamentSystem === 'round_robin' && isDraftMode) {
        keys.push(...parseRrVirtualKeys(m));
      }

      if (!keys.length && tournamentSystem === 'king' && isDraftMode) {
        keys.push(...parseKingLetterKeys(m));
      }

      if (!keys.length && tournamentSystem !== 'knockout') continue;
      const arr = slotsByRun.get(runIndex) || [];
      arr.push({ slotId: Number(s.id), matchId: Number(s.match), playerIds: keys });
      slotsByRun.set(runIndex, arr);
    }

    const conflictIds = new Set<number>();
    for (const [, entries] of slotsByRun) {
      const counts = new Map<string, number>();
      for (const e of entries) {
        for (const pid of e.playerIds) counts.set(pid, (counts.get(pid) || 0) + 1);
      }
      const conflictPlayers = new Set<string>();
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

  const getMatchTitle = (matchId: number) => {
    const m = matchById.get(matchId);
    if (!m) return `Матч #${matchId}`;
    if (isDraftMode) return matchMetaLabel(m) || `Матч #${matchId}`;
    if (tournamentSystem === 'king') return matchMetaLabel(m) || `Матч #${matchId}`;
    const a = m?.team_1?.full_name || m?.team_1?.display_name || 'TBD';
    const b = m?.team_2?.full_name || m?.team_2?.display_name || 'TBD';
    return `${matchMetaLabel(m) || `#${matchId}`} — ${a} / ${b}`;
  };

  const kingTeamLetters = (team: any, groupIndex: any): string => {
    if (!team) return '';
    const gi = groupIndex != null && groupIndex !== '' ? Number(groupIndex) : NaN;

    const playerIds: number[] = [];
    if (Array.isArray(team.players)) {
      for (const p of team.players) {
        if (p?.id != null) playerIds.push(Number(p.id));
      }
    } else {
      const p1 = typeof team.player_1 === 'object' ? team.player_1?.id : team.player_1;
      const p2 = typeof team.player_2 === 'object' ? team.player_2?.id : team.player_2;
      if (p1 != null) playerIds.push(Number(p1));
      if (p2 != null) playerIds.push(Number(p2));
    }

    if (!Number.isFinite(gi) || !playerIds.length) return '';
    const letters = playerIds
      .map(pid => kingLetterByGroupPlayerId.get(`${gi}:${pid}`))
      .filter(Boolean) as string[];
    if (!letters.length) return '';

    // Ensure stable order A+B
    const uniq = Array.from(new Set(letters)).sort((a, b) => a.localeCompare(b));
    return uniq.join('+');
  };

  const kingPlayerLabel = (player: any): string => {
    if (!player) return 'TBD';
    const last = String(player.last_name || '').trim();
    const first = String(player.first_name || '').trim();
    const base = last || String(player.display_name || '').trim();
    if (!base) return 'TBD';
    const cnt = surnameCounts.get(base) || 0;
    if (cnt > 1 && first) return `${base} ${first.slice(0, 1)}`;
    return base;
  };

  const kingTeamPlayerLabels = (team: any): string[] => {
    if (!team) return ['TBD'];
    const players: any[] = [];
    if (Array.isArray(team.players) && team.players.length) {
      players.push(...team.players);
    } else {
      const p1 = team.player_1;
      const p2 = team.player_2;
      if (p1) players.push(p1);
      if (p2) players.push(p2);
    }
    const labels = players.map(kingPlayerLabel).filter(Boolean);
    return labels.length ? labels.slice(0, 2) : ['TBD'];
  };

  const matchMetaLabel = (m: any): string => {
    if (!m) return '';
    const tid = Number((m as any)?.tournament ?? NaN);
    const prefix = Number.isFinite(tid) ? String(tournamentScheduleNameById.get(tid) || '').trim() : '';
    const gi = m?.group_index;

    const group =
      gi !== null && gi !== undefined && gi !== ''
        ? `гр.${isProAmRoundRobin ? proAmGroupLetter(gi) : gi}`
        : '';

    if (tournamentSystem === 'round_robin') {
      const t1id = m?.team_1?.id;
      const t2id = m?.team_2?.id;
      const r1 = t1id ? rrTeamRowById.get(Number(t1id)) : undefined;
      const r2 = t2id ? rrTeamRowById.get(Number(t2id)) : undefined;
      const pair = r1 && r2 ? `${r1}-${r2}` : '';
      if (pair) return [prefix, [group, pair].filter(Boolean).join(' • ')].filter(Boolean).join(' ');

      // Draft RR matches may have no team ids. In this case backend encodes virtual pairing
      // into round_name like "гр.1 • 2-3".
      const rn = String(m?.round_name || '').trim();
      if (isDraftMode && rn) {
        if (isProAmRoundRobin) {
          const replaced = rn.replace(/\bгр\.(\d+)\b/g, (_m, d) => `гр.${proAmGroupLetter(d)}`);
          return [prefix, replaced].filter(Boolean).join(' ');
        }
        return [prefix, rn].filter(Boolean).join(' ');
      }
      return [prefix, group].filter(Boolean).join(' ');
    }
    if (tournamentSystem === 'king') {
      if (isDraftMode) {
        const aLetters = kingTeamLetters(m?.team_1, m?.group_index);
        const bLetters = kingTeamLetters(m?.team_2, m?.group_index);
        if (aLetters && bLetters) {
          return [prefix, [group, `${aLetters} vs ${bLetters}`].filter(Boolean).join(' • ')].filter(Boolean).join(' ');
        }

        const normalizePair = (s: string): string => {
          return String(s || '')
            .replace(/\s+/g, '')
            .replace(/\//g, '+')
            .toUpperCase();
        };

        const aRaw = m?.team_1?.display_name || m?.team_1?.full_name || '';
        const bRaw = m?.team_2?.display_name || m?.team_2?.full_name || '';
        const a = normalizePair(aRaw);
        const b = normalizePair(bRaw);
        const vs = a && b ? `${a} vs ${b}` : '';

        // Fallback: sometimes backend may encode meta into round_name.
        const rn = String(m?.round_name || '').trim();
        const meta = vs || rn || (m?.id != null ? `Матч ${m.id}` : '');
        return [prefix, [group, meta].filter(Boolean).join(' • ')].filter(Boolean).join(' ');
      }
      const a = kingTeamLetters(m?.team_1, m?.group_index);
      const b = kingTeamLetters(m?.team_2, m?.group_index);
      const vs = a && b ? `${a} vs ${b}` : '';
      return [prefix, [group, vs].filter(Boolean).join(' • ')].filter(Boolean).join(' ');
    }
    if (tournamentSystem === 'knockout') {
      const meta = String(m?.round_name || '').trim() || `Раунд ${m?.round_index ?? ''}`.trim();
      return [prefix, meta].filter(Boolean).join(' ');
    }
    return [prefix, group].filter(Boolean).join(' ');
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

  const dropOrPickCell = (runIndex: number, courtIndex: number) => {
    if (!canManage) return;
    const slot = slotsByRunCourt.get(`${runIndex}:${courtIndex}`);
    const hasMatch = !!slot?.match;
    const cellMatchId: number | null = slot?.match ? Number(slot.match) : null;

    // If we have something selected (from pool OR picked from another cell) -> drop here.
    if (selectedMatchId) {
      const placingId = Number(selectedMatchId);
      if (pickedFromCell) {
        // If target occupied, swap matches.
        if (cellMatchId && cellMatchId !== placingId) {
          applyAssign(pickedFromCell.runIndex, pickedFromCell.courtIndex, cellMatchId);
        } else {
          applyAssign(pickedFromCell.runIndex, pickedFromCell.courtIndex, null);
        }
        setPickedFromCell(null);
      }
      applyAssign(runIndex, courtIndex, placingId);
      return;
    }

    // No selection: if tapped on a filled cell -> pick it up for move.
    if (hasMatch && cellMatchId) {
      setPickedFromCell({ runIndex, courtIndex, matchId: cellMatchId });
      setSelectedMatchId(cellMatchId);
      return;
    }
  };

  const clearDrag = () => {
    setDragMatchId(null);
    setDragSource(null);
    setDragOverCell(null);
    setDragOverUnassigned(false);

    setDragColumnIndex(null);
    setDragOverColumnIndex(null);
    setDragRowIndex(null);
    setDragOverRowIndex(null);
  };

  const swapCellsMany = (pairs: Array<{ a: { runIndex: number; courtIndex: number }; b: { runIndex: number; courtIndex: number } }>) => {
    if (!schedule) return;

    const runIdByIndex = new Map<number, number>();
    const courtIdByIndex = new Map<number, number>();
    for (const r of schedule.runs || []) runIdByIndex.set(r.index, r.id);
    for (const c of schedule.courts || []) courtIdByIndex.set(c.index, c.id);

    setSchedule(prev => {
      if (!prev) return prev;

      const slotByKey = new Map<string, any>();
      for (const s of prev.slots || []) {
        slotByKey.set(`${s.run}:${s.court}`, s);
      }

      const ensureSlot = (runId: number, courtId: number): any => {
        const key = `${runId}:${courtId}`;
        const ex = slotByKey.get(key);
        if (ex) return ex;
        const created = {
          id: -Date.now() + Math.floor(Math.random() * 1000),
          run: runId,
          court: courtId,
          slot_type: 'match',
          match: null,
          text_title: null,
          text_subtitle: null,
          override_title: null,
          override_subtitle: null,
        };
        slotByKey.set(key, created);
        return created;
      };

      for (const p of pairs) {
        const ra = runIdByIndex.get(p.a.runIndex);
        const ca = courtIdByIndex.get(p.a.courtIndex);
        const rb = runIdByIndex.get(p.b.runIndex);
        const cb = courtIdByIndex.get(p.b.courtIndex);
        if (!ra || !ca || !rb || !cb) continue;

        const sa = ensureSlot(ra, ca);
        const sb = ensureSlot(rb, cb);

        const aPayload = {
          slot_type: sa.slot_type,
          match: sa.match ?? null,
          text_title: sa.text_title ?? null,
          text_subtitle: sa.text_subtitle ?? null,
          override_title: sa.override_title ?? null,
          override_subtitle: sa.override_subtitle ?? null,
        };
        const bPayload = {
          slot_type: sb.slot_type,
          match: sb.match ?? null,
          text_title: sb.text_title ?? null,
          text_subtitle: sb.text_subtitle ?? null,
          override_title: sb.override_title ?? null,
          override_subtitle: sb.override_subtitle ?? null,
        };

        slotByKey.set(`${ra}:${ca}`, { ...sa, ...bPayload });
        slotByKey.set(`${rb}:${cb}`, { ...sb, ...aPayload });
      }

      return { ...prev, slots: Array.from(slotByKey.values()) };
    });

    setIsDirty(true);
  };

  const swapColumns = (courtIndexA: number, courtIndexB: number) => {
    if (!schedule || courtIndexA === courtIndexB) return;
    const runs = (schedule.runs || []).slice().sort((a, b) => a.index - b.index);
    const pairs = runs.map(r => ({
      a: { runIndex: r.index, courtIndex: courtIndexA },
      b: { runIndex: r.index, courtIndex: courtIndexB },
    }));
    swapCellsMany(pairs);
  };

  const swapRows = (runIndexA: number, runIndexB: number) => {
    if (!schedule || runIndexA === runIndexB) return;
    const courts = (schedule.courts || []).slice().sort((a, b) => a.index - b.index);
    const pairs = courts.map(c => ({
      a: { runIndex: runIndexA, courtIndex: c.index },
      b: { runIndex: runIndexB, courtIndex: c.index },
    }));
    swapCellsMany(pairs);
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
    if (viewMode !== 'timeline' || !showFact) {
      setLiveState(new Map());
      return;
    }

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
            sets: (m as any)?.sets ?? [],
          });
        }
        setLiveState(map);
      } catch {
        // noop
      } finally {
        if (!stopped) timer = setTimeout(tick, 60000);
      }
    };

    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [schedule?.id, viewMode, showFact]);

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

  const normalizeHmInput = (raw: string): string => {
    const cleaned = String(raw || '').replace(/[^0-9:]/g, '');
    const digits = cleaned.replace(/:/g, '').slice(0, 4);
    if (!digits) return '';
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  };

  const clampHm = (raw: string): string => {
    const norm = normalizeHmInput(raw);
    const m = norm.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    if (!m) return norm;
    const hh = Math.min(23, Math.max(0, Number(m[1] || 0)));
    const mm = Math.min(59, Math.max(0, Number(m[2] || 0)));
    const hhStr = String(hh).padStart(2, '0');
    const mmStr = String(mm).padStart(2, '0');
    return `${hhStr}:${mmStr}`;
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
    if (!raw) {
      const surnames: string[] = [];

      const maybePushLast = (pl: any) => {
        const last = String(pl?.last_name || '').trim();
        if (last) surnames.push(last);
      };

      if (Array.isArray(team.players) && team.players.length) {
        team.players.forEach((pl: any) => maybePushLast(pl));
      } else {
        const p1 = typeof team.player_1 === 'object' ? team.player_1 : null;
        const p2 = typeof team.player_2 === 'object' ? team.player_2 : null;
        maybePushLast(p1);
        maybePushLast(p2);
      }

      return surnames.length ? surnames.slice(0, 2) : ['TBD'];
    }

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

  const renderMatchTiny = (m: any) => {
    const s1 = tournamentSystem === 'king' ? kingTeamPlayerLabels(m?.team_1) : teamSurnames(m?.team_1);
    const s2 = tournamentSystem === 'king' ? kingTeamPlayerLabels(m?.team_2) : teamSurnames(m?.team_2);
    const a = s1.length ? s1.join(' / ') : 'TBD';
    const b = s2.length ? s2.join(' / ') : 'TBD';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.05 }}>
        <div style={{ fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a}</div>
        <div style={{ fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b}</div>
      </div>
    );
  };

  const renderMatchCompact = (m: any, variant: 'backlog' | 'schedule') => {
    if (isDraftMode) {
      const gi = m?.group_index;
      const group = gi != null && gi !== '' ? Number(gi) : NaN;
      const pair = isDraftMode && tournamentSystem === 'round_robin' && m?.id != null ? rrPairByMatchId.get(Number(m.id)) : undefined;
      const aPos = pair ? Number(pair[0]) : NaN;
      const bPos = pair ? Number(pair[1]) : NaN;
      const meta = Number.isFinite(group) && pair ? `гр.${group} • ${aPos}-${bPos}` : matchMetaLabel(m) || (m?.id ? `Матч #${m.id}` : 'Матч');

      if (isDraftPreviewMode && tournamentSystem === 'round_robin') {
        const ta = Number.isFinite(group) && Number.isFinite(aPos) ? rrTeamByGroupRow.get(`rr:${group}:${aPos}`) : null;
        const tb = Number.isFinite(group) && Number.isFinite(bPos) ? rrTeamByGroupRow.get(`rr:${group}:${bPos}`) : null;

        const s1 = teamSurnames(ta);
        const s2 = teamSurnames(tb);
        const a = s1.length ? s1.join(' / ') : 'TBD';
        const b = s2.length ? s2.join(' / ') : 'TBD';

        if (variant === 'backlog') {
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.15, width: '100%' }}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>{meta}</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{a}</div>
              <div style={{ fontSize: 12, fontWeight: 800, textAlign: 'left', opacity: 0.8 }}>против</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{b}</div>
            </div>
          );
        }

        // schedule grid
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.15, width: '100%', alignItems: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.75, textAlign: 'right', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {meta}
            </div>
            <div style={{ fontSize: 16, fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center', width: '100%' }}>{a}</div>
            <div style={{ fontSize: 12, fontWeight: 800, textAlign: 'center' }}>против</div>
            <div style={{ fontSize: 16, fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center', width: '100%' }}>{b}</div>
          </div>
        );
      }

      if (variant === 'backlog') {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.1 }}>
            <div style={{ fontSize: 11, fontWeight: 700 }}>{meta}</div>
          </div>
        );
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.1 }}>
          <div style={{ fontSize: 11, fontWeight: 700 }}>{meta}</div>
        </div>
      );
    }
    const s1 = tournamentSystem === 'king' ? kingTeamPlayerLabels(m?.team_1) : teamSurnames(m?.team_1);
    const s2 = tournamentSystem === 'king' ? kingTeamPlayerLabels(m?.team_2) : teamSurnames(m?.team_2);
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
    const [mp, pt] = await Promise.all([scheduleApi.matchesPool(sch.id), scheduleApi.plannedTimes(sch.id)]);
    const matches = mp.matches || [];
    const sortedRuns = (sch.runs || []).slice().sort((a, b) => a.index - b.index);
    const sortedCourts = (sch.courts || []).slice().sort((a, b) => a.index - b.index);

    const plannedStartMinutesByRun = new Map<number, number>();
    const parseMinutes = (raw: any): number | null => {
      const s = hhmm(raw);
      if (!s) return null;
      const parts = s.split(':');
      if (parts.length < 2) return null;
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
      return h * 60 + m;
    };
    try {
      for (const r of (pt as any)?.runs || []) {
        const idx = Number((r as any)?.index);
        const mins = parseMinutes((r as any)?.planned_start_time);
        if (Number.isFinite(idx) && idx > 0 && mins != null) plannedStartMinutesByRun.set(idx, mins);
      }
    } catch {
      // ignore
    }

    const waves: any[] = Array.isArray((sch as any)?.waves) ? (((sch as any).waves || []) as any[]) : [];
    const sortedWavesLocal = waves
      .slice()
      .sort((a: any, b: any) => (Number(a?.order ?? 0) - Number(b?.order ?? 0)) || (Number(a?.id ?? 0) - Number(b?.id ?? 0)));
    const waveOrderById = new Map<number, number>();
    for (const w of sortedWavesLocal) {
      const wid = Number((w as any)?.id);
      if (!wid) continue;
      const ord = Number((w as any)?.order ?? 0);
      waveOrderById.set(wid, Number.isFinite(ord) && ord > 0 ? ord : 1);
    }
    const waveMinStartMinutesById = new Map<number, number | null>();
    for (const w of sortedWavesLocal) {
      const wid = Number((w as any)?.id);
      if (!wid) continue;
      const mode = String((w as any)?.start_mode || 'after_previous');
      const st = parseMinutes((w as any)?.start_time);
      const et = parseMinutes((w as any)?.earliest_time);
      const min = Math.max(st ?? 0, et ?? 0);
      if (mode === 'fixed') {
        waveMinStartMinutesById.set(wid, st != null ? st : null);
      } else {
        waveMinStartMinutesById.set(wid, min > 0 ? min : null);
      }
    }

    const scopeByTournamentId = new Map<number, any>();
    for (const sc of (sch.scopes || []) as any[]) {
      const tid = Number((sc as any)?.tournament);
      if (!tid) continue;
      scopeByTournamentId.set(tid, sc);
    }

    const courtIndexById = new Map<number, number>();
    for (const c of sortedCourts) courtIndexById.set(Number(c.id), Number(c.index));

    const reservedCourtIndices = new Set<number>();
    const boundCourtIndicesByTournamentId = new Map<number, number[]>();
    for (const [tid, sc] of scopeByTournamentId.entries()) {
      const raw = (sc as any)?.bound_courts;
      if (!Array.isArray(raw) || raw.length === 0) continue;
      const idxs = raw
        .map((cid: any) => courtIndexById.get(Number(cid)) || 0)
        .filter((x: number) => Number.isFinite(x) && x > 0)
        .sort((a: number, b: number) => a - b);
      if (!idxs.length) continue;
      boundCourtIndicesByTournamentId.set(tid, idxs);
      for (const i of idxs) reservedCourtIndices.add(i);
    }

    const unreservedCourtIndices = sortedCourts
      .map(c => Number(c.index))
      .filter(i => Number.isFinite(i) && i > 0 && !reservedCourtIndices.has(i));

    const matchTournamentId = (m: any): number => {
      const t = m?.tournament;
      if (typeof t === 'number') return Number(t);
      if (typeof t === 'string') return Number(t);
      const id = (t as any)?.id;
      return id != null ? Number(id) : Number(m?.tournament_id || 0);
    };

    const allowedCourtsForMatch = (m: any): number[] => {
      const tid = matchTournamentId(m);
      const bound = boundCourtIndicesByTournamentId.get(tid);
      if (bound && bound.length) return bound;
      if (reservedCourtIndices.size) return unreservedCourtIndices;
      return sortedCourts.map(c => Number(c.index)).filter(i => Number.isFinite(i) && i > 0);
    };

    const matchWaveId = (m: any): number | null => {
      const tid = matchTournamentId(m);
      const sc = scopeByTournamentId.get(tid);
      const wid = (sc as any)?.wave;
      const n = wid == null ? NaN : Number(wid);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const waveOrderForMatch = (m: any): number => {
      const wid = matchWaveId(m);
      if (!wid) return 1;
      return waveOrderById.get(wid) ?? 1;
    };

    const isRunAllowedForMatch = (m: any, runIndex: number): boolean => {
      const mins = plannedStartMinutesByRun.get(runIndex);
      if (mins == null) return true;
      const wid = matchWaveId(m);
      if (!wid) return true;
      const minStart = waveMinStartMinutesById.get(wid);
      if (minStart == null) return true;
      return mins >= minStart;
    };

    const matchByIdFromPool = new Map<number, any>();
    for (const m of matches) {
      if (m?.id) matchByIdFromPool.set(Number(m.id), m);
    }

    const matchQueue: Array<{ m: any; preferredCourt?: number | null }> = [];
    const already = new Set<number>();

    // 1) Сначала берем уже назначенные матчи в порядке (run -> court), чтобы "поздние" уезжали вниз.
    const runIndexById = new Map<number, number>();
    for (const r of sortedRuns) runIndexById.set(r.id, r.index);
    // courtIndexById already built above

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
    const remaining = matches.slice();
    remaining.sort((a: any, b: any) => {
      const wa = waveOrderForMatch(a);
      const wb = waveOrderForMatch(b);
      if (wa !== wb) return wa - wb;
      const sa = String(a?.stage ?? '');
      const sb = String(b?.stage ?? '');
      if (sa !== sb) return sa.localeCompare(sb);
      const ra = Number(a?.round_index ?? 0);
      const rb = Number(b?.round_index ?? 0);
      if (ra !== rb) return ra - rb;
      const ia = Number(a?.order_in_round ?? 0);
      const ib = Number(b?.order_in_round ?? 0);
      if (ia !== ib) return ia - ib;
      return Number(a?.id ?? 0) - Number(b?.id ?? 0);
    });

    const interleavedRemaining: any[] = [];
    let i = 0;
    while (i < remaining.length) {
      const base = remaining[i];
      const w = waveOrderForMatch(base);
      const s = String(base?.stage ?? '');
      const r = Number(base?.round_index ?? 0);
      const group: any[] = [];
      while (i < remaining.length) {
        const cur = remaining[i];
        if (waveOrderForMatch(cur) !== w) break;
        if (String(cur?.stage ?? '') !== s) break;
        if (Number(cur?.round_index ?? 0) !== r) break;
        group.push(cur);
        i += 1;
      }

      const byTid = new Map<number, any[]>();
      for (const mm of group) {
        const tid = matchTournamentId(mm);
        if (!tid) continue;
        if (!byTid.has(tid)) byTid.set(tid, []);
        byTid.get(tid)!.push(mm);
      }
      const tids = Array.from(byTid.keys()).sort((a, b) => a - b);
      let added = 0;
      while (true) {
        let progress = false;
        for (const tid of tids) {
          const q = byTid.get(tid);
          if (!q || !q.length) continue;
          interleavedRemaining.push(q.shift());
          progress = true;
          added += 1;
        }
        if (!progress) break;
      }

      if (added < group.length) {
        for (const mm of group) {
          if (!interleavedRemaining.includes(mm)) interleavedRemaining.push(mm);
        }
      }
    }

    for (const mm of interleavedRemaining) {
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

      // For draft RR matches (no teams assigned), extract virtual IDs from round_name
      // e.g., "гр.1 • 1-12" -> group 1, positions 1 and 12
      if (pids.length === 0 && isDraftMode && tournamentSystem === 'round_robin') {
        const rn = String(m?.round_name || '').trim();
        const gi = m?.group_index;
        if (rn && gi != null) {
          const match = rn.match(/(\d+)-(\d+)/);
          if (match) {
            const pos1 = Number(match[1]);
            const pos2 = Number(match[2]);
            // Use negative IDs to avoid collision with real player IDs
            // Format: -(group * 1000 + position)
            const g = Number(gi);
            if (Number.isFinite(g) && Number.isFinite(pos1) && Number.isFinite(pos2)) {
              pids.push(-(g * 1000 + pos1));
              pids.push(-(g * 1000 + pos2));
            }
          }
        }
      }

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

    const koMatchIdByKey = new Map<string, number>();
    for (const m of matches) {
      const k = koMatchKey(m);
      if (k && m?.id != null) koMatchIdByKey.set(k, Number(m.id));
    }

    const placedRunByKoKey = new Map<string, number>();

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
      if (!isRunAllowedForMatch(m, runIndex)) return false;
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

        // Global KO constraint: prereq matches must be placed in earlier runs
        for (const pk of prereqs) {
          if (!koMatchIdByKey.has(pk)) continue;
          const placedRun = placedRunByKoKey.get(pk);
          if (placedRun == null) return false;
          if (placedRun >= runIndex) return false;
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
          if (k) {
            st.koKeys.add(k);
            placedRunByKoKey.set(k, runIndex);
          }
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
      const allowedCourts = allowedCourtsForMatch(m);
      if (!allowedCourts.length) {
        nextCell();
        continue;
      }
      const preferredCourtCandidate = Number(item.preferredCourt) || sortedCourts[cursorCourtPos]?.index || 1;
      const preferredCourt = allowedCourts.includes(preferredCourtCandidate) ? preferredCourtCandidate : allowedCourts[0];
      const currentRun = cursorRun;
      const currentKey = `${currentRun}:${preferredCourt}`;

      if (!existing.has(currentKey)) ensureRun(currentRun);
      const occupied = existing.get(currentKey);

      const tryRun = (runIndex: number): boolean => {
        ensureRun(runIndex);
        const allowedCourtObjs = sortedCourts.filter(c => allowedCourts.includes(Number(c.index)));
        const startIdx = allowedCourtObjs.findIndex(c => c.index === preferredCourt);
        const order =
          startIdx >= 0
            ? [...allowedCourtObjs.slice(startIdx), ...allowedCourtObjs.slice(0, startIdx)]
            : allowedCourtObjs;
        for (const c of order) {
          const k = `${runIndex}:${Number(c.index)}`;
          if (existing.get(k)) continue;
          if (!canPlaceInRun(m, runIndex)) continue;
          placeInto(m, runIndex, Number(c.index));
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
      if (t?.name) setTournamentName(String(t.name));

      // For RR label like "1-2" we need row_index of teams (same logic as in TournamentDetailPage)
      const nextMap = new Map<number, number>();
      const nextByGroupRow = new Map<string, any>();
      const nextKing = new Map<string, string>();
      const nextSurnameCounts = new Map<string, number>();
      const parts: any[] = (t as any)?.participants || [];
      for (const p of parts) {
        const teamId = p?.team?.id;
        const rowIndex = p?.row_index;
        if (teamId && rowIndex) {
          nextMap.set(Number(teamId), Number(rowIndex));
        }

        const giRaw = p?.group_index;
        const gi = giRaw != null && giRaw !== '' ? Number(giRaw) : NaN;
        const ri = rowIndex != null && rowIndex !== '' ? Number(rowIndex) : NaN;
        if (Number.isFinite(gi) && Number.isFinite(ri) && p?.team) {
          nextByGroupRow.set(`rr:${gi}:${ri}`, p.team);
        }

        const g = gi;
        const r = ri;
        if (Number.isFinite(g) && Number.isFinite(r)) {
          const letter = String.fromCharCode(64 + r); // 1->A
          const team: any = p?.team || {};
          const playerIds: number[] = [];
          if (Array.isArray(team.players)) {
            team.players.forEach((pl: any) => {
              if (pl?.id != null) playerIds.push(Number(pl.id));
              const last = String(pl?.last_name || '').trim();
              if (last) nextSurnameCounts.set(last, (nextSurnameCounts.get(last) || 0) + 1);
            });
          } else {
            const p1 = typeof team.player_1 === 'object' ? team.player_1?.id : team.player_1;
            const p2 = typeof team.player_2 === 'object' ? team.player_2?.id : team.player_2;
            if (p1 != null) playerIds.push(Number(p1));
            if (p2 != null) playerIds.push(Number(p2));

            const o1 = typeof team.player_1 === 'object' ? team.player_1 : null;
            const o2 = typeof team.player_2 === 'object' ? team.player_2 : null;
            const last1 = String(o1?.last_name || '').trim();
            const last2 = String(o2?.last_name || '').trim();
            if (last1) nextSurnameCounts.set(last1, (nextSurnameCounts.get(last1) || 0) + 1);
            if (last2) nextSurnameCounts.set(last2, (nextSurnameCounts.get(last2) || 0) + 1);
          }
          for (const pid of playerIds) {
            if (!Number.isFinite(pid)) continue;
            nextKing.set(`${g}:${pid}`, letter);
          }
        }
      }
      setRrTeamRowById(nextMap);
      setRrTeamByGroupRow(nextByGroupRow);
      setKingLetterByGroupPlayerId(nextKing);
      setSurnameCounts(nextSurnameCounts);

      if (t?.start_time) setStartTime(formatHm(t.start_time as any));
      if (t?.date && typeof t.date === 'string') {
        // date stays server side, we only use start_time in generation
      }

      const res = isDraftMode ? await tournamentApi.getDraftSchedule(tournamentId) : await tournamentApi.getSchedule(tournamentId);
      const sch = res?.schedule || null;
      setSchedule(sch);
      setLastSavedSchedule(sch);
      setIsDirty(false);
      if (sch?.match_duration_minutes) setMatchDuration(sch.match_duration_minutes);
      if (sch?.courts?.length) setCourtsCount(sch.courts.length);
      const st = sch?.courts?.sort((a, b) => a.index - b.index)?.[0]?.first_start_time || sch?.runs?.sort((a, b) => a.index - b.index)?.[0]?.start_time;
      if (st) setStartTime(formatHm(st));

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
  }, [tournamentId, isDraftMode]);

  useEffect(() => {
    let canceled = false;

    const run = async () => {
      if (!isDraftMode || tournamentSystem !== 'round_robin' || !Number.isFinite(tournamentId)) {
        setRrPairByMatchId(new Map());
        return;
      }

      try {
        const gs: any = await tournamentApi.getGroupSchedule(tournamentId);
        if (canceled) return;
        const groups = gs?.groups || {};
        const matchMap = new Map<number, [number, number]>();

        const poolLocal: any[] = Array.isArray(pool) ? pool : [];
        const byGroupRound = new Map<string, any[]>();
        for (const mm of poolLocal) {
          const g = mm?.group_index;
          const r = mm?.round_index;
          const giN = g != null && g !== '' ? Number(g) : NaN;
          const riN = r != null && r !== '' ? Number(r) : NaN;
          if (!Number.isFinite(giN) || !Number.isFinite(riN)) continue;
          if (!mm?.id) continue;
          const k = `${giN}:${riN}`;
          const arr = byGroupRound.get(k) || [];
          arr.push(mm);
          byGroupRound.set(k, arr);
        }

        for (const [gKey, rounds] of Object.entries<any>(groups)) {
          const giN = Number(gKey);
          if (!Number.isFinite(giN)) continue;
          const roundsArr: any[] = Array.isArray(rounds) ? rounds : [];
          for (let ri = 0; ri < roundsArr.length; ri++) {
            const pairs: any[] = Array.isArray(roundsArr[ri]) ? roundsArr[ri] : [];
            const k = `${giN}:${ri + 1}`;
            const matchesInRound = (byGroupRound.get(k) || [])
              .slice()
              .sort((a, b) => (Number(a?.order_in_round || 0) - Number(b?.order_in_round || 0)));
            for (let pi = 0; pi < pairs.length; pi++) {
              const mm = matchesInRound[pi];
              const p = pairs[pi];
              if (!mm?.id || !Array.isArray(p) || p.length < 2) continue;
              const aPos = Number(p[0]);
              const bPos = Number(p[1]);
              if (!Number.isFinite(aPos) || !Number.isFinite(bPos)) continue;
              matchMap.set(Number(mm.id), [aPos, bPos]);
            }
          }
        }

        if (!canceled) setRrPairByMatchId(matchMap);
      } catch {
        if (!canceled) setRrPairByMatchId(new Map());
      }
    };

    run();
    return () => {
      canceled = true;
    };
  }, [isDraftMode, tournamentSystem, tournamentId, pool]);

  useEffect(() => {
    setCourtsCountText(String(courtsCount || 1));
  }, [courtsCount]);

  useEffect(() => {
    setMatchDurationText(String(matchDuration || 10));
  }, [matchDuration]);

  const handleGenerate = async () => {
    if (!canManage) return;
    setSaving(true);
    try {
      // In multi-tournament mode, schedule is owned by Schedule entity.
      // tournamentApi.generateSchedule creates a brand-new schedule for a single tournament,
      // which would drop other scopes/waves. If schedule already exists, we update it in-place.
      if (!isDraftMode && schedule) {
        const prevCourts = (schedule.courts || []).slice().sort((a, b) => a.index - b.index);
        const courts = Array.from({ length: Math.max(1, courtsCount) }).map((_, i) => {
          const idx = i + 1;
          const existing = prevCourts.find(c => Number(c.index) === idx);
          return {
            ...(existing || { id: -idx, index: idx, name: `Корт ${idx}` }),
            index: idx,
            name: (existing?.name || `Корт ${idx}`) as any,
            first_start_time: startTime,
          };
        });

        const prevRuns = (schedule.runs || []).slice().sort((a, b) => a.index - b.index);
        const runs = prevRuns.length
          ? prevRuns.map(r => {
              if (r.index === 1) return { ...r, start_mode: 'fixed', start_time: startTime, not_earlier_time: null };
              return { ...r, start_mode: 'then', start_time: null, not_earlier_time: null };
            })
          : [{ id: -1 as any, index: 1, start_mode: 'fixed', start_time: startTime, not_earlier_time: null } as any];

        const next: ScheduleDTO = {
          ...schedule,
          match_duration_minutes: matchDuration,
          courts: courts as any,
          runs: runs as any,
          slots: (schedule.slots || []).map((s: any) => ({ ...s, match: null, slot_type: 'match' })),
        };
        const payload = buildSavePayloadFromSchedule(next);
        const saved = await scheduleApi.save(schedule.id, payload as any);
        setSchedule(saved.schedule);
        setLastSavedSchedule(saved.schedule);
        setIsDirty(false);
        await refreshSideData(saved.schedule.id);
        await autoAssignAndSave(saved.schedule);
        return;
      }

      const res: any = isDraftMode
        ? await tournamentApi.generateDraftSchedule(tournamentId, {
            courts_count: courtsCount,
            match_duration_minutes: matchDuration,
            start_time: startTime,
          })
        : await tournamentApi.generateSchedule(tournamentId, {
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
      if (isDraftMode) {
        const cleared: ScheduleDTO = {
          ...res.schedule,
          slots: (res.schedule.slots || []).map((s: any) => ({ ...s, match: null, slot_type: 'match' })),
        };
        await autoAssignAndSave(cleared);
      } else {
        await autoAssignAndSave(res.schedule);
      }
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

  const doExport = async (format: 'pdf' | 'docx' | 'xlsx' | 'numbers') => {
    if (!schedule) return;
    setExporting(true);
    try {
      const blob =
        format === 'pdf'
          ? await scheduleApi.exportPdf(schedule.id)
          : format === 'docx'
            ? await scheduleApi.exportDocx(schedule.id)
            : format === 'xlsx'
              ? await scheduleApi.exportXlsx(schedule.id)
              : await scheduleApi.exportNumbers(schedule.id);
      const ext = format === 'docx' ? 'docx' : format === 'pdf' ? 'pdf' : 'xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = format === 'numbers' ? `schedule_${schedule.id}_numbers.${ext}` : `schedule_${schedule.id}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e: any) {
      const msg =
        format === 'pdf'
          ? 'Не удалось экспортировать PDF'
          : format === 'docx'
            ? 'Не удалось экспортировать DOCX'
            : format === 'xlsx'
              ? 'Не удалось экспортировать Excel'
              : 'Не удалось экспортировать Numbers';
      alert(e?.response?.data?.detail || e?.message || msg);
    } finally {
      setExporting(false);
    }
  };

  const handleExport = () => {
    if (!schedule) return;
    setExportFormat('pdf');
    setShowExportDialog(true);
  };

  const handleCopyShareLink = async () => {
    if (!Number.isFinite(tournamentId)) return;
    const url = `${window.location.origin}/tournaments/${tournamentId}/schedule?view=timeline&fact=1`;
    try {
      await navigator.clipboard.writeText(url);
      alert('Ссылка скопирована');
    } catch {
      window.prompt('Скопируйте ссылку:', url);
    }
  };

  const handleDeleteSchedule = async () => {
    if (!schedule || !canManage) return;
    const label = isDraftMode ? 'черновик расписания' : 'расписание';
    if (!window.confirm(`Удалить ${label}?`)) return;
    setSaving(true);
    try {
      await scheduleApi.deleteSchedule(schedule.id);
      setSchedule(null);
      setLastSavedSchedule(null);
      setPool([]);
      setPlanned(null);
      setConflicts(null);
      setSelectedMatchId(null);
      clearDrag();
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось удалить');
    } finally {
      setSaving(false);
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
    <div className="container" style={{ maxWidth: '100%', width: '100%' }}>
      {canManage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }} data-export-exclude="true">
            <button className="btn" onClick={() => nav(`/tournaments/${tournamentId}`)}>
              Вернуться в турнир
            </button>
            {schedule && canManage && (
              <button
                className="btn"
                onClick={handleDeleteSchedule}
                disabled={saving}
                style={{ background: '#dc3545', borderColor: '#dc3545' }}
              >
                {isDraftMode ? 'Удалить черновик' : 'Удалить расписание'}
              </button>
            )}
          </div>
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
                <>
                  <button className="btn" onClick={() => setShowFact(v => !v)}>
                    {showFact ? 'Факт: вкл' : 'Факт: выкл'}
                  </button>
                  <button className="btn" onClick={handleCopyShareLink} title="Скопировать ссылку">
                    🔗
                  </button>
                </>
              )}
            </div>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {schedule && viewMode === 'grid' && (
              <>
                <button className="btn" disabled={saving || !canManage} onClick={handleSave}>Сохранить</button>
                <button className="btn" disabled={exporting} onClick={handleExport}>
                  {exporting ? (
                    <span className="sm-btn-loading">
                      <span className="sm-spinner" aria-hidden="true" />
                      Экспорт...
                    </span>
                  ) : (
                    'Экспорт в файл'
                  )}
                </button>
              </>
            )}

            {schedule && (
              <button className="btn" disabled={saving} onClick={() => setShowScopesModal(true)}>
                Турниры
              </button>
            )}
          </div>
        </div>
      )}

      {schedule && (
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {sortedScopes.map(s => {
            const tid = Number((s as any)?.tournament);
            const title = scopeTournamentTitleById.get(tid) || `#${tid}`;
            const wid = (s as any)?.wave;
            const wObj = sortedWaves.find(w => Number((w as any)?.id) === Number(wid));
            const waveBadge = wObj ? `Волна ${Number((wObj as any)?.order ?? 0) || 1}` : 'Волна 1';
            const mode = String((s as any)?.start_mode || '');
            const st = (s as any)?.start_time ? String((s as any)?.start_time) : '';
            const badge = mode === 'fixed' ? (st ? `fixed ${st}` : 'fixed') : 'after';
            return (
              <div key={(s as any)?.id || `${tid}`} style={{ padding: '6px 10px', border: '1px solid #eee', borderRadius: 10, background: '#fafafa' }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{waveBadge} • {badge}</div>
              </div>
            );
          })}
        </div>
      )}

      {showScopesModal && schedule && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onMouseDown={e => {
            if (e.target === e.currentTarget) setShowScopesModal(false);
          }}
        >
          <div className="card" style={{ width: 'min(980px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Турниры в расписании</div>
              <div style={{ marginLeft: 'auto' }}>
                <button className="btn" onClick={() => setShowScopesModal(false)} disabled={saving}>Закрыть</button>
              </div>
            </div>

            <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 800 }}>Волны</div>
                <button className="btn" disabled={saving} onClick={handleWaveAdd}>Добавить волну</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                {sortedWaves.map((w: any, idx: number) => {
                  const waveId = Number(w?.id);
                  const waveIds = sortedWaves.map(x => Number((x as any)?.id)).filter(Boolean);
                  const startMode = String(w?.start_mode || 'after_previous');
                  const startTime = waveStartTimeTextById.get(waveId) ?? (w?.start_time ? String(w.start_time) : '');
                  const earliestTime = waveEarliestTimeTextById.get(waveId) ?? (w?.earliest_time ? String(w.earliest_time) : '');

                  return (
                    <div key={waveId} style={{ border: '1px solid #f0f0f0', borderRadius: 12, padding: 12, background: '#fcfcfc' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 800 }}>Волна {Number(w?.order ?? (idx + 1)) || (idx + 1)}</div>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button
                            className="btn"
                            disabled={saving || idx === 0}
                            onClick={() => {
                              const ids = waveIds.slice();
                              const i = ids.indexOf(waveId);
                              if (i <= 0) return;
                              const tmp = ids[i - 1];
                              ids[i - 1] = ids[i];
                              ids[i] = tmp;
                              handleWavesReorder(ids);
                            }}
                          >
                            ↑
                          </button>
                          <button
                            className="btn"
                            disabled={saving || idx === sortedWaves.length - 1}
                            onClick={() => {
                              const ids = waveIds.slice();
                              const i = ids.indexOf(waveId);
                              if (i < 0 || i >= ids.length - 1) return;
                              const tmp = ids[i + 1];
                              ids[i + 1] = ids[i];
                              ids[i] = tmp;
                              handleWavesReorder(ids);
                            }}
                          >
                            ↓
                          </button>
                          <button
                            className="btn"
                            disabled={saving || sortedWaves.length <= 1}
                            style={{ background: '#dc3545', borderColor: '#dc3545' }}
                            onClick={() => handleWaveRemove(waveId)}
                          >
                            Удалить
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-end' }}>
                        <div>
                          <div className="text-sm" style={{ marginBottom: 4 }}>Старт волны</div>
                          <select
                            className="input"
                            value={startMode}
                            onChange={e => {
                              const v = e.target.value;
                              if (v === 'fixed') {
                                const next = hhmm(startTime) || '10:00';
                                setWaveStartTimeTextById(prev => {
                                  const m = new Map(prev);
                                  m.set(waveId, next);
                                  return m;
                                });
                                handleWaveUpdate(waveId, { start_mode: 'fixed', start_time: next });
                                return;
                              }
                              handleWaveUpdate(waveId, { start_mode: 'after_previous', start_time: null });
                            }}
                          >
                            <option value="after_previous">После предыдущих</option>
                            <option value="fixed">Фиксированное время</option>
                          </select>
                        </div>

                        {startMode === 'fixed' && (
                          <div>
                            <div className="text-sm" style={{ marginBottom: 4 }}>Время старта</div>
                            <input
                              className="input"
                              value={startTime}
                              placeholder="10:00"
                              onChange={e => {
                                const v = e.target.value;
                                setWaveStartTimeTextById(prev => {
                                  const m = new Map(prev);
                                  m.set(waveId, v);
                                  return m;
                                });
                              }}
                              onBlur={e => {
                                const v = (e.target.value || '').trim();
                                handleWaveUpdate(waveId, { start_mode: 'fixed', start_time: v || null });
                              }}
                            />
                          </div>
                        )}

                        <div>
                          <div className="text-sm" style={{ marginBottom: 4 }}>Не раньше</div>
                          <input
                            className="input"
                            value={earliestTime}
                            placeholder=""
                            onChange={e => {
                              const v = e.target.value;
                              setWaveEarliestTimeTextById(prev => {
                                const m = new Map(prev);
                                m.set(waveId, v);
                                return m;
                              });
                            }}
                            onBlur={e => {
                              const v = (e.target.value || '').trim();
                              handleWaveUpdate(waveId, { earliest_time: v || null });
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
              <div style={{ minWidth: 240 }}>
                <div className="text-sm" style={{ marginBottom: 4 }}>Поиск</div>
                <input
                  className="input"
                  value={availableTournamentQuery}
                  onChange={e => setAvailableTournamentQuery(e.target.value)}
                  placeholder="Название турнира"
                />
              </div>
              <div style={{ flex: 1, minWidth: 280 }}>
                <div className="text-sm" style={{ marginBottom: 4 }}>Добавить турнир</div>
                <select
                  className="input"
                  value={selectedTournamentToAddId ?? ''}
                  onChange={e => {
                    const v = e.target.value;
                    setSelectedTournamentToAddId(v ? Number(v) : null);
                  }}
                >
                  <option value="">{availableTournamentsLoading ? 'Загрузка…' : 'Выберите турнир'}</option>
                  {availableTournaments.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} (#{t.id})
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn" onClick={handleScopeAdd} disabled={saving || !selectedTournamentToAddId || availableTournamentsLoading}>Добавить</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sortedScopes.map((s, idx) => {
                const scopeId = Number((s as any)?.id);
                const tid = Number((s as any)?.tournament);
                const title = scopeTournamentTitleById.get(tid) || `#${tid}`;
                const startMode = String((s as any)?.start_mode || 'after_previous');
                const startTime = scopeStartTimeTextById.get(scopeId) ?? ((s as any)?.start_time ? String((s as any)?.start_time) : '');
                const boundCourts: number[] = Array.isArray((s as any)?.bound_courts) ? (s as any).bound_courts : [];

                const currentWaveId = waveIdByScopeId.get(scopeId) ?? ((s as any)?.wave != null ? Number((s as any)?.wave) : null);

                const scopeIds = sortedScopes.map(x => Number((x as any)?.id)).filter(Boolean);

                return (
                  <div key={scopeId} style={{ border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 800 }}>{title}</div>
                      <div style={{ opacity: 0.7 }}>#{tid}</div>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                          className="btn"
                          disabled={saving || idx === 0}
                          onClick={() => {
                            const ids = scopeIds.slice();
                            const i = ids.indexOf(scopeId);
                            if (i <= 0) return;
                            const tmp = ids[i - 1];
                            ids[i - 1] = ids[i];
                            ids[i] = tmp;
                            handleScopesReorder(ids);
                          }}
                        >
                          ↑
                        </button>
                        <button
                          className="btn"
                          disabled={saving || idx === sortedScopes.length - 1}
                          onClick={() => {
                            const ids = scopeIds.slice();
                            const i = ids.indexOf(scopeId);
                            if (i < 0 || i >= ids.length - 1) return;
                            const tmp = ids[i + 1];
                            ids[i + 1] = ids[i];
                            ids[i] = tmp;
                            handleScopesReorder(ids);
                          }}
                        >
                          ↓
                        </button>
                        <button className="btn" disabled={saving} style={{ background: '#dc3545', borderColor: '#dc3545' }} onClick={() => handleScopeRemove(scopeId)}>
                          Удалить
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-end' }}>
                      <div>
                        <div className="text-sm" style={{ marginBottom: 4 }}>Волна</div>
                        <select
                          className="input"
                          value={currentWaveId ?? ''}
                          onChange={e => {
                            const v = e.target.value;
                            if (!v) return;
                            handleScopeMoveToWave(scopeId, Number(v));
                          }}
                        >
                          {sortedWaves.map((w: any) => (
                            <option key={Number(w?.id)} value={Number(w?.id)}>
                              Волна {Number(w?.order ?? 0) || 1}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <details style={{ marginTop: 10 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Дополнительно</summary>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-end' }}>
                        <div>
                          <div className="text-sm" style={{ marginBottom: 4 }}>Старт (override)</div>
                          <select
                            className="input"
                            value={startMode}
                            onChange={e => {
                              const v = e.target.value;
                              if (v === 'fixed') {
                                const courts = (schedule.courts || []).slice().sort((a, b) => a.index - b.index);
                                const courtDefault = courts.find(c => !!c?.first_start_time)?.first_start_time;
                                const tournamentDefault = tournamentStartTimeById.get(tid);
                                const existingScopeTime = hhmm(scopeStartTimeTextById.get(scopeId) || (s as any)?.start_time);
                                const nextTime =
                                  existingScopeTime ||
                                  hhmm(tournamentDefault) ||
                                  hhmm(courtDefault ? String(courtDefault) : '') ||
                                  hhmm(startTime) ||
                                  '10:00';

                                setScopeStartTimeTextById(prev => {
                                  const m = new Map(prev);
                                  m.set(scopeId, nextTime);
                                  return m;
                                });
                                handleScopeUpdate(scopeId, { start_mode: 'fixed', start_time: hhmm(nextTime) });
                                return;
                              }

                              handleScopeUpdate(scopeId, { start_mode: 'after_previous', start_time: null });
                            }}
                          >
                            <option value="after_previous">После предыдущих</option>
                            <option value="fixed">Фиксированное время</option>
                          </select>
                        </div>

                        {startMode === 'fixed' && (
                          <div>
                            <div className="text-sm" style={{ marginBottom: 4 }}>Время</div>
                            <input
                              className="input"
                              value={startTime}
                              placeholder="10:00"
                              onBlur={e => {
                                const v = (e.target.value || '').trim();
                                handleScopeUpdate(scopeId, { start_mode: 'fixed', start_time: v || null });
                              }}
                              onChange={e => {
                                const v = e.target.value;
                                setScopeStartTimeTextById(prev => {
                                  const m = new Map(prev);
                                  m.set(scopeId, v);
                                  return m;
                                });
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </details>

                    <div style={{ marginTop: 12 }}>
                      <div className="text-sm" style={{ marginBottom: 6, fontWeight: 700 }}>Привязанные корты</div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {(schedule.courts || []).slice().sort((a, b) => a.index - b.index).map(c => {
                          const checked = boundCourts.includes(c.id);
                          return (
                            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                // TODO: Re-enable editing when fixed-court scheduling is fully correct for multi-tournament waves.
                                disabled
                                onChange={e => {
                                  const next = new Set<number>(boundCourts);
                                  if (e.target.checked) next.add(c.id);
                                  else next.delete(c.id);
                                  handleScopeUpdate(scopeId, { bound_courts: Array.from(next) });
                                }}
                              />
                              <span>{c.name || `Корт ${c.index}`}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {!schedule && (
        <div className="card">
          <div style={{ marginBottom: 10, fontWeight: 600 }}>{isDraftMode ? 'Черновик расписания ещё не создан' : 'Расписание ещё не создано'}</div>
          {!canManage ? (
            <div>Создание расписания доступно только организатору/админу.</div>
          ) : (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <div className="text-sm" style={{ marginBottom: 4 }}>Корты</div>
                <input
                  className="input"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={courtsCountText}
                  onChange={e => {
                    const v = e.target.value;
                    setCourtsCountText(v);
                    if (v === '') return;
                    const n = parseInt(v, 10);
                    if (Number.isFinite(n)) setCourtsCount(n);
                  }}
                  onBlur={() => {
                    const raw = courtsCountText;
                    const n = raw === '' ? courtsCount : parseInt(raw, 10);
                    const next = Number.isFinite(n) ? Math.max(1, n) : Math.max(1, courtsCount);
                    setCourtsCount(next);
                    setCourtsCountText(String(next));
                  }}
                />
              </div>
              <div>
                <div className="text-sm" style={{ marginBottom: 4 }}>Длительность матча, мин</div>
                <input
                  className="input"
                  type="number"
                  min={10}
                  step={1}
                  inputMode="numeric"
                  value={matchDurationText}
                  onChange={e => {
                    const v = e.target.value;
                    setMatchDurationText(v);
                    if (v === '') return;
                    const n = parseInt(v, 10);
                    if (Number.isFinite(n)) setMatchDuration(n);
                  }}
                  onBlur={() => {
                    const raw = matchDurationText;
                    const n = raw === '' ? matchDuration : parseInt(raw, 10);
                    const next = Number.isFinite(n) ? Math.max(10, n) : Math.max(10, matchDuration);
                    setMatchDuration(next);
                    setMatchDurationText(String(next));
                  }}
                />
              </div>
              <div>
                <div className="text-sm" style={{ marginBottom: 4 }}>Старт</div>
                <input className="input" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
              </div>
              <button className="btn" disabled={saving} onClick={handleGenerate}>{isDraftMode ? 'Создать черновик' : 'Создать'}</button>
            </div>
          )}
        </div>
      )}

      {schedule && viewMode === 'grid' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isBacklogCollapsed ? '28px 1fr' : '320px 1fr',
            gap: 12,
            alignItems: 'start',
          }}
        >
          {isBacklogCollapsed ? (
            <div
              className="card"
              style={{
                padding: 0,
                width: 28,
                display: 'flex',
                alignItems: 'stretch',
                justifyContent: 'stretch',
              }}
            >
              <button
                className="btn"
                style={{
                  width: 28,
                  padding: 0,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onClick={() => setIsBacklogCollapsed(false)}
                title="Развернуть"
              >
                {'>'}
              </button>
            </div>
          ) : (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                <div style={{ fontWeight: 700 }}>Матчи для назначения</div>
                <button className="btn" onClick={() => setIsBacklogCollapsed(true)} title="Свернуть">{'<'}</button>
              </div>
            <div className="text-sm" style={{ marginBottom: 10, opacity: 0.8 }}>
              Можно перетаскивать мышью в ячейки расписания или назначать кликом.
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => {
                setPickedFromCell(null);
                setSelectedMatchId(null);
              }}>
                Снять выбор
              </button>
              <button className="btn" onClick={handleAutoFill} disabled={!canEdit || saving}>
                Авто
              </button>
              <button className="btn" onClick={handleClearSchedule} disabled={!canEdit || saving}>
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
                  if (!canEdit) return;
                  e.preventDefault();
                  setDragOverUnassigned(true);
                }}
                onDragLeave={() => setDragOverUnassigned(false)}
                onDrop={e => {
                  if (!canEdit) return;
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
                    draggable={canEdit}
                    onDragStart={() => {
                      if (!canEdit) return;
                      startDragFromPool(Number(m.id));
                    }}
                    onDragEnd={() => clearDrag()}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      textAlign: 'left',
                      cursor: canEdit ? 'grab' : 'default',
                      padding: '6px 10px',
                      minHeight: 44,
                      background: isSelected ? '#111827' : undefined,
                      color: isSelected ? '#fff' : undefined,
                    }}
                    onClick={() => {
                      if (!canEdit) return;
                      setPickedFromCell(null);
                      setSelectedMatchId(m.id);
                    }}
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
                  {isDraftMode ? '' : tournamentSystem === 'king'
                    ? (() => {
                        const a = kingTeamPlayerLabels(m?.team_1);
                        const b = kingTeamPlayerLabels(m?.team_2);
                        return `${a.join(' / ')} / ${b.join(' / ')}`;
                      })()
                    : `${m?.team_1?.full_name || m?.team_1?.display_name || 'TBD'} / ${m?.team_2?.full_name || m?.team_2?.display_name || 'TBD'}`}
                </div>
              ))}
            </div>
            </div>
          )}
          <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <div className="text-sm" style={{ marginBottom: 4 }}>Длительность матча, мин</div>
              <input
                className="input"
                type="number"
                min={10}
                step={1}
                inputMode="numeric"
                value={matchDurationText}
                onChange={e => {
                  const v = e.target.value;
                  setMatchDurationText(v);
                  if (v === '') return;
                  const n = parseInt(v, 10);
                  if (Number.isFinite(n)) setMatchDuration(n);
                }}
                onBlur={() => {
                  const raw = matchDurationText;
                  const n = raw === '' ? matchDuration : parseInt(raw, 10);
                  const next = Number.isFinite(n) ? Math.max(10, n) : Math.max(10, matchDuration);
                  setMatchDuration(next);
                  setMatchDurationText(String(next));
                }}
                disabled={!canManage}
              />
            </div>
            <div>
              <div className="text-sm" style={{ marginBottom: 4 }}>Кортов</div>
              <input
                className="input"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={courtsCountText}
                onChange={e => {
                  const v = e.target.value;
                  setCourtsCountText(v);
                  if (v === '') return;
                  const n = parseInt(v, 10);
                  if (Number.isFinite(n)) setCourtsCount(n);
                }}
                onBlur={() => {
                  const raw = courtsCountText;
                  const n = raw === '' ? courtsCount : parseInt(raw, 10);
                  const next = Number.isFinite(n) ? Math.max(1, n) : Math.max(1, courtsCount);
                  setCourtsCount(next);
                  setCourtsCountText(String(next));
                }}
                disabled={!canManage}
              />
            </div>
            <div>
              <div className="text-sm" style={{ marginBottom: 4 }}>Начало</div>
              <input className="input" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} disabled={!canManage} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={handleGenerate} disabled={!canManage || saving}>
                {isDraftMode ? 'Пересоздать черновик' : 'Пересоздать и расставить'}
              </button>
              <>
                <button className="btn" onClick={handleApplySettings} disabled={!canEdit || saving}>
                  Применить настройки
                </button>
                <button className="btn" onClick={handleAddRun} disabled={!canEdit || saving || !schedule}>
                  Добавить запуск
                </button>
              </>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="text-sm">Дата: <strong>{formatIsoDateToRu(schedule.date)}</strong></div>
            </div>
          </div>

          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee', minWidth: 140 }}>Запуск</th>
                {(schedule.courts || []).slice().sort((a, b) => a.index - b.index).map(c => (
                  <th
                    key={c.id}
                    style={{
                      textAlign: 'left',
                      padding: 8,
                      borderBottom: '1px solid #eee',
                      minWidth: 170,
                      verticalAlign: 'top',
                      background: dragOverColumnIndex === c.index ? '#eef2ff' : undefined,
                    }}
                    onDragOver={e => {
                      if (!canEdit) return;
                      if (dragColumnIndex == null) return;
                      e.preventDefault();
                      setDragOverColumnIndex(c.index);
                    }}
                    onDragLeave={() => {
                      setDragOverColumnIndex(prev => (prev === c.index ? null : prev));
                    }}
                    onDrop={e => {
                      if (!canEdit) return;
                      if (dragColumnIndex == null) return;
                      e.preventDefault();
                      const from = dragColumnIndex;
                      const to = c.index;
                      clearDrag();
                      swapColumns(from, to);
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        draggable={canEdit}
                        onDragStart={e => {
                          if (!canEdit) return;
                          setDragColumnIndex(c.index);
                          setDragOverColumnIndex(null);
                          try {
                            e.dataTransfer.setData('text/plain', `col:${c.index}`);
                            e.dataTransfer.effectAllowed = 'move';
                          } catch {
                            // noop
                          }
                        }}
                        onDragEnd={() => clearDrag()}
                        title="Перетащить столбец"
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          border: '1px solid #e5e7eb',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: canEdit ? 'grab' : 'default',
                          userSelect: 'none',
                          fontSize: 12,
                          opacity: 0.85,
                        }}
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        ::
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {editingCourtIndex === c.index && canManage ? (
                          <input
                            className="input"
                            value={c.name || ''}
                            onChange={e => updateCourtName(c.index, e.target.value)}
                            onBlur={() => setEditingCourtIndex(null)}
                            autoFocus
                          />
                        ) : (
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                            onDoubleClick={() => {
                              if (!canManage) return;
                              setEditingCourtIndex(c.index);
                            }}
                          >
                            <div style={{ fontWeight: 600 }}>{c.name}</div>
                            {canManage && (
                              <button
                                type="button"
                                className="btn"
                                style={{ padding: '2px 6px', fontSize: 12 }}
                                onClick={e => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setEditingCourtIndex(c.index);
                                }}
                              >
                                ✎
                              </button>
                            )}
                          </div>
                        )}
                        {c.first_start_time && (
                          <div className="text-sm" style={{ opacity: 0.75 }}>Начало {formatHm(c.first_start_time)}</div>
                        )}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {(schedule.runs || []).slice().sort((a, b) => a.index - b.index).map(r => {
                const plannedTime = planned?.runs?.find(x => x.index === r.index)?.planned_start_time;
                const slotsForRun = (schedule.slots || []).filter(s => s.run === r.id);
                const isEmptyRun = slotsForRun.every(s => {
                  const hasMatch = !!s?.match;
                  const hasText = !!(s?.text_title || s?.text_subtitle || s?.override_title || s?.override_subtitle);
                  return !hasMatch && !hasText;
                });
                const maxRunIndex = Math.max(...(schedule.runs || []).map(x => x.index), 1);
                const canDeleteThisRun = canEdit && isEmptyRun && r.index === maxRunIndex;
                return (
                  <tr key={r.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid #f2f2f2', verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div
                          draggable={canEdit}
                          onDragStart={e => {
                            if (!canEdit) return;
                            setDragRowIndex(r.index);
                            setDragOverRowIndex(null);
                            try {
                              e.dataTransfer.setData('text/plain', `row:${r.index}`);
                              e.dataTransfer.effectAllowed = 'move';
                            } catch {
                              // noop
                            }
                          }}
                          onDragEnd={() => clearDrag()}
                          title="Перетащить строку"
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            border: '1px solid #e5e7eb',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: canEdit ? 'grab' : 'default',
                            userSelect: 'none',
                            fontSize: 12,
                            opacity: 0.85,
                            background: dragOverRowIndex === r.index ? '#eef2ff' : undefined,
                          }}
                          onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          ::
                        </div>
                        <div
                          style={{ fontWeight: 600, background: dragOverRowIndex === r.index ? '#eef2ff' : undefined }}
                          onDragOver={e => {
                            if (!canEdit) return;
                            if (dragRowIndex == null) return;
                            e.preventDefault();
                            setDragOverRowIndex(r.index);
                          }}
                          onDragLeave={() => {
                            setDragOverRowIndex(prev => (prev === r.index ? null : prev));
                          }}
                          onDrop={e => {
                            if (!canEdit) return;
                            if (dragRowIndex == null) return;
                            e.preventDefault();
                            const from = dragRowIndex;
                            const to = r.index;
                            clearDrag();
                            swapRows(from, to);
                          }}
                        >
                          Запуск {r.index}
                        </div>
                        {canDeleteThisRun && (
                          <button
                            type="button"
                            className="btn"
                            onClick={e => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleDeleteRun(r.id);
                            }}
                            disabled={saving}
                          >
                            Удалить
                          </button>
                        )}
                      </div>
                      <div className="text-sm" style={{ opacity: 0.8, marginTop: 4 }}>План: {plannedTime || '—'}</div>
                    </td>
                    {(schedule.courts || []).slice().sort((a, b) => a.index - b.index).map(c => {
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
                            if (!canEdit) return;
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
                            if (!canEdit) return;
                            e.preventDefault();
                            dropOnCell(r.index, c.index);
                          }}
                          onClick={() => {
                            if (!canEdit) return;
                            dropOrPickCell(r.index, c.index);
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <div
                              className="text-sm"
                              style={{ opacity: 0.75, cursor: canManage ? 'pointer' : 'default' }}
                              onClick={e => {
                                if (!canManage) return;
                                e.preventDefault();
                                e.stopPropagation();
                                if (!slot?.id) return;

                                if (editingSlotStartLabel?.slotId === slot.id) {
                                  setEditingSlotStartLabel(null);
                                  return;
                                }

                                const raw = String(slot?.override_subtitle || '').trim();
                                const m = raw.match(/не\s*ранее\s*(\d{2}:\d{2})/i);
                                const mode: 'then' | 'not_earlier' = m ? 'not_earlier' : 'then';
                                const time = m ? String(m[1]) : '';
                                setEditingSlotStartLabel({ slotId: slot.id, mode, time });
                              }}
                            >
                              {slot?.override_subtitle ? slot.override_subtitle : runStartLabel(r.index)}
                            </div>

                            {editingSlotStartLabel?.slotId === slot?.id && canManage && (
                              <div
                                data-export-exclude="true"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  flexWrap: 'wrap',
                                  background: '#fff',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: 8,
                                  padding: 4,
                                }}
                                onClick={e => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                              >
                                {(() => {
                                  const stLocal = editingSlotStartLabel;
                                  if (!stLocal) return null;
                                  return (
                                    <>
                                <select
                                  className="input"
                                  style={{ padding: '4px 8px', fontSize: 12, height: 30 }}
                                  value={stLocal.mode}
                                  onChange={e => {
                                    const mode = e.target.value as 'then' | 'not_earlier';
                                    setEditingSlotStartLabel(prev => (prev ? { ...prev, mode } : prev));
                                  }}
                                >
                                  <option value="then">Затем</option>
                                  <option value="not_earlier">Не ранее</option>
                                </select>

                                {stLocal.mode === 'not_earlier' && (
                                  <input
                                    className="input"
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="HH:MM"
                                    style={{ padding: '4px 8px', fontSize: 12, height: 30, width: 90 }}
                                    value={stLocal.time}
                                    onChange={e => {
                                      const v = normalizeHmInput(e.target.value);
                                      setEditingSlotStartLabel(prev => (prev ? { ...prev, time: v } : prev));
                                    }}
                                    onBlur={e => {
                                      const v = clampHm(e.target.value);
                                      setEditingSlotStartLabel(prev => (prev ? { ...prev, time: v } : prev));
                                    }}
                                  />
                                )}

                                <button
                                  type="button"
                                  className="btn"
                                  title="Применить"
                                  style={{ padding: '4px 8px', fontSize: 12, height: 30, lineHeight: 1 }}
                                  onClick={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const st = editingSlotStartLabel;
                                    if (!st) return;

                                    const t = clampHm(st.time);
                                    const next =
                                      st.mode === 'then'
                                        ? 'Затем'
                                        : t
                                          ? `Не ранее ${t}`
                                          : 'Не ранее';
                                    updateSlotOverrideSubtitle(st.slotId, next);
                                    setEditingSlotStartLabel(null);
                                  }}
                                >
                                  ✓
                                </button>

                                <button
                                  type="button"
                                  className="btn"
                                  title="Сбросить"
                                  style={{ padding: '4px 8px', fontSize: 12, height: 30, lineHeight: 1 }}
                                  onClick={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (!slot?.id) return;
                                    updateSlotOverrideSubtitle(slot.id, null);
                                    setEditingSlotStartLabel(null);
                                  }}
                                >
                                  ↺
                                </button>
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                            <div
                            draggable={canEdit && !!cellMatchId}
                            onDragStart={e => {
                              if (!canEdit) return;
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
                              cursor: canEdit && !!cellMatchId ? 'grab' : 'default',
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
        <div className="card" style={{ overflowX: 'auto', width: '100%' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%' }}>
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

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${timelineData.courts.length}, minmax(180px, 1fr))`,
                gap: 10,
                width: '100%',
              }}
            >
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
                            const live = liveState.get(Number(it.matchId));
                            const merged = live ? { ...m, sets: live.sets ?? m?.sets } : m;
                            const sc = matchScoreLabel(merged);
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

      {showExportDialog && (
        <div
          data-export-exclude="true"
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.35)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
          }}
          onClick={() => {
            if (exporting) return;
            setShowExportDialog(false);
          }}
        >
          <div
            className="card"
            style={{ width: 420, maxWidth: '100%', padding: 14 }}
            onClick={e => {
              e.stopPropagation();
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Экспорт</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="radio"
                  name="export-format"
                  checked={exportFormat === 'pdf'}
                  onChange={() => setExportFormat('pdf')}
                  disabled={exporting}
                />
                PDF
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="radio"
                  name="export-format"
                  checked={exportFormat === 'docx'}
                  onChange={() => setExportFormat('docx')}
                  disabled={exporting}
                />
                DOCX
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="radio"
                  name="export-format"
                  checked={exportFormat === 'xlsx'}
                  onChange={() => setExportFormat('xlsx')}
                  disabled={exporting}
                />
                Excel
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="radio"
                  name="export-format"
                  checked={exportFormat === 'numbers'}
                  onChange={() => setExportFormat('numbers')}
                  disabled={exporting}
                />
                Numbers
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn"
                disabled={exporting}
                onClick={() => setShowExportDialog(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn"
                disabled={exporting}
                onClick={async () => {
                  setShowExportDialog(false);
                  await doExport(exportFormat);
                }}
              >
                Экспорт
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
