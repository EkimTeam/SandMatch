import React, { useEffect, useMemo, useState } from 'react';
import api from '../services/api';

type Player = {
  id: number;
  first_name: string;
  last_name: string;
  display_name: string;
};

interface Props {
  open: boolean;
  onClose: () => void;
  tournamentId: number;
  isDoubles: boolean;
  usedPlayerIds: number[];
  onSaved: () => void;
}

export const KnockoutParticipantPicker: React.FC<Props> = ({ 
  open, 
  onClose, 
  tournamentId, 
  isDoubles, 
  usedPlayerIds, 
  onSaved 
}) => {
  const [queryA, setQueryA] = useState('');
  const [queryB, setQueryB] = useState('');
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [playersA, setPlayersA] = useState<Player[]>([]);
  const [playersB, setPlayersB] = useState<Player[]>([]);
  const [selectedA, setSelectedA] = useState<Player | null>(null);
  const [selectedB, setSelectedB] = useState<Player | null>(null);
  const [activeField, setActiveField] = useState<'A' | 'B'>('A');
  const [adding, setAdding] = useState(false);
  const [newLast, setNewLast] = useState('');
  const [newFirst, setNewFirst] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blockedIds, setBlockedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    setQueryA(''); 
    setQueryB('');
    setSelectedA(null); 
    setSelectedB(null);
    setError(null); 
    setNewLast(''); 
    setNewFirst('');
    search('A', '');
    if (isDoubles) search('B', '');
    
    // Загрузить актуальных участников турнира
    (async () => {
      try {
        const { data } = await api.get(`/tournaments/${tournamentId}/`);
        const ids = new Set<number>(usedPlayerIds || []);
        (data.participants || []).forEach((p: any) => {
          const team = p.team || {};
          const raw1 = team.player_1 ?? team.player_1_id;
          const raw2 = team.player_2 ?? team.player_2_id;
          const id1 = typeof raw1 === 'object' ? raw1?.id : raw1;
          const id2 = typeof raw2 === 'object' ? raw2?.id : raw2;
          if (id1) ids.add(Number(id1));
          if (id2) ids.add(Number(id2));
        });
        setBlockedIds(ids);
      } catch {}
    })();
  }, [open, isDoubles, tournamentId, usedPlayerIds]);

  const disabledIds = useMemo(() => blockedIds, [blockedIds]);

  const search = async (field: 'A' | 'B', q: string) => {
    field === 'A' ? setLoadingA(true) : setLoadingB(true);
    try {
      const { data } = await api.get('/players/search/', { params: { q: q || '' } });
      const list: Player[] = data.players || [];
      if (field === 'A') setPlayersA(list); 
      else setPlayersB(list);
    } catch (e) {
      console.error('Ошибка поиска игроков:', e);
    } finally {
      field === 'A' ? setLoadingA(false) : setLoadingB(false);
    }
  };

  const choose = (field: 'A' | 'B', p: Player) => {
    setError(null);
    if (disabledIds.has(p.id)) return;
    if (isDoubles) {
      const other = field === 'A' ? selectedB : selectedA;
      if (other && other.id === p.id) return;
    }
    if (field === 'A') {
      setSelectedA(p);
      setQueryA(`${p.last_name} ${p.first_name}`.trim());
      setPlayersA([]);
    } else {
      setSelectedB(p);
      setQueryB(`${p.last_name} ${p.first_name}`.trim());
      setPlayersB([]);
    }
  };

  const addQuick = async () => {
    setError(null);
    if (!newLast.trim() || !newFirst.trim()) { 
      setError('Укажите фамилию и имя'); 
      return; 
    }
    setAdding(true);
    try {
      const { data: created } = await api.post<Player>('/players/create/', {
        last_name: newLast.trim(),
        first_name: newFirst.trim(),
      });
      if (activeField === 'A') {
        setSelectedA(created);
        setQueryA(`${created.last_name} ${created.first_name}`.trim());
        setPlayersA([]);
      } else {
        setSelectedB(created);
        setQueryB(`${created.last_name} ${created.first_name}`.trim());
        setPlayersB([]);
      }
      setNewLast(''); 
      setNewFirst('');
    } catch (e: any) {
      setError(e.message || 'Ошибка добавления игрока');
    } finally {
      setAdding(false);
    }
  };

  const submit = async () => {
    setError(null);
    
    if (!isDoubles) {
      if (!selectedA) { 
        setError('Выберите игрока'); 
        return; 
      }
      
      // Для олимпийской системы используем add_participant
      try {
        const { data } = await api.post(`/tournaments/${tournamentId}/add_participant/`, {
          player_id: selectedA.id,
          name: `${selectedA.last_name} ${selectedA.first_name}`.trim(),
        });
        if (!data.ok) { setError(data.error || 'Ошибка сохранения'); return; }
      } catch (e: any) {
        setError(e.message || 'Ошибка сохранения');
        return;
      }
    } else {
      if (!selectedA || !selectedB) { 
        setError('Выберите двух разных игроков'); 
        return; 
      }
      
      // Для пар в олимпийской системе
      try {
        const ids = [selectedA.id, selectedB.id].sort((a, b) => a - b);
        const { data } = await api.post(`/tournaments/${tournamentId}/add_participant/`, {
          player1_id: ids[0],
          player2_id: ids[1],
          name: `${selectedA.last_name}/${selectedB.last_name}`,
        });
        if (!data.ok) { setError(data.error || 'Ошибка сохранения'); return; }
      } catch (e: any) {
        setError(e.message || 'Ошибка сохранения');
        return;
      }
    }
    
    onClose(); 
    onSaved();
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <header>
          <strong>{isDoubles ? 'Выбор пары' : 'Выбор игрока'}</strong>
          <button onClick={onClose} className="close-btn">✕</button>
        </header>

        <div className="p-4 flex flex-col gap-4">
          {!isDoubles ? (
            <div>
              <div className="flex items-center gap-2">
                <input 
                  value={queryA} 
                  onChange={(e) => { 
                    setQueryA(e.target.value); 
                    setActiveField('A'); 
                    search('A', e.target.value); 
                  }} 
                  placeholder="Поиск (фамилия, имя, отображаемое имя)" 
                  className="input" 
                  style={{ width: '100%' }} 
                />
              </div>
              <div className="max-h-64 overflow-auto border rounded mt-2">
                {playersA.map(p => (
                  <div 
                    key={p.id} 
                    className={`flex items-center justify-between px-3 py-2 border-b ${
                      disabledIds.has(p.id) 
                        ? 'opacity-50 cursor-not-allowed' 
                        : 'cursor-pointer hover:bg-gray-50'
                    }`} 
                    onClick={() => !disabledIds.has(p.id) && choose('A', p)}
                  >
                    <div>
                      <div className="font-medium">{p.display_name}</div>
                      <div className="text-xs text-gray-500">{p.last_name} {p.first_name}</div>
                    </div>
                    {selectedA?.id === p.id && <span className="text-green-600 text-sm">✓</span>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="mb-1 font-medium">Игрок 1</div>
                <input 
                  value={queryA} 
                  onChange={(e) => { 
                    setActiveField('A'); 
                    setQueryA(e.target.value); 
                    search('A', e.target.value); 
                  }} 
                  placeholder="Поиск (фамилия, имя, отображаемое имя)" 
                  className="input" 
                  style={{ width: '100%' }} 
                />
                <div className="max-h-60 overflow-auto border rounded mt-2">
                  {playersA.map(p => (
                    <div 
                      key={p.id} 
                      className={`flex items-center justify-between px-3 py-2 border-b ${
                        (disabledIds.has(p.id) || selectedB?.id === p.id) 
                          ? 'opacity-50 cursor-not-allowed' 
                          : 'cursor-pointer hover:bg-gray-50'
                      }`} 
                      onClick={() => !(disabledIds.has(p.id) || selectedB?.id === p.id) && choose('A', p)}
                    >
                      <div>
                        <div className="font-medium">{p.display_name}</div>
                        <div className="text-xs text-gray-500">{p.last_name} {p.first_name}</div>
                      </div>
                      {selectedA?.id === p.id && <span className="text-green-600 text-sm">✓</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 font-medium">Игрок 2</div>
                <input 
                  value={queryB} 
                  onChange={(e) => { 
                    setActiveField('B'); 
                    setQueryB(e.target.value); 
                    search('B', e.target.value); 
                  }} 
                  placeholder="Поиск (фамилия, имя, отображаемое имя)" 
                  className="input" 
                  style={{ width: '100%' }} 
                />
                <div className="max-h-60 overflow-auto border rounded mt-2">
                  {playersB.map(p => (
                    <div 
                      key={p.id} 
                      className={`flex items-center justify-between px-3 py-2 border-b ${
                        (disabledIds.has(p.id) || selectedA?.id === p.id) 
                          ? 'opacity-50 cursor-not-allowed' 
                          : 'cursor-pointer hover:bg-gray-50'
                      }`} 
                      onClick={() => !(disabledIds.has(p.id) || selectedA?.id === p.id) && choose('B', p)}
                    >
                      <div>
                        <div className="font-medium">{p.display_name}</div>
                        <div className="text-xs text-gray-500">{p.last_name} {p.first_name}</div>
                      </div>
                      {selectedB?.id === p.id && <span className="text-green-600 text-sm">✓</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="border rounded p-3 flex flex-col gap-2">
            <div className="font-medium">Быстро добавить игрока</div>
            <div className="flex gap-2 flex-wrap">
              <input 
                value={newLast} 
                onChange={e => setNewLast(e.target.value)} 
                placeholder="Фамилия" 
                className="input" 
              />
              <input 
                value={newFirst} 
                onChange={e => setNewFirst(e.target.value)} 
                placeholder="Имя" 
                className="input" 
              />
              <button 
                className="btn" 
                onClick={addQuick} 
                disabled={adding}
              >
                Добавить и выбрать
              </button>
            </div>
          </div>

          {error && <div className="text-red-600 text-sm">{error}</div>}

          <div className="flex justify-end gap-2">
            <button className="btn" onClick={onClose}>Отмена</button>
            <button className="btn" onClick={submit}>
              {isDoubles ? 'Добавить в турнир пару' : 'Добавить в турнир участника'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
