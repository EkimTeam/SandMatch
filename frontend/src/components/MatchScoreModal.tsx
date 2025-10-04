import React, { useState, useEffect } from 'react';

interface SetFormat {
  name?: string;
  games_to: number;            // до скольки геймов обычный сет (обычно 6)
  tiebreak_at: number;         // тай-брейк при этом счёте (обычно 6)
  allow_tiebreak_only_set: boolean; // разрешён ли чемпионский тай-брейк
  max_sets: number;            // 1 или 3
  tiebreak_points: number;     // очки в обычном тай-брейке (обычно 7)
  decider_tiebreak_points: number; // очки в чемпионском тай-брейке (обычно 10)
}

interface MatchScoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (team1Id: number, team2Id: number, gamesWinner: number, gamesLoser: number) => Promise<void>;
  team1: { id: number; name: string } | null;
  team2: { id: number; name: string } | null;
  setFormat?: SetFormat;
  onSaveFull?: (sets: Array<{ index: number; games_1: number; games_2: number; tb_1?: number | null; tb_2?: number | null; is_tiebreak_only?: boolean }>) => Promise<void>;
}

export const MatchScoreModal: React.FC<MatchScoreModalProps> = ({
  isOpen,
  onClose,
  onSave,
  team1,
  team2,
  setFormat,
  onSaveFull,
}) => {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // состояние по сетам
  type SetResult = {
    games1: number | null;
    games2: number | null;
    tb1?: number | null; // очки тай-брейка для 7:6/6:7
    tb2?: number | null;
    isTBOnly?: boolean; // чемпионский тай-брейк
    expanded?: boolean;
  };
  const maxSets = Math.max(1, Math.min(3, Number((setFormat?.max_sets ?? 1))));
  const initialSets: SetResult[] = Array.from({ length: maxSets }, (_, i) => ({
    games1: null,
    games2: null,
    tb1: null,
    tb2: null,
    isTBOnly: false,
    expanded: i === 0
  }));
  const [sets, setSets] = useState<SetResult[]>(initialSets);

  useEffect(() => {
    if (isOpen) {
      // Инициализация: для формата с решающим TB — последний сет сразу TB-only с 0:0
      const init = initialSets.map((s, i) => {
        if (allowTBOnly && i === initialSets.length - 1) {
          return { ...s, isTBOnly: true, tb1: 0, tb2: 0 };
        }
        return s;
      });
      setSets(init);
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, setFormat?.max_sets]);

  if (!isOpen || !team1 || !team2) return null;

  const gTo = setFormat?.games_to ?? 6;
  const tbAt = setFormat?.tiebreak_at ?? 6;
  const allowTBOnly = !!setFormat?.allow_tiebreak_only_set;
  const tbPts = setFormat?.tiebreak_points ?? 7;
  const deciderTBPts = setFormat?.decider_tiebreak_points ?? 10;

  const isTiebreakScore = (a: number, b: number) => (a === tbAt + 1 && b === tbAt) || (b === tbAt + 1 && a === tbAt);

  const quickPresets = (): Array<[number, number]> => {
    // Готовые результаты для обычного сета
    // Победитель берёт gTo геймов с разницей >= 2 (до TB), затем возможны варианты gTo+1:gTo-1 и gTo+1:gTo (TB)
    const res: Array<[number, number]> = [];
    // победитель gTo, проигравший 0..gTo-2 — исключаем gTo-1 (например, 4:3 недопустим)
    for (let lose = 0; lose <= Math.max(0, gTo - 2); lose++) res.push([gTo, lose]);
    // счёт без TB с перевесом в 2 (например, 7:5) — для укороченного сета до 4 не добавляем (5:3 недопустим)
    if (gTo >= 4) {
      res.push([gTo + 1, gTo - 1]);
    }
    // тай-брейковый счёт (например, 7:6 или 5:4)
    res.push([gTo + 1, gTo]);
    return res;
  };

  const applyScore = (idx: number, a: number, b: number) => {
    setSets(prev => {
      const next = [...prev];
      const s = { ...next[idx] };
      s.games1 = a;
      s.games2 = b;
      if (isTiebreakScore(a, b)) {
        // тай-брейк: запрашиваем только очки проигравшего (по умолчанию 0)
        if (a > b) { s.tb1 = tbPts; s.tb2 = 0; }
        else { s.tb2 = tbPts; s.tb1 = 0; }
      } else {
        s.tb1 = null; s.tb2 = null;
      }
      next[idx] = s;
      return next;
    });
  };

  const setTBOnly = (idx: number) => {
    setSets(prev => {
      const next = [...prev];
      const s = { ...next[idx] };
      s.isTBOnly = true;
      s.games1 = null; s.games2 = null; s.tb1 = 0; s.tb2 = 0; // по умолчанию 0:0
      next[idx] = s;
      return next;
    });
  };

  const updateTB = (idx: number, loser: 1 | 2, val: string) => {
    const v = val === '' ? 0 : Math.max(0, parseInt(val, 10));
    setSets(prev => {
      const next = [...prev];
      const s = { ...next[idx] };
      // записываем очки тай-брейка у проигравшего; у победителя оставляем стандартные очки tbPts
      if (loser === 1) { s.tb1 = v; s.tb2 = s.tb2 ?? tbPts; }
      else { s.tb2 = v; s.tb1 = s.tb1 ?? tbPts; }
      next[idx] = s;
      return next;
    });
  };

  const updateTBOnly = (idx: number, val1: string, val2: string) => {
    const n1 = val1 === '' ? null : Math.max(0, parseInt(val1, 10));
    const n2 = val2 === '' ? null : Math.max(0, parseInt(val2, 10));
    setSets(prev => {
      const next = [...prev];
      const s = { ...next[idx] };
      s.tb1 = n1; s.tb2 = n2; s.isTBOnly = true; s.games1 = null; s.games2 = null;
      next[idx] = s;
      return next;
    });
  };

  const canSubmit = (): boolean => {
    // Матч должен быть "решён" согласно формату: best of 1 или best of 3
    let wins1 = 0, wins2 = 0;
    const needed = maxSets === 1 ? 1 : 2;
    for (let i = 0; i < sets.length; i++) {
      const s = sets[i];
      if (!s) break;
      if (!s.isTBOnly) {
        if (s.games1 == null || s.games2 == null) continue;
        const a = s.games1, b = s.games2;
        if (a === b) continue;
        if (isTiebreakScore(a, b)) {
          // требуем tb у проигравшего заполненным (по логике ввода)
          if (a > b && (s.tb2 == null || s.tb2 < 0)) return false;
          if (b > a && (s.tb1 == null || s.tb1 < 0)) return false;
        }
        if (a > b) wins1++; else wins2++;
      } else {
        // Чемпионский тай-брейк
        if (s.tb1 == null || s.tb2 == null) continue;
        if (Math.abs(s.tb1 - s.tb2) < 2) return false;
        if (s.tb1 < deciderTBPts && s.tb2 < deciderTBPts) return false;
        if (s.tb1 > s.tb2) wins1++; else wins2++;
      }
      if (wins1 >= needed || wins2 >= needed) return true;
    }
    return false;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!canSubmit()) {
      setError('Заполните корректно счёт первого сета');
      return;
    }

    setSaving(true);
    try {
      if (onSaveFull) {
        // Сформируем только сыгранные сеты до принятия решения и приведём их к формату "от победителя"
        const needed = maxSets === 1 ? 1 : 2;
        let wins1 = 0, wins2 = 0;
        const payload: Array<{ index: number; games_1: number; games_2: number; tb_1?: number | null; tb_2?: number | null; is_tiebreak_only?: boolean }> = [];
        for (let i = 0; i < sets.length; i++) {
          const s = sets[i];
          if (!s) break;
          if (!s.isTBOnly) {
            if (s.games1 == null || s.games2 == null) continue;
            const a = s.games1, b = s.games2;
            if (a === b) continue;
            const winnerIs1 = a > b;
            // Пишем очки геймов в ориентации команд: team1 -> games_1, team2 -> games_2
            const games_1 = a;
            const games_2 = b;
            // tb указываем: tb_1 у победителя (стандартные очки тай-брейка), tb_2 у проигравшего если задан
            let tb_1: number | null | undefined = null;
            let tb_2: number | null | undefined = null;
            if (isTiebreakScore(a, b)) {
              // tb_1/tb_2 должны соответствовать team1/team2
              if (winnerIs1) {
                tb_1 = tbPts;           // team1 победил сет на TB
                tb_2 = s.tb2 ?? 0;      // очки проигравшего (team2)
              } else {
                tb_1 = s.tb1 ?? 0;      // очки проигравшего (team1)
                tb_2 = tbPts;           // team2 победил сет на TB
              }
            }
            payload.push({ index: payload.length + 1, games_1, games_2, tb_1, tb_2, is_tiebreak_only: false });
            if (winnerIs1) wins1++; else wins2++;
          } else {
            if (s.tb1 == null || s.tb2 == null) continue;
            // Для чемпионского TB передаём значения как есть для team1/team2, без перестановок
            const winnerIs1 = (s.tb1 || 0) > (s.tb2 || 0);
            payload.push({ index: payload.length + 1, games_1: 0, games_2: 0, tb_1: s.tb1!, tb_2: s.tb2!, is_tiebreak_only: true });
            if (winnerIs1) wins1++; else wins2++;
          }
          if (wins1 >= needed || wins2 >= needed) break;
        }
        await onSaveFull(payload);
      } else {
        // Fallback: только первый сет
        const s0 = sets[0]!;
        let a: number, b: number;
        if (!s0.isTBOnly) {
          a = s0.games1 as number; b = s0.games2 as number;
        } else {
          a = s0.tb1 as number; b = s0.tb2 as number;
        }
        const winnerId = a > b ? team1.id : team2.id;
        const loserId = a > b ? team2.id : team1.id;
        const gamesWinner = Math.max(a, b);
        const gamesLoser = Math.min(a, b);
        await onSave(winnerId, loserId, gamesWinner, gamesLoser);
      }
      onClose();
    } catch (err: any) {
      console.error('MatchScoreModal save error:', err);
      setError(err?.response?.data?.error || err?.message || 'Не удалось сохранить счёт');
    } finally {
      setSaving(false);
    }
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
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: 8,
          padding: 24,
          minWidth: 420,
          maxWidth: 640,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: 18, fontWeight: 600 }}>
          Ввести счёт матча
        </h3>

        <form onSubmit={handleSubmit}>
          {sets.map((s, idx) => (
            <div key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', cursor: 'pointer', justifyContent: 'center', gap: 12 }} onClick={() => setSets(prev => prev.map((it, i) => i === idx ? { ...it, expanded: !it.expanded } : it))}>
                <div style={{ fontWeight: 600 }}>Сет {idx + 1}</div>
                <div style={{ color: '#111827', fontWeight: 600 }}>
                  {!s.isTBOnly ? (
                    s.games1 != null && s.games2 != null ? `${s.games1}:${s.games2}${s.tb1 != null ? `(${s.tb1})` : s.tb2 != null ? `(${s.tb2})` : ''}` : 'не указан'
                  ) : (
                    s.tb1 != null && s.tb2 != null ? `TB ${s.tb1}:${s.tb2}` : 'чемп. тай-брейк'
                  )}
                </div>
              </div>
              {s.expanded && (
                <div style={{ padding: '8px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {/* Быстрые кнопки для обычного сета (в решающем TB-сете скрыты) */}
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>{team1.name}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(allowTBOnly && idx === maxSets - 1) ? null : quickPresets().map(([a,b], i) => (
                        <button key={i} type="button" className="btn btn-outline" onClick={() => applyScore(idx, a, b)}>{a}:{b}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>{team2.name}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(allowTBOnly && idx === maxSets - 1) ? null : quickPresets().map(([a,b], i) => (
                        <button key={i} type="button" className="btn btn-outline" onClick={() => applyScore(idx, b, a)}>{b}:{a}</button>
                      ))}
                    </div>
                  </div>

                  {/* Уточнение тай-брейка для 7:6 / 6:7 */}
                  {s.games1 != null && s.games2 != null && isTiebreakScore(s.games1, s.games2) && (
                    <div style={{ gridColumn: '1 / span 2', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ color: '#374151' }}>Очки на тай-брейке (у проигравшего):</div>
                      {s.games1 > s.games2 ? (
                        <input type="number" min={0} value={s.tb2 ?? 0} onChange={(e) => updateTB(idx, 2, e.target.value)} className="input" style={{ width: 120 }} />
                      ) : (
                        <input type="number" min={0} value={s.tb1 ?? 0} onChange={(e) => updateTB(idx, 1, e.target.value)} className="input" style={{ width: 120 }} />
                      )}
                    </div>
                  )}

                  {/* Чемпионский тай-брейк для последнего сета */}
                  {allowTBOnly && idx === maxSets - 1 && (
                    <div style={{ gridColumn: '1 / span 2', borderTop: '1px dashed #e5e7eb', paddingTop: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="checkbox" checked={!!s.isTBOnly} onChange={(e) => e.target.checked ? setTBOnly(idx) : setSets(prev => prev.map((it, i) => i === idx ? { ...it, isTBOnly: false, tb1: null, tb2: null } : it))} /> Чемпионский тай-брейк (до {deciderTBPts})
                        </label>
                      </div>
                      {s.isTBOnly && (
                        <div style={{ display: 'flex', gap: 12 }}>
                          <div>
                            <div style={{ fontSize: 13, color: '#6b7280' }}>{team1.name}</div>
                            <input type="number" min={0} value={s.tb1 ?? ''} onChange={(e) => updateTBOnly(idx, e.target.value, String(s.tb2 ?? ''))} className="input" style={{ width: 120 }} />
                          </div>
                          <div>
                            <div style={{ fontSize: 13, color: '#6b7280' }}>{team2.name}</div>
                            <input type="number" min={0} value={s.tb2 ?? ''} onChange={(e) => updateTBOnly(idx, String(s.tb1 ?? ''), e.target.value)} className="input" style={{ width: 120 }} />
                          </div>
                          <div style={{ alignSelf: 'center', color: '#6b7280' }}>Разница не менее 2</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {error && (
            <div
              style={{
                padding: '8px 12px',
                marginBottom: 16,
                backgroundColor: '#fee2e2',
                color: '#991b1b',
                borderRadius: 4,
                fontSize: 14,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={onClose}
              disabled={saving}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !canSubmit()}
            >
              {saving ? 'Сохранение...' : 'Подтвердить счёт'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
