import React from 'react';
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
  const handleDragStart = (e: React.DragEvent, participant: DraggableParticipant) => {
    if (participant.isInBracket) {
      e.preventDefault();
      return;
    }
    
    e.dataTransfer.setData('application/json', JSON.stringify(participant));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
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
            className={`participant-item ${participant.isInBracket ? 'in-bracket' : ''} ${!participant.isInBracket ? 'draggable' : ''}`}
            draggable={!participant.isInBracket}
            onDragStart={(e) => handleDragStart(e, participant)}
          >
            <span className="participant-name">{participant.name}</span>
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
