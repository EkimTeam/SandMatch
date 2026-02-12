import React, { useState, useEffect } from 'react';
import { STAGE_NAME_PRESETS } from '../constants/stageNames';
import { tournamentApi } from '../services/api';

interface ParticipantOption {
  id: number;
  name: string;
  place?: number | null;
}

interface SetFormatOption {
  id: number;
  name: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tournamentId: number;
  masterSystem: 'round_robin' | 'knockout' | 'king';
  masterParticipantMode: 'singles' | 'doubles';
  parentStageName?: string | null;
  parentPlannedParticipants?: number;
  parentGroupsCount?: number; // количество групп в родительской стадии
  parentDate?: string;
  parentStartTime?: string | null;
  parentIsRatingCalc?: boolean;
  parentSetFormatId?: number;
  currentParticipants: ParticipantOption[];
  setFormats: SetFormatOption[];
  onStageCreated: (stageId: number) => void;
}

export const CreateStageModal: React.FC<Props> = ({
  isOpen,
  onClose,
  tournamentId,
  masterSystem,
  masterParticipantMode,
  parentStageName,
  parentPlannedParticipants,
  parentGroupsCount,
  parentDate,
  parentStartTime,
  parentIsRatingCalc,
  parentSetFormatId,
  currentParticipants,
  setFormats,
  onStageCreated,
}) => {
  const defaultParentPreset = parentStageName && (STAGE_NAME_PRESETS as readonly string[]).includes(parentStageName)
    ? (parentStageName as (typeof STAGE_NAME_PRESETS)[number])
    : 'Предварительная стадия';
  
  const defaultStagePreset = (STAGE_NAME_PRESETS as readonly string[]).includes('Финальная стадия')
    ? ('Финальная стадия' as (typeof STAGE_NAME_PRESETS)[number])
    : STAGE_NAME_PRESETS[0];

  const [parentStageNamePreset, setParentStageNamePreset] = useState<(typeof STAGE_NAME_PRESETS)[number]>(defaultParentPreset);
  const [stageNamePreset, setStageNamePreset] = useState<(typeof STAGE_NAME_PRESETS)[number]>(defaultStagePreset);
  const [customStageName, setCustomStageName] = useState('');
  const [system, setSystem] = useState<'round_robin' | 'knockout' | 'king'>(
    masterSystem === 'king' ? 'king' : 'round_robin',
  );
  const [groupsCount, setGroupsCount] = useState(1);
  const [participantsCount, setParticipantsCount] = useState<number>(parentPlannedParticipants || currentParticipants.length || 0);
  // Определяем, нужна ли группировка по местам (только для круговой системы с несколькими группами)
  const showGroupPlacesMode = masterSystem === 'round_robin' && (parentGroupsCount || 0) > 1;
  const defaultSortMode: 'places' | 'name' | 'group_places' = showGroupPlacesMode ? 'group_places' : 'places';
  const [sortMode, setSortMode] = useState<'places' | 'name' | 'group_places'>(defaultSortMode);
  const [selectedParticipants, setSelectedParticipants] = useState<number[]>([]);
  const [date, setDate] = useState(parentDate || '');
  const [startTime, setStartTime] = useState(parentStartTime || '');
  const [isRatingCalc, setIsRatingCalc] = useState(parentIsRatingCalc ?? true);
  const [setFormatId, setSetFormatId] = useState(parentSetFormatId || (setFormats[0]?.id || 0));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setParticipantsCount(parentPlannedParticipants || currentParticipants.length || 0);
      setDate(parentDate || '');
      setStartTime(parentStartTime || '');
      setIsRatingCalc(parentIsRatingCalc ?? true);
      setSetFormatId(parentSetFormatId || (setFormats[0]?.id || 0));
      setSortMode(showGroupPlacesMode ? 'group_places' : 'places');
    }
  }, [isOpen, parentPlannedParticipants, parentGroupsCount, currentParticipants.length, parentDate, parentStartTime, parentIsRatingCalc, parentSetFormatId, setFormats, showGroupPlacesMode]);

  if (!isOpen) return null;

  const availableSystems = masterSystem === 'king'
    ? [{ value: 'king', label: 'Кинг' }]
    : [
        { value: 'round_robin', label: 'Круговая' },
        { value: 'knockout', label: 'Олимпийская' },
      ];

  const handleSubmit = async () => {
    const stageName = stageNamePreset === 'Собственное название' ? customStageName : stageNamePreset;
    if (!stageName.trim()) {
      window.alert('Введите название стадии');
      return;
    }

    if (!participantsCount || participantsCount <= 0) {
      window.alert('Укажите количество участников больше нуля');
      return;
    }

    if (selectedParticipants.length === 0) {
      window.alert('Выберите хотя бы одного участника для новой стадии');
      return;
    }

    if (!date) {
      window.alert('Укажите дату турнира');
      return;
    }

    try {
      setSaving(true);
      // Нормализуем время до формата HH:MM или отправляем null
      const normalizedStartTime = startTime && startTime.trim() !== ''
        ? (() => {
            const parts = startTime.trim().split(':');
            if (parts.length >= 2) {
              const hh = parts[0].padStart(2, '0');
              const mm = parts[1].padStart(2, '0');
              return `${hh}:${mm}`;
            }
            return null;
          })()
        : null;
      const res = await tournamentApi.createStage(tournamentId, {
        stage_name: stageName,
        system,
        participant_mode: masterParticipantMode,
        groups_count: system === 'knockout' ? 1 : groupsCount,
        copy_participants: false,
        selected_participant_ids: selectedParticipants,
        participants_count: participantsCount,
        date,
        start_time: normalizedStartTime,
        is_rating_calc: isRatingCalc,
        set_format_id: setFormatId,
      });
      if (res.ok && res.stage_id) {
        window.alert(`Стадия "${stageName}" создана`);
        onStageCreated(res.stage_id);
        onClose();
      } else {
        window.alert(res.error || 'Не удалось создать стадию');
      }
    } catch (e: any) {
      window.alert(e?.response?.data?.error || 'Не удалось создать стадию');
    } finally {
      setSaving(false);
    }
  };

  const toggleParticipant = (id: number) => {
    setSelectedParticipants((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const togglePlaceGroup = (place: number) => {
    const participantsInPlace = currentParticipants.filter(p => p.place === place).map(p => p.id);
    const allSelected = participantsInPlace.every(id => selectedParticipants.includes(id));
    
    if (allSelected) {
      // Снять выделение со всех участников этого места
      setSelectedParticipants(prev => prev.filter(id => !participantsInPlace.includes(id)));
    } else {
      // Выделить всех участников этого места
      setSelectedParticipants(prev => {
        const newSet = new Set([...prev, ...participantsInPlace]);
        return Array.from(newSet);
      });
    }
  };

  const formatParticipantName = (p: ParticipantOption): string => {
    // name уже содержит правильный формат из team.full_name
    return p.name;
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 20,
          maxWidth: 720,
          width: '95%',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Создать новую стадию</h2>

        {/* Название родительской стадии */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Название родительской стадии</label>
          <select
            value={parentStageNamePreset}
            onChange={(e) => setParentStageNamePreset(e.target.value as any)}
            style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #ced4da', marginBottom: 6 }}
          >
            {STAGE_NAME_PRESETS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {/* Название стадии */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Название новой стадии</label>
          <select
            value={stageNamePreset}
            onChange={(e) => setStageNamePreset(e.target.value as any)}
            style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #ced4da', marginBottom: 6 }}
          >
            {STAGE_NAME_PRESETS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {stageNamePreset === 'Собственное название' && (
            <input
              type="text"
              value={customStageName}
              onChange={(e) => setCustomStageName(e.target.value)}
              placeholder="Введите название стадии"
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #ced4da' }}
            />
          )}
        </div>

        {/* Система турнира и количество групп */}
        <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Схема турнира</label>
            <select
              value={system}
              onChange={(e) => setSystem(e.target.value as any)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #ced4da' }}
            >
              {availableSystems.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {masterSystem === 'king' && (
              <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                Турнир системы KING может иметь только стадии системы KING.
              </p>
            )}
          </div>
          {system === 'round_robin' && (
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Количество групп</label>
              <input
                type="number"
                min={1}
                max={16}
                value={groupsCount}
                onChange={(e) => setGroupsCount(Number(e.target.value) || 1)}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #ced4da' }}
              />
            </div>
          )}
        </div>

        {/* Дата и время */}
        <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Дата</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #ced4da' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Время начала</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #ced4da' }}
            />
          </div>
        </div>

        {/* С обсчётом рейтинга BP */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={isRatingCalc}
              onChange={(e) => setIsRatingCalc(e.target.checked)}
            />
            <span>С обсчётом рейтинга BP</span>
          </label>
        </div>

        {/* Формат счёта */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Формат счета</label>
          <select
            value={setFormatId}
            onChange={(e) => setSetFormatId(Number(e.target.value))}
            style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #ced4da' }}
          >
            {setFormats.map((fmt) => (
              <option key={fmt.id} value={fmt.id}>
                {fmt.name}
              </option>
            ))}
          </select>
        </div>

        {/* Участники */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Количество участников</label>
              <input
                type="number"
                min={1}
                max={parentPlannedParticipants || undefined}
                value={participantsCount}
                onChange={(e) => setParticipantsCount(Number(e.target.value) || 0)}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #ced4da' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Сортировать</label>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as any)}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #ced4da' }}
              >
                {showGroupPlacesMode && <option value="group_places">По местам (группировка)</option>}
                <option value="places">По местам</option>
                <option value="name">По ФИО</option>
              </select>
            </div>
          </div>

          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 4,
              maxHeight: 220,
              overflow: 'auto',
              padding: 6,
            }}
          >
            {currentParticipants.length === 0 && (
              <div style={{ fontSize: 12, color: '#6b7280' }}>Участников нет.</div>
            )}
            {sortMode === 'group_places' ? (
              // Группировка по местам
              (() => {
                const maxPlace = Math.max(...currentParticipants.map(p => p.place || 0).filter(p => p > 0), 0);
                const places = Array.from({ length: maxPlace }, (_, i) => i + 1);
                
                return places.map(place => {
                  const participantsInPlace = currentParticipants.filter(p => p.place === place);
                  if (participantsInPlace.length === 0) return null;
                  
                  const allSelected = participantsInPlace.every(p => selectedParticipants.includes(p.id));
                  
                  return (
                    <div key={place} style={{ marginBottom: 8 }}>
                      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, padding: '2px 0', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() => togglePlaceGroup(place)}
                          style={{ marginRight: 6 }}
                        />
                        {place}-е места
                      </label>
                      {participantsInPlace.map(p => (
                        <label
                          key={p.id}
                          style={{ display: 'block', fontSize: 13, padding: '2px 0', cursor: 'pointer', marginLeft: 20 }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedParticipants.includes(p.id)}
                            onChange={() => toggleParticipant(p.id)}
                            style={{ marginRight: 6 }}
                          />
                          {formatParticipantName(p)}
                        </label>
                      ))}
                    </div>
                  );
                });
              })()
            ) : (
              // Обычная сортировка
              [
                ...currentParticipants
                  .slice()
                  .sort((a, b) => {
                    if (sortMode === 'name') return formatParticipantName(a).localeCompare(formatParticipantName(b));
                    if (sortMode === 'places') return (a.place || 999) - (b.place || 999);
                    return 0;
                  }),
              ].map((p) => (
                <label
                  key={p.id}
                  style={{ display: 'block', fontSize: 13, padding: '2px 0', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={selectedParticipants.includes(p.id)}
                    onChange={() => toggleParticipant(p.id)}
                    style={{ marginRight: 6 }}
                  />
                  {formatParticipantName(p)}
                </label>
              ))
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Отмена
          </button>
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={handleSubmit}
            style={{ background: '#28a745', borderColor: '#28a745' }}
          >
            Создать стадию
          </button>
        </div>
      </div>
    </div>
  );
};
