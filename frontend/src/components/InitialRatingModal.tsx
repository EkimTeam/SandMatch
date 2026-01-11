import React, { useEffect, useState } from 'react';
import { tournamentApi } from '../services/api';

interface InitialRatingPlayerItem {
  player_id: number;
  full_name: string;
  current_rating: number;
  has_btr: boolean;
  default_rating: number;
  btr_candidates: Array<{
    id: number;
    full_name: string;
    rni: number;
    city: string;
    birth_date: string | null;
    suggested_rating_from_btr: number;
  }>;
}

interface Props {
  tournamentId: number;
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

export const InitialRatingModal: React.FC<Props> = ({ tournamentId, open, onClose, onApplied }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [players, setPlayers] = useState<InitialRatingPlayerItem[]>([]);
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [links, setLinks] = useState<Record<number, number | null>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await tournamentApi.initialRatingsPreview(tournamentId);
        const list = data.players || [];
        setPlayers(list);
        const r: Record<number, number> = {};
        const l: Record<number, number | null> = {};
        list.forEach(p => {
          let base = p.default_rating || 1000;
          if (!p.has_btr && p.btr_candidates && p.btr_candidates.length === 1) {
            base = p.btr_candidates[0].suggested_rating_from_btr;
            l[p.player_id] = p.btr_candidates[0].id;
          } else {
            l[p.player_id] = null;
          }
          r[p.player_id] = base;
        });
        setRatings(r);
        setLinks(l);
      } catch (e: any) {
        console.error('Failed to load initial ratings preview', e);
        setError(e?.response?.data?.error || 'Не удалось загрузить стартовые рейтинги');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [open, tournamentId]);

  const handleChangeRating = (playerId: number, value: string) => {
    const num = parseInt(value, 10);
    setRatings(prev => ({ ...prev, [playerId]: Number.isFinite(num) ? num : prev[playerId] }));
  };

  const handleChangeLink = (playerId: number, btrId: number | null) => {
    setLinks(prev => ({ ...prev, [playerId]: btrId }));
    const p = players.find(x => x.player_id === playerId);
    if (!p) return;
    if (btrId === null) {
      setRatings(prev => ({ ...prev, [playerId]: p.default_rating }));
    } else {
      const cand = p.btr_candidates.find(c => c.id === btrId);
      if (cand) {
        setRatings(prev => ({ ...prev, [playerId]: cand.suggested_rating_from_btr }));
      }
    }
  };

  const handleRecalculate = async () => {
    if (!window.confirm('Пересчитать стартовые рейтинги заново? Все ручные изменения будут потеряны.')) return;
    try {
      setLoading(true);
      setError(null);
      const data = await tournamentApi.initialRatingsPreview(tournamentId);
      const list = data.players || [];
      setPlayers(list);
      const r: Record<number, number> = {};
      const l: Record<number, number | null> = {};
      list.forEach(p => {
        let base = p.default_rating || 1000;
        if (!p.has_btr && p.btr_candidates && p.btr_candidates.length === 1) {
          base = p.btr_candidates[0].suggested_rating_from_btr;
          l[p.player_id] = p.btr_candidates[0].id;
        } else {
          l[p.player_id] = null;
        }
        r[p.player_id] = base;
      });
      setRatings(r);
      setLinks(l);
    } catch (e: any) {
      console.error('Failed to recalc initial ratings', e);
      setError(e?.response?.data?.error || 'Не удалось пересчитать стартовые рейтинги');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    try {
      setSaving(true);
      const items = players.map(p => ({
        player_id: p.player_id,
        rating: ratings[p.player_id] ?? p.default_rating,
        link_btr_player_id: links[p.player_id] ?? null,
      }));
      const filtered = items.filter(it => typeof it.rating === 'number' && it.rating > 0);
      const res = await tournamentApi.applyInitialRatings(tournamentId, filtered);
      if (!res.ok) {
        throw new Error('backend_error');
      }
      if (onApplied) onApplied();
      onClose();
    } catch (e: any) {
      console.error('Failed to apply initial ratings', e);
      setError(e?.response?.data?.error || 'Не удалось применить стартовые рейтинги');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 10px 30px rgba(15,23,42,0.25)',
          maxWidth: 720,
          width: '90%',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', fontSize: 18, fontWeight: 600 }}>
          Присвоить стартовый рейтинг участникам
        </div>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #eee', fontSize: 13, color: '#666' }}>
          Игрокам с текущим рейтингом 0 будет предложен стартовый рейтинг. Можно выбрать прототип из BTR или ввести рейтинг вручную.
        </div>
        {error && (
          <div style={{ padding: '8px 20px', color: '#b91c1c', fontSize: 13 }}>
            {error}
          </div>
        )}
        <div style={{ padding: '8px 20px 4px 20px', fontSize: 13, color: '#555', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            Всего игроков без рейтинга: {players.length}
          </div>
          <button
            type="button"
            className="btn"
            disabled={loading || saving}
            onClick={handleRecalculate}
          >
            Ещё раз рассчитать стартовый рейтинг
          </button>
        </div>
        <div style={{ padding: '4px 20px 12px 20px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: '12px 0', fontSize: 14 }}>Загрузка...</div>
          ) : players.length === 0 ? (
            <div style={{ padding: '12px 0', fontSize: 14 }}>В этом турнире нет игроков с рейтингом 0.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid #eee' }}>Игрок</th>
                  <th style={{ textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid #eee' }}>BTR-прототип</th>
                  <th style={{ textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid #eee', width: 120 }}>Стартовый рейтинг</th>
                </tr>
              </thead>
              <tbody>
                {players.map(p => (
                  <tr key={p.player_id}>
                    <td style={{ padding: '6px 4px', borderBottom: '1px solid #f3f4f6' }}>
                      <div style={{ fontWeight: 500 }}>{p.full_name}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>Текущий рейтинг: {p.current_rating || 0}</div>
                    </td>
                    <td style={{ padding: '6px 4px', borderBottom: '1px solid #f3f4f6' }}>
                      {p.btr_candidates && p.btr_candidates.length > 0 ? (
                        <select
                          value={links[p.player_id] ?? ''}
                          onChange={e => handleChangeLink(p.player_id, e.target.value ? Number(e.target.value) : null)}
                          style={{ fontSize: 13, padding: '4px 6px', maxWidth: '100%' }}
                        >
                          <option value="">Не связывать с BTR</option>
                          {p.btr_candidates.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.full_name} (РНИ {c.rni}{c.city ? `, ${c.city}` : ''}{c.birth_date ? `, ${c.birth_date}` : ''})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ fontSize: 12, color: '#9ca3af' }}>Нет кандидатов BTR</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 4px', borderBottom: '1px solid #f3f4f6' }}>
                      <input
                        type="number"
                        value={ratings[p.player_id] ?? p.default_rating}
                        onChange={e => handleChangeRating(p.player_id, e.target.value)}
                        style={{ width: '100%', padding: '4px 6px', fontSize: 13 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ padding: '10px 20px 14px 20px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={onClose}
          >
            Отменить
          </button>
          <button
            type="button"
            className="btn"
            disabled={saving || loading || players.length === 0}
            onClick={handleApply}
          >
            Присвоить стартовый рейтинг
          </button>
        </div>
      </div>
    </div>
  );
};
