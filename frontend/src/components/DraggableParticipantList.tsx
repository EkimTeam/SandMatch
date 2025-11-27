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
  const [ghostPosition, setGhostPosition] = useState<{ x: number; y: number } | null>(null);

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
    
    // Добавляем класс к body для подсветки drop-зон
    document.body.classList.add('dragging');
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!draggedParticipant) return;
    
    // Предотвращаем скролл страницы при перетаскивании
    e.preventDefault();
    
    // Обновляем позицию ghost элемента
    const touch = e.touches[0];
    setGhostPosition({ x: touch.clientX, y: touch.clientY });
    
    // Подсвечиваем drop-зону под пальцем
    const elementUnderFinger = document.elementFromPoint(touch.clientX, touch.clientY);
    const dropSlot = elementUnderFinger?.closest('[data-drop-slot]') as HTMLElement;
    
    // Убираем подсветку со всех drop-зон
    document.querySelectorAll('[data-drop-slot].hover-highlight').forEach(el => {
      el.classList.remove('hover-highlight');
    });
    
    // Добавляем подсветку к текущей drop-зоне
    if (dropSlot && !dropSlot.querySelector('.participant-name')) {
      dropSlot.classList.add('hover-highlight');
    }
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
    setGhostPosition(null);
    delete (window as any).__draggedParticipant;
    
    // Убираем класс dragging с body
    document.body.classList.remove('dragging');
    
    // Убираем все подсветки drop-зон
    document.querySelectorAll('[data-drop-slot].hover-highlight').forEach(el => {
      el.classList.remove('hover-highlight');
    });
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
      
      {/* Ghost элемент для визуализации перетаскивания */}
      {draggedParticipant && ghostPosition && (
        <div
          className="drag-ghost"
          style={{
            position: 'fixed',
            left: ghostPosition.x,
            top: ghostPosition.y,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            zIndex: 9999,
            padding: '8px 12px',
            background: 'white',
            border: '2px solid #2196f3',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            fontSize: '14px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            opacity: 0.9
          }}
        >
          {draggedParticipant.name}
          {typeof draggedParticipant.currentRating === 'number' && (
            <span style={{ marginLeft: 8, fontSize: 11, color: '#666' }}>
              {draggedParticipant.currentRating} BP
            </span>
          )}
        </div>
      )}
    </div>
  );
};
