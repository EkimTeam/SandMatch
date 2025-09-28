import React, { useEffect, useRef, useState } from 'react';
import { BracketData } from '../types/bracket';
import { RoundComponent } from './RoundComponent';

export const BracketWithSVGConnectors: React.FC<{
  data: BracketData;
  onMatchClick?: (matchId: number) => void;
  highlightIds?: Set<number>;
}> = ({ data, onMatchClick, highlightIds }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [positions, setPositions] = useState<Map<number, DOMRect>>(new Map());

  // Вычислить позиции карточек матчей после рендера
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      const rectMap = new Map<number, DOMRect>();
      const nodes = el.querySelectorAll('[data-match-id]');
      const base = el.getBoundingClientRect();
      nodes.forEach((n) => {
        const id = Number(n.getAttribute('data-match-id'));
        const r = n.getBoundingClientRect();
        const local = new DOMRect(r.left - base.left + el.scrollLeft, r.top - base.top + el.scrollTop, r.width, r.height);
        rectMap.set(id, local);
      });
      setPositions(rectMap);
    };
    const onScroll = () => requestAnimationFrame(compute);
    requestAnimationFrame(compute);
    window.addEventListener('resize', compute);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('resize', compute);
      el.removeEventListener('scroll', onScroll);
    };
  }, [data.rounds]);

  // Перерисовка SVG линий
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || positions.size === 0) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const path = (d: string, cls = 'bracket-connection') => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', cls);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', '#9ca3af');
      p.setAttribute('stroke-width', '2');
      svg.appendChild(p);
    };

    const getRect = (id: number) => positions.get(id);

    // Вспомогательная функция: id карточки (настоящей или плейсхолдера)
    const cardId = (roundIndex: number, matchIdx: number): number | null => {
      const m = data.rounds[roundIndex]?.matches[matchIdx];
      if (m) return m.id;
      // placeholder id должен совпадать с RoundComponent
      return -1 * (roundIndex * 1000 + matchIdx + 1);
    };

    // Соединения между последовательными раундами (включая плейсхолдеры)
    for (let ri = 0; ri < data.rounds.length; ri++) {
      const round = data.rounds[ri];
      if (round.is_third_place) continue;
      const next = data.rounds[ri + 1];
      if (!next) break;
      // Пользователь просил: для матча за 3-е место линии не рисуем
      if (next.is_third_place) continue;

      const providedNext = next.matches.length;
      const prevCount = round.matches.length || 0;
      const inferredNext = next.is_third_place ? 1 : Math.max(1, Math.floor(prevCount / 2));
      const countNext = Math.max(providedNext, inferredNext);

      for (let k = 0; k < countNext; k++) {
        const src1Id = round.matches[2 * k]?.id;
        const src2Id = round.matches[2 * k + 1]?.id;
        const dstId = cardId(ri + 1, k);
        if (!dstId) continue;
        const dst = getRect(dstId);
        if (!dst) continue;

        const drawConn = (srcId: number | undefined, slot: 'team_1' | 'team_2') => {
          if (!srcId) return;
          const src = getRect(srcId);
          if (!src) return;
          const exitY = slot === 'team_1' ? src.top + src.height * 0.25 : src.top + src.height * 0.75;
          const exitX = src.left + src.width;
          const entryY = slot === 'team_1' ? dst.top + dst.height * 0.25 : dst.top + dst.height * 0.75;
          const entryX = dst.left;
          const midX1 = exitX + Math.max(24, (entryX - exitX) * 0.35);
          path(`M ${exitX} ${exitY} L ${midX1} ${exitY} L ${midX1} ${entryY} L ${entryX} ${entryY}`);
        };
        drawConn(src1Id, 'team_1');
        drawConn(src2Id, 'team_2');
      }
    }

    // Линии к матчу за 3-е место отключены по требованию
  }, [positions, data]);

  return (
    <div ref={containerRef} style={{ position: 'relative', padding: 16, minHeight: 400, overflow: 'auto' }}>
      <svg ref={svgRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }} />
      <div style={{ position: 'relative', display: 'flex', gap: data.visual_config.round_gap, zIndex: 2 }}>
        {(() => {
          const items: JSX.Element[] = [];
          const H = data.visual_config.match_height;
          const G0 = data.visual_config.match_gap;
          // Вычисляем tops для round 0 по формуле: top0[i] = i*H + (i+1)*G0
          const topsByRound: number[][] = [];
          const r0 = data.rounds[0];
          const top0: number[] = r0 ? r0.matches.map((_, i) => i * H + (i + 1) * G0) : [];
          if (r0) topsByRound.push(top0);
          // Для последующих раундов: top_next[k] = (top_prev[2k] + top_prev[2k+1]) / 2
          for (let ri = 1; ri < data.rounds.length; ri++) {
            const prev = topsByRound[ri - 1] || [];
            const provided = data.rounds[ri].matches.length;
            const inferred = data.rounds[ri].is_third_place ? 1 : Math.max(1, Math.floor(prev.length / 2));
            const count = Math.max(provided, inferred);
            const curr: number[] = [];
            for (let k = 0; k < count; k++) {
              const a = prev[2 * k] ?? (k === 0 ? G0 : prev[2 * (k - 1)] + 2 * (H + G0));
              const b = prev[2 * k + 1] ?? (a + H + G0); // если нет второй пары — подстраховка
              curr.push((a + b) / 2);
            }
            topsByRound.push(curr);
          }
          // Теперь отрисуем каждый раунд, прокинув tops и высоту колонки
          data.rounds.forEach((round, idx) => {
            const tops = topsByRound[idx] || [];
            // высота колонки: нижний край последней карточки + нижний отступ G0
            const totalHeight = tops.length
              ? tops[tops.length - 1] + H + G0
              : H + 2 * G0;

            // Определим префикс стадии предыдущего раунда для плейсхолдеров
            const prevName = data.rounds[idx - 1]?.round_name?.toLowerCase() || '';
            const toStageCode = (name: string, prevMatchCount: number): string => {
              if (name.includes('полуфин')) return 'SMF';
              if (name.includes('финал')) return 'F';
              if (name.includes('1/4')) return 'QF';
              if (name.includes('1/8')) return 'R16';
              if (name.includes('1/16')) return 'R32';
              // Fallback: по количеству матчей
              if (prevMatchCount === 2) return 'SMF';
              if (prevMatchCount === 4) return 'QF';
              if (prevMatchCount === 8) return 'R16';
              if (prevMatchCount === 16) return 'R32';
              return 'R';
            };
            const prevCount = idx > 0 ? (topsByRound[idx - 1]?.length || 0) : 0;
            const placeholderPrevCode = round.is_third_place ? 'SMF' : toStageCode(prevName, prevCount);
            const placeholderMode: 'winner' | 'loser' | undefined = round.is_third_place ? 'loser' : (idx > 0 ? 'winner' : undefined);
            items.push(
              <RoundComponent
                key={round.round_index}
                round={round}
                matchWidth={data.visual_config.match_width}
                matchGap={G0}
                onMatchClick={onMatchClick}
                highlightIds={highlightIds}
                tops={tops}
                totalHeight={totalHeight}
                placeholderPrevCode={placeholderPrevCode}
                placeholderMode={placeholderMode}
              />
            );
          });
          return items;
        })()}
      </div>
    </div>
  );
};
