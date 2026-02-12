import React from 'react';

interface IncompleteMatch {
  id: number;
  stage_name: string;
  stage_id: number;
  team1: string;
  team2: string;
  group: number | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  incompleteMatches: IncompleteMatch[];
}

export const IncompleteMatchesModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onConfirm,
  incompleteMatches,
}) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 8,
        padding: 24,
        maxWidth: 600,
        width: '90%',
        maxHeight: '80vh',
        overflow: 'auto',
      }}>
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>Незавершенные матчи</h3>
        
        <p style={{ marginBottom: 16 }}>
          Следующие матчи в турнире и его стадиях запланированы, но до сих пор не завершены:
        </p>

        <div style={{
          maxHeight: 300,
          overflow: 'auto',
          border: '1px solid #e5e7eb',
          borderRadius: 4,
          padding: 12,
          marginBottom: 16,
        }}>
          {incompleteMatches.map((match, idx) => (
            <div
              key={match.id}
              style={{
                padding: '8px 0',
                borderBottom: idx < incompleteMatches.length - 1 ? '1px solid #f3f4f6' : 'none',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                {match.stage_name}
                {match.group !== null && ` • Группа ${match.group}`}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>
                {match.team1} vs {match.team2}
              </div>
            </div>
          ))}
        </div>

        <p style={{ marginBottom: 20, fontWeight: 600 }}>
          Вы всё равно хотите завершить турнир?
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn"
            onClick={onClose}
          >
            Нет
          </button>
          <button
            type="button"
            className="btn"
            onClick={onConfirm}
            style={{ background: '#dc3545', borderColor: '#dc3545' }}
          >
            Да, завершить
          </button>
        </div>
      </div>
    </div>
  );
};
