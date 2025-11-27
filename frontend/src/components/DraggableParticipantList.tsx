import React, { useState } from 'react';
import { DraggableParticipant } from '../types/dragdrop';

interface Props {
  participants: DraggableParticipant[];
  onRemoveParticipant: (id: number) => void;
  onAddParticipant: () => void;
  onAutoSeed: () => void;
  maxParticipants: number;
  canAddMore: boolean;
}

export const DraggableParticipantList: React.FC<Props> = ({
  participants,
  onRemoveParticipant,
  onAddParticipant,
  onAutoSeed,
  maxParticipants,
  canAddMore
}) => {
  const [draggedParticipant, setDraggedParticipant] = useState<DraggableParticipant | null>(null);
  const [touchStartY, setTouchStartY] = useState<number>(0);

  const handleDragStart = (e: React.DragEvent, participant: DraggableParticipant) => {
    if (participant.isInBracket) {
      e.preventDefault();
      return;
    }
    
    e.dataTransfer.setData('application/json', JSON.stringify(participant));
    e.dataTransfer.effectAllowed = 'move';
    setDraggedParticipant(participant);
  };

  const handleDragEnd = () => {
    setDraggedParticipant(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Touch events для мобильных устройств
  const handleTouchStart = (e: React.TouchEvent, participant: DraggableParticipant) => {
    if (participant.isInBracket) {
      return;
    }
    
    setDraggedParticipant(participant);
    setTouchStartY(e.touches[0].clientY);
    
    // Добавляем данные в глобальный объект для передачи между компонентами
    (window as any).__draggedParticipant = participant;
    
    // Визуальная обратная связь
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '0.5';
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!draggedParticipant) return;
    
    // Предотвращаем скролл страницы при перетаскивании
    e.preventDefault();
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!draggedParticipant) return;
    
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '1';
    
    const touch = e.changedTouches[0];
    const dropTarget = document.elementFromPoint(touch.clientX, touch.clientY);
    
    // Ищем ближайший drop-slot
    const dropSlot = dropTarget?.closest('[data-drop-slot]') as HTMLElement;
    
    if (dropSlot) {
      const matchId = parseInt(dropSlot.dataset.matchId || '0');
      const slot = dropSlot.dataset.slot as 'team_1' | 'team_2';
      
      // Триггерим событие drop через custom event
      const dropEvent = new CustomEvent('participant-drop', {
        detail: { matchId, slot, participant: draggedParticipant }
      });
      dropSlot.dispatchEvent(dropEvent);
    }
    
    setDraggedParticipant(null);
    delete (window as any).__draggedParticipant;
  };

  return (
    <div className="participant-list-container">
      <div className="participant-list-header">
        <h3>Участники ({participants.length}/{maxParticipants})</h3>
        <div className="participant-actions">
          <button 
            className="btn btn-primary btn-sm"
            onClick={onAddParticipant}
            disabled={!canAddMore}
            title={!canAddMore ? 'Достигнуто максимальное количество участников' : ''}
          >
            + Добавить участника
          </button>
          <button 
            className="btn btn-outline btn-sm"
            onClick={onAutoSeed}
          >
            Автопосев
          </button>
        </div>
      </div>
      
      <div 
        className="participant-list"
        onDragOver={handleDragOver}
      >
        {participants.map(participant => (
          <div
            key={participant.id}
            className={`participant-item ${participant.isInBracket ? 'in-bracket' : ''} ${!participant.isInBracket ? 'draggable' : ''} ${draggedParticipant?.id === participant.id ? 'dragging' : ''}`}
            draggable={!participant.isInBracket}
            onDragStart={(e) => handleDragStart(e, participant)}
            onDragEnd={handleDragEnd}
            onTouchStart={(e) => handleTouchStart(e, participant)}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <span className="participant-name" style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span>{participant.name}</span>
              {typeof participant.currentRating === 'number' && (
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1 }}>{participant.currentRating}</span>
                  <span style={{ fontSize: 9, lineHeight: 1, opacity: 0.7 }}>BP</span>
                </span>
              )}
            </span>
            <div className="participant-actions">
              {participant.isInBracket ? (
                <span className="in-bracket-badge">В сетке</span>
              ) : (
                <button
                  className="btn-remove"
                  onClick={() => onRemoveParticipant(participant.id)}
                  title="Удалить из списка"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
        
        {participants.length === 0 && (
          <div className="empty-state">
            Добавьте участников для заполнения сетки
          </div>
        )}
        
        {!canAddMore && participants.length > 0 && (
          <div className="info-message">
            Достигнуто максимальное количество участников
          </div>
        )}
      </div>
    </div>
  );
};
