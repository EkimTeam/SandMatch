import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatDate } from '../services/date';
import { ParticipantPickerModal } from '../components/ParticipantPickerModal';
import api, { tournamentApi, matchApi } from '../services/api';
import { MatchScoreModal } from '../components/MatchScoreModal';
import FreeFormatScoreModal from '../components/FreeFormatScoreModal';

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
  date: string;
  system: string;
  participant_mode: string;
  groups_count: number;
  get_system_display: string;
  get_participant_mode_display: string;
  status: string;
  participants: Participant[];
  planned_participants?: number | null;
  matches?: MatchDTO[];
};

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [t, setT] = useState<TournamentDetail | null>(null);
  const [lockParticipants, setLockParticipants] = useState(false);
  const [showTech, setShowTech] = useState<boolean[]>([]); // по группам
  const [showFullName, setShowFullName] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<null | { group: number; row: number }>(null);
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
  // Данные групп с бэкенда: { [group_index]: { stats: { [team_id]: {...} }, placements: { [team_id]: place } } }
  const [groupStats, setGroupStats] = useState<Record<number, { stats: Record<number, { wins: number; sets_won: number; sets_lost: number; sets_drawn?: number; games_won: number; games_lost: number }>; placements: Record<number, number> }>>({});
  const exportRef = useRef<HTMLDivElement | null>(null);

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
      const resp = await fetch(`/api/tournaments/${id}/group_stats/`);
      if (resp.ok) {
        const data = await resp.json();
        setGroupStats(data?.groups || {});
      }
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

  const reload = async () => {
    try {
      const resp = await fetch(`/api/tournaments/${id}/`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setT(data);
      setShowTech(Array.from({ length: data.groups_count || 1 }).map(() => false));
      // Определить состояние фиксации на основе статуса турнира
      if (data.status === 'active') {
        setLockParticipants(true);
      }
    } catch (e) {
      console.error('Ошибка загрузки турнира:', e);
    } finally {
      setLoading(false);
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
    const m = (t.matches || []).find((mm: any) => mm.stage === 'group' && mm.group_index === g.idx &&
      ((mm.team_1?.id === aId && mm.team_2?.id === bId) || (mm.team_1?.id === bId && mm.team_2?.id === aId)));
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
    const aIsWinner = isWinnerCell;
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
    g: { idx: number; entries: (Participant | null)[]; cols: number[] },
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
      const m = (t.matches || []).find((mm: any) => mm.stage === 'group' && mm.group_index === g.idx &&
        ((mm.team_1?.id === aId && mm.team_2?.id === bId) || (mm.team_1?.id === bId && mm.team_2?.id === aId)));
      if (!m) return '';
      const sets: any[] = (m as any).sets || [];
      // Для live: если счёт уже есть — показываем счёт, иначе «идет»
      if (m.status === 'live' && sets.length === 0) {
        return 'идет';
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
        if (m.status === 'live') {
          const liveDot = (
            <span style={{ display: 'inline-block', width: '0.6em', height: '0.6em', background: '#dc3545', borderRadius: '50%', marginRight: 6, verticalAlign: 'middle' }} />
          );
          return <span style={{ fontWeight: 700 }}>{liveDot}счет error</span>;
        }
        
        // Ничья - показываем счет как есть (для свободного формата)
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
        
        return <span style={{ fontWeight: 700 }}>{scoreStr}</span>;
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
        
        return <span style={{ fontWeight: 700 }}>{scoreStr}</span>;
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
      if (m.status === 'live') {
        const liveDot = (
          <span style={{ display: 'inline-block', width: '0.6em', height: '0.6em', background: '#dc3545', borderRadius: '50%', marginRight: 6, verticalAlign: 'middle' }} />
        );
        return <span>{liveDot}{content}</span>;
      }
      return content;
    } catch (e) {
      return '';
    }
  };

  useEffect(() => {
    (async () => {
      await reload();
      // Подгружаем агрегаты групп после первичной загрузки турнира
      await refreshGroupStats();
    })();
  }, [id]);

  // Загрузка расписания только один раз при открытии страницы турнира
  useEffect(() => {
    (async () => {
      if (!id || scheduleLoaded) return;
      try {
        const resp = await fetch(`/api/tournaments/${id}/group_schedule/`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (data && data.ok && data.groups) {
          const norm: Record<number, [number, number][][]> = {};
          Object.keys(data.groups).forEach(k => {
            const gi = Number(k);
            const tours = (data.groups[k] || []) as number[][];
            norm[gi] = (tours as unknown as [number, number][][]);
          });
          setSchedule(norm);
        }
      } catch (e) {
        console.error('Ошибка загрузки расписания групп:', e);
      } finally {
        setScheduleLoaded(true);
      }
    })();
  }, [id, scheduleLoaded]);

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

  const toggleTech = (gi: number) => {
    setShowTech((prev) => prev.map((v, i) => (i === gi ? !v : v)));
  };

  const handleCellClick = (type: 'participant' | 'score', groupIdx: number, rowIdx: number, colIdx?: number) => {
    // Блокировка для завершённых турниров
    if (t?.status === 'completed') return;
    
    if (type === 'participant') {
      setPickerOpen({ group: groupIdx, row: rowIdx });
    } else {
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
      const isLive = m?.status === 'live';
      const matchTeam1Id = (m as any)?.team_1?.id ?? (m as any)?.team_1_id ?? null;
      const matchTeam2Id = (m as any)?.team_2?.id ?? (m as any)?.team_2_id ?? null;
      setScoreDialog({ group: groupIdx, a: rowIdx, b: colIdx, matchId: m?.id, isLive, matchTeam1Id, matchTeam2Id });
    }
  };

  const startMatch = async () => {
    // Блокировка для завершённых турниров
    if (t?.status === 'completed') return;
    
    if (!t || !scoreDialog?.matchId) return;
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

  const completeTournament = async () => {
    if (!t) return;
    setSaving(true);
    try {
      await api.post(`/tournaments/${t.id}/complete/`);
      {
        // Перезагрузим страницу
        const upd = { ...t, status: 'completed' as const };
        setT(upd);
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteTournament = async () => {
    if (!t) return;
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

  if (loading || !t) {
    return (
      <div>
        <h1 className="text-2xl font-bold mt-0 mb-6">Турнир #{id}</h1>
        <div className="card text-center py-8">Загрузка данных турнира...</div>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{t.name} — {formatDate(t.date)}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="meta">{t.get_system_display} • {t.get_participant_mode_display} • Групп: {t.groups_count}</div>
        </div>
      </div>


      {groups.length === 0 && (
        <div className="card">Пока нет параметров для отображения таблиц. Вернитесь и укажите количество участников и групп.</div>
      )}

      {/* Экспортируемая область (без туров и без нижней панели) */}
      <div ref={exportRef}>
        {/* Шапка для выгрузки с логотипом */}
        <div style={{ position: 'relative', padding: '24px 24px 12px 24px', borderBottom: '1px solid #eee', background: '#fff' }}>
          <img src="/static/img/logo.png" alt="BeachPlay" style={{ position: 'absolute', right: 24, top: 24, height: 48 }} />
          <div style={{ fontSize: 28, fontWeight: 700 }}>{t.name}</div>
          <div style={{ fontSize: 16, color: '#666' }}>{formatDate(t.date)} • {t.get_system_display} • {t.get_participant_mode_display}</div>
        </div>
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
              <strong>{scoreDialog.isLive ? 'Матч идёт' : 'Матч не начат'}</strong>
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
              {!scoreDialog.isLive ? (
                <>
                  <button
                    onClick={startMatch}
                    style={{ padding: '8px 12px', borderRadius: 6, background: '#28a745', color: '#fff', border: '1px solid #28a745', cursor: 'pointer' }}
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
                      
                      // Найти матч и получить существующие сеты
                      const match = t?.matches?.find(m => m.id === scoreDialog.matchId);
                      let existingSets = match?.sets || [];
                      
                      // Для свободного формата: если порядок команд в UI не совпадает с порядком в матче, переворачиваем сеты
                      const isFreeFormat = (t as any)?.set_format?.games_to === 0;
                      if (isFreeFormat && existingSets.length > 0) {
                        const matchTeam1Id = scoreDialog.matchTeam1Id;
                        const uiTeam1Id = aTeam.id;
                        if (matchTeam1Id && uiTeam1Id && matchTeam1Id !== uiTeam1Id) {
                          // Порядок не совпадает - переворачиваем сеты для отображения
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
                      setScoreDialog(null); // Закрываем диалог действий, чтобы не перекрывал модалку счета
                    }}
                    className="btn btn-primary"
                  >
                    Ввести счёт
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={cancelMatch}
                    style={{ padding: '8px 12px', borderRadius: 6, background: '#dc3545', color: '#fff', border: '1px solid #dc3545', cursor: 'pointer' }}
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
                      
                      // Найти матч и получить существующие сеты
                      const match = t?.matches?.find(m => m.id === scoreDialog.matchId);
                      const existingSets = match?.sets || [];
                      
                      setScoreInput({
                        matchId: scoreDialog.matchId!,
                        team1: { id: aTeam.id, name: fmt(aTeam) },
                        team2: { id: bTeam.id, name: fmt(bTeam) },
                        existingSets: existingSets,
                      });
                      setScoreDialog(null);
                    }}
                    style={{ padding: '8px 12px', borderRadius: 6, background: '#f8f9fa', color: '#111', border: '1px solid #dcdcdc', cursor: 'pointer' }}
                  >
                    Ввести счёт
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {groups.map((g, gi) => (
        <div key={g.idx} style={{ marginBottom: 22 }}>
          <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <strong>Группа {g.idx}</strong>
            <button data-export-exclude="true" className={`toggle ${showTech[gi] ? 'active' : ''}`} onClick={() => toggleTech(gi)}>
              Победы/Сеты/Сеты соот./Геймы соот.
            </button>
            <button data-export-exclude="true" className={`toggle ${showFullName ? 'active' : ''}`} onClick={() => setShowFullName(v => !v)}>
              ФИО показать
            </button>
            {gi === 0 && (
              <div style={{ marginLeft: 'auto' }} data-export-exclude="true">
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={effectiveLocked}
                    disabled={lockDisabled}
                    onChange={async (e) => {
                      const next = e.target.checked;
                      if (next) {
                        try {
                          setSaving(true);
                          await tournamentApi.lockParticipants(t.id);
                          setLockParticipants(true);
                          await reload();
                        } catch (error) {
                          console.error('Failed to lock participants:', error);
                          alert('Не удалось зафиксировать участников');
                        } finally {
                          setSaving(false);
                        }
                      } else {
                        // Снятие фиксации - вызываем API для изменения статуса турнира
                        try {
                          setSaving(true);
                          await tournamentApi.unlockParticipants(t.id);
                          setLockParticipants(false);
                          await reload();
                        } catch (error) {
                          console.error('Failed to unlock participants:', error);
                          alert('Не удалось снять фиксацию участников');
                        } finally {
                          setSaving(false);
                        }
                      }
                    }}
                  />
                  <span>Зафиксировать участников</span>
                </label>
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
                  <th className={showTech[gi] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 80 }}>Победы</th>
                  <th className={showTech[gi] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Сеты</th>
                  <th className={showTech[gi] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Сеты<br />соот.</th>
                  <th style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Геймы</th>
                  <th className={showTech[gi] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', width: 60 }}>Геймы<br />соот.</th>
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
                      onClick={() => !effectiveLocked && !completed && handleCellClick('participant', g.idx, rIdx)}
                      title={g.entries[rI]?.team?.full_name || g.entries[rI]?.team?.display_name || g.entries[rI]?.team?.name || ''}
                    >
                      {showFullName
                        ? (g.entries[rI]?.team?.full_name || '—')
                        : (g.entries[rI]?.team?.display_name || g.entries[rI]?.team?.name || '—')}
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
                              // Зелёная подсветка, если матч LIVE
                              const aId = g.entries[rI]?.team?.id;
                              const bId = g.entries[cIdx - 1]?.team?.id;
                              const m = (t.matches || []).find((mm: any) => mm.stage === 'group' && mm.group_index === g.idx &&
                                ((mm.team_1?.id === aId && mm.team_2?.id === bId) || (mm.team_1?.id === bId && mm.team_2?.id === aId)));
                              return m?.status === 'live' ? '#e9fbe9' : 'transparent';
                            })()
                          }}
                          onClick={() => effectiveLocked && !completed && handleCellClick('score', g.idx, rIdx, cIdx)}
                        >
                          {renderScoreCell(g, rIdx, cIdx, rI)}
                        </td>
                      )
                    ))}
                    <td className={showTech[gi] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{stats.wins}</td>
                    <td className={showTech[gi] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{stats.sets}</td>
                    <td className={showTech[gi] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{stats.setsRatio}</td>
                    <td style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{stats.games}</td>
                    <td className={showTech[gi] ? '' : 'hidden-col'} style={{ border: '1px solid #e7e7ea', padding: '6px 8px', textAlign: 'center' }}>{stats.gamesRatio}</td>
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
                  <div key={ti}>Тур {ti + 1}: {tour.map((pair: [number, number]) => `${pair[0]}–${pair[1]}`).join(', ')}</div>
                ))}
              </div>
            ) : (
              <div className="text-gray-500">Нет данных о расписании</div>
            )}
          </div>
        </div>
      ))}
        {/* Нижний DOM-футер для экспорта: скрыт на странице, показывается только при экспортe */}
        <div data-export-only="true" style={{ padding: '12px 24px 20px 24px', borderTop: '1px solid #eee', display: 'none', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 14 }}>BeachPlay</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>скоро онлайн</div>
          {/* TODO: как появиться сайт вставить сюда URL */}
        </div>
      </div>

      {/* Модалка выбора участника */}
      {pickerOpen && (
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

      {/* Нижняя панель действий (в выгрузку не включаем) */}
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
