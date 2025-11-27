import React, { useEffect } from 'react';
import { DraggableParticipant } from '../types/dragdrop';

export interface SimplifiedDropSlot {
  groupIndex: number;
  rowIndex: number;
  currentParticipant: DraggableParticipant | null;
}

interface SimplifiedGroupTableProps {
  groupIndex: number;
  groupName: string;
  plannedParticipants: number;
  dropSlots: SimplifiedDropSlot[];
  onDrop: (groupIndex: number, rowIndex: number, participant: DraggableParticipant) => void;
  onRemove: (groupIndex: number, rowIndex: number) => void;
  isLocked: boolean;
  showFullName?: boolean;
}

export const SimplifiedGroupTable: React.FC<SimplifiedGroupTableProps> = ({
  groupIndex,
  groupName,
  plannedParticipants,
  dropSlots,
  onDrop,
  onRemove,
  isLocked,
  showFullName = false
}) => {
  const handleDragOver = (e: React.DragEvent) => {
    if (!isLocked) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDrop = (e: React.DragEvent, rowIndex: number) => {
    if (isLocked) return;
    e.preventDefault();
    
    try {
      const participantData = JSON.parse(e.dataTransfer.getData('application/json'));
      onDrop(groupIndex, rowIndex, participantData);
    } catch (error) {
      console.error('Error parsing dropped data:', error);
    }
  };

  // Touch events для мобильных устройств
  const handleTouchDrop = (e: Event, rowIndex: number) => {
    if (isLocked) return;
    const customEvent = e as CustomEvent;
    const { participant } = customEvent.detail;
    if (participant) {
      onDrop(groupIndex, rowIndex, participant);
    }
  };

  // Подписка на custom events для touch
  useEffect(() => {
    if (isLocked) return;

    const handlers: Array<{ element: Element; handler: (e: Event) => void }> = [];

    for (let i = 0; i < plannedParticipants; i++) {
      const element = document.querySelector(
        `[data-drop-slot="true"][data-group-index="${groupIndex}"][data-row-index="${i}"]`
      );
      
      if (element) {
        const handler = (e: Event) => handleTouchDrop(e, i);
        element.addEventListener('participant-drop', handler);
        handlers.push({ element, handler });
      }
    }

    return () => {
      handlers.forEach(({ element, handler }) => {
        element.removeEventListener('participant-drop', handler);
      });
    };
  }, [isLocked, plannedParticipants, groupIndex]);

  return (
    <div className="simplified-group-table">
      <h3>{groupName}</h3>
      <table>
        <thead>
          <tr>
            <th style={{ width: '50px', textAlign: 'center' }}>#</th>
            <th>ФИО</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: plannedParticipants }, (_, i) => {
            const slot = dropSlots.find(s => s.groupIndex === groupIndex && s.rowIndex === i);
            const isEmpty = !slot?.currentParticipant;
            
            return (
              <tr key={i}>
                <td style={{ textAlign: 'center', color: '#6c757d', fontWeight: 600 }}>
                  {i + 1}
                </td>
                <td
                  data-drop-slot={!isLocked ? 'true' : undefined}
                  data-group-index={!isLocked ? groupIndex : undefined}
                  data-row-index={!isLocked ? i : undefined}
                  className={`drop-cell ${isEmpty ? 'empty' : 'filled'} ${isLocked ? 'locked' : ''}`}
                  onDragOver={!isLocked ? handleDragOver : undefined}
                  onDrop={!isLocked ? (e) => handleDrop(e, i) : undefined}
                  style={{
                    padding: '12px',
                    minHeight: '48px',
                    cursor: isLocked ? 'default' : 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {slot?.currentParticipant ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span>{showFullName && slot.currentParticipant.fullName 
                          ? slot.currentParticipant.fullName 
                          : slot.currentParticipant.name}
                        </span>
                        {typeof slot.currentParticipant.currentRating === 'number' && (
                          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1 }}>
                              {slot.currentParticipant.currentRating}
                            </span>
                            <span style={{ fontSize: 9, lineHeight: 1, opacity: 0.7 }}>BP</span>
                          </span>
                        )}
                      </span>
                      {!isLocked && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemove(groupIndex, i);
                          }}
                          style={{
                            marginLeft: 8,
                            padding: '0 6px',
                            fontSize: 18,
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            color: '#6c757d'
                          }}
                          title="Удалить участника"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="placeholder">
                      {isLocked ? '—' : 'Перетащите участника'}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
