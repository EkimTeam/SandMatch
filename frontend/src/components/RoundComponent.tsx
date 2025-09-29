import React from 'react';
import { BracketRound } from '../types/bracket';

export const RoundComponent: React.FC<{
  round: BracketRound;
  matchWidth: number;
  matchGap?: number;
  onMatchClick?: (matchId: number) => void;
  highlightIds?: Set<number>;
  // Новый режим: задаём точные координаты по топам
  tops?: number[];
  totalHeight?: number;
  // fallback старых отступов оставляем на случай отсутствия tops
  preSpacer?: number;        // вертикальный отступ перед первым матчем раунда
  betweenSpacer?: number;    // вертикальные отступы между матчами раунда
  // Плейсхолдеры
  placeholderPrevCode?: string; // код стадии предыдущего раунда (например, QF, R16, SMF)
  placeholderMode?: 'winner' | 'loser' | 'seed';
}> = ({ round, matchWidth, onMatchClick, highlightIds, tops, totalHeight, preSpacer = 0, placeholderPrevCode, placeholderMode }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: matchWidth }}>
      <h3 style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{round.round_name}</h3>
      <div style={{ position: 'relative', height: totalHeight ?? 'auto' }}>
        {tops && tops.length > 0 ? (
          Array.from({ length: tops.length }).map((_, idx) => {
            const m = round.matches[idx];
            // Формирование подписей плейсхолдера (всегда, даже если матч существует, но команда пустая)
            const code = placeholderPrevCode || 'R';
            const codeText = code.startsWith('R') ? `${code}_` : code;
            const placeholderTop =
              placeholderMode === 'seed' ? `Игрок ${2 * idx + 1}`
              : placeholderMode === 'winner' ? `Winner of ${codeText}${2 * idx + 1}`
              : placeholderMode === 'loser' ? `Loser of ${codeText}${idx + 1}`
              : '';
            const placeholderBottom =
              placeholderMode === 'seed' ? `Игрок ${2 * idx + 2}`
              : placeholderMode === 'winner' ? `Winner of ${codeText}${2 * idx + 2}`
              : placeholderMode === 'loser' ? `Loser of ${codeText}${idx + 2}`
              : '';
            const team1 = m?.team_1?.name ?? placeholderTop;
            const team2 = m?.team_2?.name ?? placeholderBottom;
            const winnerId = m?.winner_id ?? null;
            const status = m?.status ?? 'scheduled';
            const idAttr = m ? m.id : -1 * (round.round_index * 1000 + idx + 1);
            const isPlaceholder = !m;
            return (
            <div
              key={idAttr}
              data-match-id={String(idAttr)}
              style={{
                position: 'absolute',
                top: tops[idx],
                width: matchWidth,
                border: m && highlightIds?.has(m.id) ? '2px solid #2563eb' : '1px solid #e5e7eb',
                borderRadius: 6,
                padding: 8,
                background: '#fff',
                cursor: 'pointer',
                boxShadow: m && highlightIds?.has(m.id) ? '0 0 0 3px rgba(37,99,235,0.15)' : 'none',
                opacity: isPlaceholder ? 0.85 : 1,
              }}
              onClick={() => m && onMatchClick?.(m.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontWeight: winnerId && m?.team_1?.id === winnerId ? 700 : 400, color: m ? undefined : '#9ca3af' }}>
                  {team1}
                </div>
              </div>
              <div style={{ textAlign: 'center', color: '#6b7280', fontWeight: 600 }}>
                {status === 'completed' ? 'Завершён' : status === 'live' ? 'Идёт' : 'VS'}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <div style={{ fontWeight: winnerId && m?.team_2?.id === winnerId ? 700 : 400, color: m ? undefined : '#9ca3af' }}>
                  {team2}
                </div>
              </div>
            </div>
          )})
        ) : (
          // Fallback на старую модель отступов
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {preSpacer > 0 && (<div style={{ height: preSpacer }} />)}
            {round.matches.map((m) => (
              <div
                key={m.id}
                data-match-id={m.id}
                style={{
                  width: matchWidth,
                  border: highlightIds?.has(m.id) ? '2px solid #2563eb' : '1px solid #e5e7eb',
                  borderRadius: 6,
                  padding: 8,
                  background: '#fff',
                  cursor: 'pointer',
                  boxShadow: highlightIds?.has(m.id) ? '0 0 0 3px rgba(37,99,235,0.15)' : 'none',
                }}
                onClick={() => onMatchClick?.(m.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ fontWeight: m.winner_id && m.team_1?.id === m.winner_id ? 700 : 400 }}>
                    {m.team_1 ? m.team_1.name : <span style={{ color: '#9ca3af' }}>+ Выбрать команду</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'center', color: '#6b7280', fontWeight: 600 }}>
                  {m.status === 'completed' ? 'Завершён' : m.status === 'live' ? 'Идёт' : 'VS'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <div style={{ fontWeight: m.winner_id && m.team_2?.id === m.winner_id ? 700 : 400 }}>
                    {m.team_2 ? m.team_2.name : <span style={{ color: '#9ca3af' }}>+ Выбрать команду</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
