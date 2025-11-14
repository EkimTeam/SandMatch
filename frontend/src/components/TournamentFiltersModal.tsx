import React, { useState } from 'react';

interface TournamentFiltersModalProps {
  onClose: () => void;
  onApply: (filters: TournamentFilters) => void;
  initialFilters: TournamentFilters;
}

export interface TournamentFilters {
  name: string;
  system: string;
  participant_mode: string;
  date_from: string;
  date_to: string;
}

export const TournamentFiltersModal: React.FC<TournamentFiltersModalProps> = ({
  onClose,
  onApply,
  initialFilters,
}) => {
  const [filters, setFilters] = useState<TournamentFilters>(initialFilters);

  const handleApply = () => {
    onApply(filters);
    onClose();
  };

  const handleReset = () => {
    const emptyFilters: TournamentFilters = {
      name: '',
      system: '',
      participant_mode: '',
      date_from: '',
      date_to: '',
    };
    setFilters(emptyFilters);
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          maxWidth: 500,
          width: '90%',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0 }}>Фильтры турниров</h2>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
            Название турнира
          </label>
          <input
            type="text"
            value={filters.name}
            onChange={(e) => setFilters({ ...filters, name: e.target.value })}
            placeholder="Введите название..."
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: 4,
              fontSize: 14,
            }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
            Система проведения
          </label>
          <select
            value={filters.system}
            onChange={(e) => setFilters({ ...filters, system: e.target.value })}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: 4,
              fontSize: 14,
            }}
          >
            <option value="">Все</option>
            <option value="round_robin">Круговая</option>
            <option value="knockout">Олимпийская</option>
            <option value="king">Кинг</option>
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
            Режим участников
          </label>
          <select
            value={filters.participant_mode}
            onChange={(e) => setFilters({ ...filters, participant_mode: e.target.value })}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: 4,
              fontSize: 14,
            }}
          >
            <option value="">Все</option>
            <option value="singles">Индивидуальный</option>
            <option value="doubles">Пары</option>
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
            Дата от
          </label>
          <input
            type="date"
            value={filters.date_from}
            onChange={(e) => setFilters({ ...filters, date_from: e.target.value })}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: 4,
              fontSize: 14,
            }}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
            Дата до
          </label>
          <input
            type="date"
            value={filters.date_to}
            onChange={(e) => setFilters({ ...filters, date_to: e.target.value })}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: 4,
              fontSize: 14,
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={handleReset}
            style={{
              padding: '8px 16px',
              border: '1px solid #ddd',
              borderRadius: 4,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Сбросить
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              border: '1px solid #ddd',
              borderRadius: 4,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Отмена
          </button>
          <button
            onClick={handleApply}
            className="btn"
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
};
