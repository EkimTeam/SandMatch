import React from 'react';

export interface StageInfo {
  id: number;
  stage_name: string;
  stage_order: number;
  system: string;
  status: string;
  can_delete: boolean;
  can_edit: boolean;
  is_current: boolean;
}

interface Props {
  stages: StageInfo[];
  currentStageId: number;
  canEdit: boolean;
  onStageChange: (stageId: number) => void;
  onDeleteStage?: (stageId: number) => void;
}

// Селектор стадий в стиле кнопок M/MX/MU (как в BTR)
export const TournamentStageSelector: React.FC<Props> = ({
  stages,
  currentStageId,
  canEdit,
  onStageChange,
  onDeleteStage,
}) => {
  if (!stages || stages.length <= 1) return null;

  const visibleStages = stages; // фильтрация по статусу делается на уровне вызова

  return (
    <div className="stage-selector" style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
      {visibleStages.map((stage) => {
        const isCurrent = stage.id === currentStageId || stage.is_current;
        return (
          <div key={stage.id} style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn"
              onClick={() => onStageChange(stage.id)}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                lineHeight: 1.4,
                borderRadius: 4,
                borderColor: isCurrent ? '#007bff' : '#ced4da',
                background: isCurrent ? '#007bff' : '#ffffff',
                color: isCurrent ? '#ffffff' : '#212529',
              }}
            >
              {stage.stage_name || `Стадия ${stage.stage_order}`}
            </button>
            {canEdit && stage.can_delete && onDeleteStage && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Удалить стадию "${stage.stage_name || ''}"?`)) {
                    onDeleteStage(stage.id);
                  }
                }}
                title="Удалить стадию"
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  border: 'none',
                  background: '#dc3545',
                  color: '#ffffff',
                  fontSize: 10,
                  lineHeight: '14px',
                  padding: 0,
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
