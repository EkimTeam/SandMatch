import React from 'react';
import { BracketRound } from '../types/bracket';
import { DropSlot, DraggableParticipant } from '../types/dragdrop';

// Константы цветов для подсветки (синхронизированы с TournamentDetailPage)
const MATCH_COLORS = {
  LIVE: '#e9fbe9',      // Матч в процессе (чуть более насыщенный зеленый)
  WINNER: '#d1fae5',   // Победная ячейка (светло-зеленый)
} as const;

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
  // Drag-and-Drop (только для первого раунда)
  dropSlots?: DropSlot[];
  onDrop?: (matchId: number, slot: 'team_1' | 'team_2', participant: DraggableParticipant) => void;
  onRemoveFromSlot?: (matchId: number, slot: 'team_1' | 'team_2') => void;
  isLocked?: boolean;
  showFullNames?: boolean;
  byePositions?: Set<number>;
}> = ({ round, matchWidth, onMatchClick, highlightIds, tops, totalHeight, preSpacer = 0, placeholderPrevCode, placeholderMode, dropSlots, onDrop, onRemoveFromSlot, isLocked, showFullNames, byePositions }) => {
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
            const idAttr = m ? m.id : -1 * (round.round_index * 1000 + idx + 1);
            const isPlaceholder = !m;
            
            // Drop-зоны только для первого раунда
            const isFirstRound = round.round_index === 0;
            const canDrop = isFirstRound && dropSlots && onDrop && !isLocked;
            
            // Найти участников в слотах для этого матча
            const slot1 = dropSlots?.find(s => s.matchId === (m?.id ?? idAttr) && s.slot === 'team_1');
            const slot2 = dropSlots?.find(s => s.matchId === (m?.id ?? idAttr) && s.slot === 'team_2');
            
            // Проверить, является ли позиция BYE
            const position1 = ((m?.order_in_round || (idx + 1)) - 1) * 2 + 1;
            const position2 = ((m?.order_in_round || (idx + 1)) - 1) * 2 + 2;
            const isBye1 = byePositions?.has(position1);
            const isBye2 = byePositions?.has(position2);
            
            const placeholderTop =
              placeholderMode === 'seed' ? (isBye1 ? 'BYE' : `Игрок ${2 * idx + 1}`)
              : placeholderMode === 'winner' ? `Winner of ${codeText}${2 * idx + 1}`
              : placeholderMode === 'loser' ? `Loser of ${codeText}${idx + 1}`
              : '';
            const placeholderBottom =
              placeholderMode === 'seed' ? (isBye2 ? 'BYE' : `Игрок ${2 * idx + 2}`)
              : placeholderMode === 'winner' ? `Winner of ${codeText}${2 * idx + 2}`
              : placeholderMode === 'loser' ? `Loser of ${codeText}${idx + 2}`
              : '';
            // Если слот пустой и это первый раунд с drag-and-drop, показываем "Свободное место"
            // Используем display_name по умолчанию, full_name при showFullNames
            const getTeamName = (team: any) => {
              if (!team) return null;
              if (showFullNames) {
                return team.full_name || team.name;
              }
              return team.display_name || team.name;
            };

            // В первом раунде, пока участники не зафиксированы в матчах (m.team_1/m.team_2 пусты),
            // отображаем имя/рейтинг из dropSlots.currentParticipant, чтобы игрок был виден сразу.
            const slot1Name = slot1?.currentParticipant?.name || null;
            const slot2Name = slot2?.currentParticipant?.name || null;

            const team1Display = m?.team_1
              ? getTeamName(m.team_1)
              : (isFirstRound && canDrop
                  ? (slot1Name || (isBye1 ? 'BYE' : 'Свободное место'))
                  : placeholderTop);
            const team2Display = m?.team_2
              ? getTeamName(m.team_2)
              : (isFirstRound && canDrop
                  ? (slot2Name || (isBye2 ? 'BYE' : 'Свободное место'))
                  : placeholderBottom);
            
            // Для тултипов всегда используем full_name, а если команды ещё нет — имя из слота
            const team1Tooltip = m?.team_1?.full_name || m?.team_1?.name || slot1Name || undefined;
            const team2Tooltip = m?.team_2?.full_name || m?.team_2?.name || slot2Name || undefined;
            
            const winnerId = m?.winner_id ?? null;
            const status = m?.status ?? 'scheduled';
            
            const handleDragOver = (e: React.DragEvent) => {
              if (canDrop) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }
            };
            
            const handleDrop = (e: React.DragEvent, slot: 'team_1' | 'team_2') => {
              if (!canDrop || !m) return;
              e.preventDefault();
              try {
                const participantData = JSON.parse(e.dataTransfer.getData('application/json'));
                onDrop(m.id, slot, participantData);
              } catch (error) {
                console.error('Error parsing dropped data:', error);
              }
            };
            // Определить фон в зависимости от статуса
            const getBackgroundColor = () => {
              if (!m) return '#fff';
              if (status === 'live') return '#d1fae5'; // светло-зелёный для "идёт"
              if (status === 'completed') return '#f3f4f6'; // светло-серый для завершённых
              return '#fff';
            };
            
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
                background: getBackgroundColor(),
                cursor: 'pointer',
                boxShadow: m && highlightIds?.has(m.id) ? '0 0 0 3px rgba(37,99,235,0.15)' : 'none',
                opacity: isPlaceholder ? 0.85 : 1,
              }}
              onClick={() => m && onMatchClick?.(m.id)}
            >
              <div 
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  marginBottom: 4, 
                  padding: canDrop ? 4 : 0, 
                  border: canDrop && !slot1?.currentParticipant ? '1px dashed #d1d5db' : 'none', 
                  borderRadius: 4, 
                  background: canDrop && !slot1?.currentParticipant ? '#f9fafb' : (winnerId === m?.team_1?.id && status === 'completed' ? MATCH_COLORS.WINNER : 'transparent')
                }}
                onDragOver={canDrop ? handleDragOver : undefined}
                onDrop={canDrop ? (e) => handleDrop(e, 'team_1') : undefined}
              >
                <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                  {isFirstRound && <span style={{ marginRight: 6, color: '#6b7280', fontSize: 12 }}>{idx * 2 + 1}.</span>}
                  <span 
                    style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontWeight: winnerId === m?.team_1?.id ? 600 : 400 }}
                    title={team1Tooltip || undefined}
                  >
                    <span>{team1Display}</span>
                    {typeof (m as any)?.team_1?.rating === 'number' || typeof slot1?.currentParticipant?.currentRating === 'number' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1 }}>
                          {typeof (m as any)?.team_1?.rating === 'number'
                            ? (m as any).team_1.rating
                            : slot1?.currentParticipant?.currentRating}
                        </span>
                        <span style={{ fontSize: 9, lineHeight: 1, opacity: 0.7 }}>BP</span>
                      </span>
                    ) : null}
                  </span>
                </div>
                {canDrop && slot1?.currentParticipant && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFromSlot?.(m!.id, 'team_1');
                    }}
                    style={{ marginLeft: 8, padding: '0 6px', fontSize: 14, border: 'none', background: 'transparent', cursor: 'pointer', color: '#6b7280' }}
                    title="Удалить участника"
                  >
                    ×
                  </button>
                )}
              </div>
              <div style={{ textAlign: 'center', color: '#6b7280', fontWeight: 600 }}>
                {(() => {
                  if (status === 'live') return 'Идёт';
                  if (status === 'completed') {
                    // Проверить, есть ли BYE
                    const hasBye = team1Display === 'BYE' || team2Display === 'BYE';
                    if (hasBye) return ''; // Не показывать текст для матчей с BYE
                    // Показать счёт, если есть
                    if (m?.score) return <span style={{ fontWeight: 700 }}>{m.score}</span>;
                    return 'Завершён';
                  }
                  return 'VS';
                })()}
              </div>
              <div 
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  marginTop: 4, 
                  padding: canDrop ? 4 : 0, 
                  border: canDrop && !slot2?.currentParticipant ? '1px dashed #d1d5db' : 'none', 
                  borderRadius: 4, 
                  background: canDrop && !slot2?.currentParticipant ? '#f9fafb' : (winnerId === m?.team_2?.id && status === 'completed' ? MATCH_COLORS.WINNER : 'transparent')
                }}
                onDragOver={canDrop ? handleDragOver : undefined}
                onDrop={canDrop ? (e) => handleDrop(e, 'team_2') : undefined}
              >
                <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                  {isFirstRound && <span style={{ marginRight: 6, color: '#6b7280', fontSize: 12 }}>{idx * 2 + 2}.</span>}
                  <span 
                    style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontWeight: winnerId && m?.team_2?.id === winnerId ? 700 : 400, color: m ? undefined : '#9ca3af' }}
                    title={team2Tooltip || undefined}
                  >
                    <span>{team2Display}</span>
                    {typeof (m as any)?.team_2?.rating === 'number' || typeof slot2?.currentParticipant?.currentRating === 'number' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1 }}>
                          {typeof (m as any)?.team_2?.rating === 'number'
                            ? (m as any).team_2.rating
                            : slot2?.currentParticipant?.currentRating}
                        </span>
                        <span style={{ fontSize: 9, lineHeight: 1, opacity: 0.7 }}>BP</span>
                      </span>
                    ) : null}
                  </span>
                </div>
                {canDrop && slot2?.currentParticipant && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFromSlot?.(m!.id, 'team_2');
                    }}
                    style={{ marginLeft: 8, padding: '0 6px', fontSize: 14, border: 'none', background: 'transparent', cursor: 'pointer', color: '#6b7280' }}
                    title="Удалить участника"
                  >
                    ×
                  </button>
                )}
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
