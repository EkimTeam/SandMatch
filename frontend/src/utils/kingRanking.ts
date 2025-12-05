import { KingCalculationMode } from '../services/api';

// Compute ranking within a King group according to tournament.ruleset.ordering_priority.
// Supports criteria: 'wins', 'sets_fraction', 'games_ratio', 'games_diff', 'sets_diff', 'name_asc'
// And their head-to-head variants: '<metric>_h2h' or 'head_to_head' (equivalent to 'wins_h2h').
export function computeKingGroupRanking(
  tournament: any,
  groupData: any,
  groupIndex: string | number,
  calculationMode: KingCalculationMode,
  statsByRow?: Record<number, any>,
): Map<number, number> {
  if (!groupData || !groupData.participants) return new Map();

  const scheduleRounds: any[] = groupData.rounds || [];
  // Для King используем матчи из расписания (king_schedule), а не tournament.matches,
  // чтобы ранжирование совпадало с таблицей результатов.
  const allMatches: any[] = scheduleRounds.flatMap((r: any) => r.matches || []);

  // Map playerId -> row_index in this group
  const playerToRow = new Map<number, number>();
  (groupData.participants || []).forEach((pt: any) => {
    const team: any = pt.team || {};
    if (Array.isArray(team.players)) {
      team.players.forEach((pl: any) => { if (pl?.id) playerToRow.set(Number(pl.id), pt.row_index); });
    } else {
      if (team.player_1) playerToRow.set(Number(team.player_1), pt.row_index);
      if (team.player_2) playerToRow.set(Number(team.player_2), pt.row_index);
    }
  });

  const computeStats = (pt: any, subsetRows?: Set<number>, options?: { rawBetween?: boolean }) => {
    // Собираем playerIds через tournament.participants (как в KingPage_old)
    const playerIds = new Set<number>();
    const gi = parseInt(String(groupIndex), 10);
    const entry = (tournament.participants as any[] | undefined)?.find(
      (e: any) => e.group_index === gi && e.row_index === pt.row_index
    );
    const pTeam: any = entry?.team || {};
    if (Array.isArray(pTeam.players)) {
      pTeam.players.forEach((pl: any) => { if (pl?.id) playerIds.add(Number(pl.id)); });
    } else {
      if (pTeam.player_1) playerIds.add(Number(pTeam.player_1));
      if (pTeam.player_2) playerIds.add(Number(pTeam.player_2));
    }

    const myPerRound: Array<number | null> = [];
    const opPerRound: Array<number | null> = [];
    let wins = 0, setsWon = 0, setsLost = 0;

    scheduleRounds.forEach((round: any, rIdx: number) => {
      const sms: any[] = (round.matches || []) as any[];
      const schedMatch = sms.find((sm: any) => sm.team1_players?.some((p: any) => playerIds.has(Number(p.id))) || sm.team2_players?.some((p: any) => playerIds.has(Number(p.id))));
      if (!schedMatch) { myPerRound[rIdx] = null; opPerRound[rIdx] = null; return; }

      if (subsetRows && subsetRows.size > 0) {
        const oppTeam = (schedMatch.team1_players?.some((p: any) => playerIds.has(Number(p.id)))) ? (schedMatch.team2_players || []) : (schedMatch.team1_players || []);
        const oppHasInSubset = (oppTeam || []).some((p: any) => subsetRows.has(playerToRow.get(Number(p.id)) || -1));
        const selfInSubset = subsetRows.has(pt.row_index);
        if (!(selfInSubset && oppHasInSubset)) { myPerRound[rIdx] = null; opPerRound[rIdx] = null; return; }
      }

      const iAmTeam1 = schedMatch.team1_players?.some((p: any) => playerIds.has(Number(p.id)));
      const full = allMatches.find((fm: any) => fm.id === schedMatch.id);
      const sets = (full?.sets || []) as any[];
      if (!sets.length) { myPerRound[rIdx] = null; opPerRound[rIdx] = null; return; }
      const totalSets = sets.length;
      const onlyTB = totalSets === 1 && !!sets[0].is_tiebreak_only;
      let my = 0, op = 0, hadAnySet = false, mSetsMy = 0, mSetsOp = 0;
      sets.forEach((s: any) => {
        const isTBOnly = !!s.is_tiebreak_only;
        const hasTB = s.tb_1 != null || s.tb_2 != null;
        const idx = Number(s.index || 0);
        if (isTBOnly) {
          hadAnySet = true;
          const t1 = Number(s.tb_1 ?? 0), t2 = Number(s.tb_2 ?? 0);
          if (onlyTB) {
            // Матч состоит только из тайбрейка: считаем tb как геймы
            const a = iAmTeam1 ? t1 : t2; const b = iAmTeam1 ? t2 : t1; my += a; op += b;
          } else {
            // Тайбрейк-only как отдельный сет в многоcетовом матче: учитываем как 1:0/0:1
            const a = iAmTeam1 ? (t1 > t2 ? 1 : 0) : (t2 > t1 ? 1 : 0);
            const b = iAmTeam1 ? (t2 > t1 ? 1 : 0) : (t1 > t2 ? 1 : 0);
            my += a; op += b;
          }
          if (t1 > t2) { if (iAmTeam1) mSetsMy += 1; else mSetsOp += 1; } else if (t2 > t1) { if (iAmTeam1) mSetsOp += 1; else mSetsMy += 1; }
        } else if (hasTB && idx === 3) {
          hadAnySet = true;
          const t1 = Number(s.tb_1 ?? 0), t2 = Number(s.tb_2 ?? 0);
          const a = iAmTeam1 ? (t1 > t2 ? 1 : 0) : (t2 > t1 ? 1 : 0);
          const b = iAmTeam1 ? (t2 > t1 ? 1 : 0) : (t1 > t2 ? 1 : 0);
          my += a; op += b; if (a > b) mSetsMy += 1; else if (b > a) mSetsOp += 1;
        } else {
          const g1 = Number(s.games_1 || 0), g2 = Number(s.games_2 || 0);
          if (g1 !== 0 || g2 !== 0) hadAnySet = true;
          const a = iAmTeam1 ? g1 : g2; const b = iAmTeam1 ? g2 : g1; my += a; op += b;
          if (g1 > g2) { if (iAmTeam1) mSetsMy += 1; else mSetsOp += 1; } else if (g2 > g1) { if (iAmTeam1) mSetsOp += 1; else mSetsMy += 1; }
        }
      });
      if (!hadAnySet) { myPerRound[rIdx] = null; opPerRound[rIdx] = null; return; }
      myPerRound[rIdx] = my; opPerRound[rIdx] = op; setsWon += mSetsMy; setsLost += mSetsOp; if (mSetsMy > mSetsOp) wins += 1;
    });

    const indices = myPerRound.map((v, i) => v !== null ? i : -1).filter(i => i !== -1);
    const countsAcross = (groupData.participants || [])
      .filter((pt2: any) => {
        // Если считаем внутри мини-турнира (subsetRows), учитываем только участников из подмножества
        if (subsetRows && subsetRows.size > 0) return subsetRows.has(pt2.row_index);
        return true;
      })
      .map((pt2: any) => {
        const ids = new Set<number>();
        const gi2 = parseInt(String(groupIndex), 10);
        const e2 = (tournament.participants as any[] | undefined)?.find((e: any) => e.group_index === gi2 && e.row_index === pt2.row_index);
        const t2: any = e2?.team || {};
        if (Array.isArray(t2.players)) t2.players.forEach((pl: any) => { if (pl?.id) ids.add(Number(pl.id)); });
        else { if (t2.player_1) ids.add(Number(t2.player_1)); if (t2.player_2) ids.add(Number(t2.player_2)); }
        let c = 0;
        scheduleRounds.forEach((r: any) => {
          const sms = r.matches || [];
          // для subsetRows учитываем только раунды, где соперник тоже в subsetRows
          const has = sms.some((sm: any) => {
            const inT1 = sm.team1_players?.some((p:any)=>ids.has(Number(p.id)));
            const inT2 = sm.team2_players?.some((p:any)=>ids.has(Number(p.id)));
            if (!(inT1 || inT2)) return false;
            if (subsetRows && subsetRows.size > 0) {
              const oppTeam = inT1 ? (sm.team2_players || []) : (sm.team1_players || []);
              const oppHasInSubset = (oppTeam || []).some((p: any) => subsetRows.has(playerToRow.get(Number(p.id)) || -1));
              return oppHasInSubset;
            }
            return true;
          });
          if (has) c++;
        });
        return c;
      });
    const minMatches = Math.min(...countsAcross);
    const maxMatches = Math.max(...countsAcross);

    const rawBetween = !!(options && options.rawBetween);
    const take = rawBetween ? indices : (calculationMode === 'g_minus') ? indices.slice(0, minMatches) : indices;
    const gamesWon = take.reduce((acc, i) => acc + (myPerRound[i] || 0), 0);
    const gamesLost = take.reduce((acc, i) => acc + (opPerRound[i] || 0), 0);
    let gamesRatio = (gamesWon + gamesLost) > 0 ? gamesWon / (gamesWon + gamesLost) : 0;
    let setsRatioValue = (setsWon + setsLost) > 0 ? setsWon / (setsWon + setsLost) : 0;

    if (calculationMode === 'm_plus' && !rawBetween) {
      const played = indices.length;
      const avg = played > 0 ? Math.round(gamesWon / played) : 0;
      const add = Math.max(0, maxMatches - played) * avg;
      const gamesWonAdj = gamesWon + add;
      // Для M+: сравнение по "соот." осуществляется по абсолютам
      return { wins, setsWon, setsLost, gamesWon: gamesWonAdj, gamesLost, gamesRatio: gamesWonAdj, setsRatioValue: setsWon };
    }
    return { wins, setsWon, setsLost, gamesWon, gamesLost, gamesRatio, setsRatioValue };
  };

  const ruleset = (tournament as any)?.ruleset || {};
  const ordering: string[] = Array.isArray(ruleset.ordering_priority)
    ? [...ruleset.ordering_priority]
    : ['wins','sets_fraction','games_ratio','name_asc'];
  if (!ordering.includes('name_asc')) ordering.push('name_asc');

  const items = (groupData.participants || []).map((pt: any) => {
    const rowIndex = Number(pt.row_index);
    let base;
    if (statsByRow && rowIndex in statsByRow) {
      const s = statsByRow[rowIndex] as any;
      const suffix = calculationMode === 'g_minus' ? '_g' : calculationMode === 'm_plus' ? '_m' : '';
      const winsKey = `wins${suffix}`;
      const setsWonKey = `sets_won${suffix}`;
      const setsLostKey = `sets_lost${suffix}`;
      const gamesWonKey = `games_won${suffix}`;
      const gamesLostKey = `games_lost${suffix}`;
      const gamesRatioKey = `games_ratio${suffix}`;
      const setsRatioKey = `sets_ratio_value${suffix}`;

      base = {
        wins: Number(s[winsKey] ?? 0),
        setsWon: Number(s[setsWonKey] ?? 0),
        setsLost: Number(s[setsLostKey] ?? 0),
        gamesWon: Number(s[gamesWonKey] ?? 0),
        gamesLost: Number(s[gamesLostKey] ?? 0),
        gamesRatio: Number(s[gamesRatioKey] ?? 0),
        setsRatioValue: Number(s[setsRatioKey] ?? 0),
      };
    } else {
      // Fallback: пересчёт базовых статов на фронтенде (как раньше)
      base = computeStats(pt);
    }
    return { pt, base };
  });

  const compareWithCriteria = (a: any, b: any, subset?: Set<number>): number => {
    const getVal = (obj: any, key: string) => {
      // Базовые синонимы
      if (key === 'wins') return obj.wins;
      if (key === 'sets_fraction' || key === 'sets_ratio' || key === 'sets_ratio_all') {
        if (typeof obj.setsRatioValue === 'number') return obj.setsRatioValue;
        const d = obj.setsWon + obj.setsLost; return d > 0 ? obj.setsWon / d : 0;
      }
      if (key === 'games_ratio' || key === 'games_ratio_all') return obj.gamesRatio;
      if (key === 'games_diff') return obj.gamesWon - obj.gamesLost;
      if (key === 'sets_diff') return obj.setsWon - obj.setsLost;
      return 0;
    };
    for (const ruleRaw of ordering) {
      const rule = String(ruleRaw);
      // Личные встречи
      if (rule === 'h2' || rule.endsWith('_h2h') || rule === 'head_to_head') {
        const tiedRows = subset ?? new Set<number>([a.pt.row_index, b.pt.row_index]);
        const sa = computeStats(a.pt, tiedRows, { rawBetween: true });
        const sb = computeStats(b.pt, tiedRows, { rawBetween: true });
        const key = 'wins';
        const va = getVal(sa, key);
        const vb = getVal(sb, key);
        if (va !== vb) return vb - va;
        continue;
      }
      // Между собой: *_between
      if (rule === 'sets_ratio_between' || rule === 'games_ratio_between') {
        const tiedRows = subset ?? new Set<number>([a.pt.row_index, b.pt.row_index]);
        const sa = computeStats(a.pt, tiedRows, { rawBetween: true });
        const sb = computeStats(b.pt, tiedRows, { rawBetween: true });
        const key = rule.startsWith('sets_') ? 'sets_ratio' : 'games_ratio';
        const va = getVal(sa, key);
        const vb = getVal(sb, key);
        if (va !== vb) return vb - va;
        continue;
      }
      const va = getVal(a.base, rule);
      const vb = getVal(b.base, rule);
      if (va !== vb) return vb - va;
      if (rule === 'name_asc') {
        const an = a.pt.display_name || a.pt.name || '';
        const bn = b.pt.display_name || b.pt.name || '';
        const cmp = an.localeCompare(bn, 'ru');
        if (cmp !== 0) return cmp;
      }
    }
    return 0;
  };

  items.sort((a: any, b: any)=>compareWithCriteria(a,b));
  const rankMap = new Map<number, number>();
  let curRank = 1;
  for (let i=0;i<items.length;i++){
    if (i>0 && compareWithCriteria(items[i-1], items[i]) !== 0) {
      curRank = i+1;
    }
    // Use row_index as a stable key within the group
    rankMap.set(Number(items[i].pt.row_index), curRank);
  }

  return rankMap;
}
