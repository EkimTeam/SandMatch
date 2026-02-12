import React, { useState, useEffect, useMemo } from 'react';

interface Participant {
  id: number;
  team_id: number;
  name: string;
  place?: number | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tournamentId: number;
  parentTournamentId: number;
  currentParticipantIds: number[];
  onSave: (selectedTeamIds: number[]) => Promise<void>;
}

export const AddParticipantsFromStageModal: React.FC<Props> = ({
  isOpen,
  onClose,
  tournamentId,
  parentTournamentId,
  currentParticipantIds,
  onSave,
}) => {
  const [allParticipants, setAllParticipants] = useState<Participant[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<'name' | 'places'>('places');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadParticipants();
      setSelectedTeamIds([...currentParticipantIds]);
    }
  }, [isOpen, parentTournamentId]);

  const loadParticipants = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/tournaments/${parentTournamentId}/`);
      const data = await response.json();
      
      // Получаем места из groupStats
      const statsResponse = await fetch(`/api/tournaments/${parentTournamentId}/group_stats/`);
      const statsData = await statsResponse.json();
      
      // Создаем карту team_id -> place
      const placementsMap: Record<number, number> = {};
      if (statsData && typeof statsData === 'object') {
        for (const groupIdx in statsData) {
          const block = statsData[groupIdx];
          if (block?.placements) {
            for (const teamId in block.placements) {
              placementsMap[Number(teamId)] = block.placements[teamId];
            }
          }
        }
      }
      
      const participants: Participant[] = (data.participants || []).map((p: any) => {
        const teamId = p.team?.id || p.id;
        return {
          id: p.id,
          team_id: teamId,
          name: p.team?.full_name || p.team?.display_name || p.team?.name || `Участник #${p.id}`,
          place: placementsMap[teamId] || null,
        };
      });
      
      setAllParticipants(participants);
    } catch (e) {
      console.error('Failed to load participants', e);
    } finally {
      setLoading(false);
    }
  };

  const filteredAndSorted = useMemo(() => {
    let result = [...allParticipants];
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(query));
    }
    if (sortMode === 'name') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      result.sort((a, b) => (a.place ?? 9999) - (b.place ?? 9999));
    }
    return result;
  }, [allParticipants, searchQuery, sortMode]);

  const toggleParticipant = (teamId: number) => {
    setSelectedTeamIds((prev) =>
      prev.includes(teamId) ? prev.filter((id) => id !== teamId) : [...prev, teamId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(selectedTeamIds);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, padding: 20, maxWidth: 720, width: '95%', maxHeight: '90vh', overflow: 'auto' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Добавить участников из предыдущей стадии</h2>
        
        <div style={{ marginBottom: 12 }}>
          <input type="text" placeholder="Поиск по ФИО..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #ced4da' }} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Сортировать</label>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as any)} style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #ced4da' }}>
            <option value="places">По местам</option>
            <option value="name">По ФИО</option>
          </select>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 4, maxHeight: 400, overflow: 'auto', padding: 6 }}>
          {loading && <div>Загрузка...</div>}
          {!loading && allParticipants.length === 0 && (
            <div style={{ fontSize: 12, color: '#6b7280' }}>Участников нет.</div>
          )}
          {!loading && filteredAndSorted.map(p => (
            <label key={p.team_id} style={{ display: 'block', fontSize: 13, padding: '2px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={selectedTeamIds.includes(p.team_id)} onChange={() => toggleParticipant(p.team_id)} style={{ marginRight: 6 }} />
              {p.name}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Отмена</button>
          <button type="button" className="btn" onClick={handleSave} disabled={saving} style={{ background: '#28a745', borderColor: '#28a745' }}>Сохранить</button>
        </div>
      </div>
    </div>
  );
};
