import React from 'react';

interface MatchActionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  matchStatus: 'scheduled' | 'live' | 'completed';
  onStartMatch: () => void;
  onCancelMatch: () => void;
  onEnterScore: () => void;
  matchTitle?: string;
}

export const MatchActionDialog: React.FC<MatchActionDialogProps> = ({
  isOpen,
  onClose,
  matchStatus,
  onStartMatch,
  onCancelMatch,
  onEnterScore,
  matchTitle,
}) => {
  if (!isOpen) return null;

  const getTitle = () => {
    if (matchStatus === 'scheduled') return 'Матч не начат';
    if (matchStatus === 'live') return 'Матч идёт';
    if (matchStatus === 'completed') return 'Матч завершён';
    return 'Действия с матчем';
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: 8,
          padding: 0,
          minWidth: 380,
          maxWidth: 450,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Заголовок */}
        <div style={{ 
          padding: '16px 20px', 
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {getTitle()}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: '#6b7280',
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Подзаголовок с названиями команд */}
        {matchTitle && (
          <div style={{ 
            padding: '12px 20px', 
            backgroundColor: '#f9fafb',
            color: '#374151',
            fontSize: 14,
          }}>
            {matchTitle}
          </div>
        )}

        {/* Кнопки действий */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {matchStatus === 'scheduled' && (
            <>
              <button
                onClick={() => {
                  onStartMatch();
                  onClose();
                }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 15,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Начать матч
              </button>
              <button
                onClick={() => {
                  onEnterScore();
                  onClose();
                }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  backgroundColor: 'white',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 15,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Ввести счёт
              </button>
            </>
          )}

          {matchStatus === 'live' && (
            <>
              <button
                onClick={() => {
                  onEnterScore();
                  onClose();
                }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  backgroundColor: 'white',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 15,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Ввести счёт
              </button>
              <button
                onClick={() => {
                  onCancelMatch();
                  onClose();
                }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  backgroundColor: '#fee2e2',
                  color: '#991b1b',
                  border: '1px solid #fecaca',
                  borderRadius: 6,
                  fontSize: 15,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Отменить матч
              </button>
            </>
          )}

          {matchStatus === 'completed' && (
            <button
              onClick={() => {
                onCancelMatch();
                onClose();
              }}
              style={{
                width: '100%',
                padding: '12px 16px',
                backgroundColor: '#fee2e2',
                color: '#991b1b',
                border: '1px solid #fecaca',
                borderRadius: 6,
                fontSize: 15,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Отменить матч
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
