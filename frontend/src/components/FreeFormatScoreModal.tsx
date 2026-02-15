import React, { useState, useEffect } from 'react';

interface SetScore {
  index: number;
  games_1: number;
  games_2: number;
  tb_loser_points: number | null;
  is_tiebreak_only: boolean;
  custom_enabled: boolean;
  tb_enabled: boolean;
  champion_tb_enabled: boolean;
}

interface FreeFormatScoreModalProps {
  match: {
    id: number;
    team_1?: { id: number; name?: string; display_name?: string } | null;
    team_2?: { id: number; name?: string; display_name?: string } | null;
    sets?: any[];
  };
  tournament: any;
  onClose: () => void;
  onSave: (sets: SetScore[]) => Promise<void>;
  mirror?: boolean; // true если UI порядок команд не совпадает с порядком в БД (нужен разворот)
}

const FreeFormatScoreModal: React.FC<FreeFormatScoreModalProps> = ({
  match,
  tournament,
  onClose,
  onSave,
  mirror = false
}) => {
  const [sets, setSets] = useState<SetScore[]>([
    {
      index: 1,
      games_1: 0,
      games_2: 0,
      tb_loser_points: null,
      is_tiebreak_only: false,
      custom_enabled: false,
      tb_enabled: false,
      champion_tb_enabled: false
    }
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Загрузка существующего счета
  useEffect(() => {
    if (match.sets && match.sets.length > 0) {
      const loadedSets = match.sets.map((s: any) => {
        const isChampionTB = s.is_tiebreak_only;
        const hasTB = !isChampionTB && s.tb_1 !== null && s.tb_2 !== null;
        
        // Если mirror=true, разворачиваем счёт (меняем games_1 и games_2 местами)
        const g1 = isChampionTB ? (s.tb_1 || 0) : (s.games_1 || 0);
        const g2 = isChampionTB ? (s.tb_2 || 0) : (s.games_2 || 0);
        
        return {
          index: s.index,
          games_1: mirror ? g2 : g1,
          games_2: mirror ? g1 : g2,
          tb_loser_points: hasTB ? Math.min(s.tb_1, s.tb_2) : null,
          is_tiebreak_only: isChampionTB,
          custom_enabled: !isChampionTB,
          tb_enabled: hasTB,
          champion_tb_enabled: isChampionTB
        };
      });
      setSets(loadedSets);
    }
  }, [match, mirror]);

  // Пресеты счета
  const presets = [
    [6, 0], [6, 1], [6, 2], [6, 3], [6, 4],
    [7, 5], [7, 6]
  ];

  // Форматирование отображения счета сета
  const formatSetScore = (set: SetScore): string => {
    // Чемпионский тайбрейк
    if (set.champion_tb_enabled) {
      if (set.games_1 !== 0 || set.games_2 !== 0) {
        return `TB ${set.games_1}:${set.games_2}`;
      }
      return '';
    }

    if (!set.custom_enabled || (set.games_1 === 0 && set.games_2 === 0)) {
      return '';
    }

    let score = `${set.games_1}:${set.games_2}`;

    // Обычный тайбрейк - показываем только очки проигравшего
    if (set.tb_enabled && set.tb_loser_points !== null) {
      score += `(${set.tb_loser_points})`;
    }

    return score;
  };

  // Обработка выбора пресета
  const handlePresetClick = (setIndex: number, games1: number, games2: number) => {
    setSets(prev => prev.map((s, i) => 
      i === setIndex
        ? {
            ...s,
            games_1: games1,
            games_2: games2,
            custom_enabled: true,
            champion_tb_enabled: false,
            tb_enabled: false,
            tb_loser_points: null
          }
        : s
    ));
  };

  // Переключение "Ваш счет"
  const handleCustomToggle = (setIndex: number, enabled: boolean) => {
    setSets(prev => prev.map((s, i) =>
      i === setIndex
        ? {
            ...s,
            custom_enabled: enabled,
            champion_tb_enabled: false,
            games_1: enabled ? s.games_1 : 0,
            games_2: enabled ? s.games_2 : 0,
            tb_enabled: false,
            tb_loser_points: null
          }
        : s
    ));
  };

  // Переключение TB
  const handleTBToggle = (setIndex: number, enabled: boolean) => {
    setSets(prev => prev.map((s, i) =>
      i === setIndex
        ? {
            ...s,
            tb_enabled: enabled,
            tb_loser_points: enabled ? s.tb_loser_points : null
          }
        : s
    ));
  };

  // Переключение чемпионского TB
  const handleChampionTBToggle = (setIndex: number, enabled: boolean) => {
    setSets(prev => prev.map((s, i) =>
      i === setIndex
        ? {
            ...s,
            champion_tb_enabled: enabled,
            custom_enabled: !enabled,
            is_tiebreak_only: enabled,
            games_1: 0,
            games_2: 0,
            tb_enabled: false,
            tb_loser_points: enabled ? 0 : null
          }
        : s
    ));
  };

  // Изменение геймов
  const handleGamesChange = (setIndex: number, team: 1 | 2, value: number) => {
    setSets(prev => prev.map((s, i) =>
      i === setIndex
        ? {
            ...s,
            [`games_${team}`]: Math.max(0, value)
          }
        : s
    ));
  };

  // Изменение очков TB
  const handleTBPointsChange = (setIndex: number, value: number) => {
    setSets(prev => prev.map((s, i) =>
      i === setIndex
        ? {
            ...s,
            tb_loser_points: Math.max(0, value)
          }
        : s
    ));
  };

  // Добавить сет
  const handleAddSet = () => {
    setSets(prev => [
      ...prev,
      {
        index: prev.length + 1,
        games_1: 0,
        games_2: 0,
        tb_loser_points: null,
        is_tiebreak_only: false,
        custom_enabled: false,
        tb_enabled: false,
        champion_tb_enabled: false
      }
    ]);
  };

  // Удалить сет
  const handleRemoveSet = (setIndex: number) => {
    if (sets.length > 1) {
      setSets(prev => prev.filter((_, i) => i !== setIndex).map((s, i) => ({ ...s, index: i + 1 })));
    }
  };

  // Валидация для олимпийской системы
  const validateKnockoutWinner = (): { valid: boolean; message?: string } => {
    let totalGames1 = 0;
    let totalGames2 = 0;

    for (const set of sets) {
      if (set.champion_tb_enabled) {
        // Чемпионский TB = 1:0 или 0:1
        if (set.games_1 > set.games_2) {
          totalGames1 += 1;
        } else if (set.games_2 > set.games_1) {
          totalGames2 += 1;
        }
      } else if (set.custom_enabled) {
        totalGames1 += set.games_1;
        totalGames2 += set.games_2;
      }
    }

    if (totalGames1 === totalGames2) {
      return {
        valid: false,
        message: 'Нельзя однозначно определить победителя, измените счет'
      };
    }

    return { valid: true };
  };

  // Сохранение
  const handleSave = async () => {
    setError(null);

    // Проверка что хотя бы один сет заполнен
    const hasValidSet = sets.some(s => 
      (s.custom_enabled && (s.games_1 > 0 || s.games_2 > 0)) ||
      (s.champion_tb_enabled && s.tb_loser_points !== null)
    );

    if (!hasValidSet) {
      setError('Необходимо заполнить хотя бы один сет');
      return;
    }

    // Валидация для олимпийской системы
    if (tournament.system === 'knockout') {
      const validation = validateKnockoutWinner();
      if (!validation.valid) {
        setError(validation.message || 'Ошибка валидации');
        return;
      }
    }

    setSaving(true);
    try {
      await onSave(sets);
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка сохранения счета');
    } finally {
      setSaving(false);
    }
  };

  const team1Name = match.team_1?.display_name || match.team_1?.name || 'Участник 1';
  const team2Name = match.team_2?.display_name || match.team_2?.name || 'Участник 2';

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
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Заголовок */}
        <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: 18, fontWeight: 600 }}>
          Ввести счёт матча (Свободный формат)
        </h3>

        {/* Контент с прокруткой */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
          {sets.map((set, setIndex) => (
            <div key={set.index} style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12 }}>
              {/* Шапка сета */}
              <div
                style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid #f3f4f6',
                }}
              >
                <div style={{ textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>Сет {set.index}</div>
                  {formatSetScore(set) && (
                    <span style={{ color: '#2563eb', fontWeight: 600 }}>{formatSetScore(set)}</span>
                  )}
                </div>
                {sets.length > 1 && (
                  <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => handleRemoveSet(setIndex)}
                      style={{ color: '#dc2626', fontSize: 14, background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      Удалить
                    </button>
                  </div>
                )}
              </div>
              
              <div style={{ padding: '8px 12px' }}>

              {/* Пресеты: имена по центру и общая область плиток */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div style={{ gridColumn: '1 / span 2', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1, fontWeight: 600, textAlign: 'center' }}>{team1Name}</div>
                  <div style={{ flex: 1, fontWeight: 600, textAlign: 'center' }}>{team2Name}</div>
                </div>

                {!set.champion_tb_enabled && (() => {
                  const combined: Array<[number, number]> = [];
                  presets.forEach(([g1, g2]) => {
                    combined.push([g1, g2]);
                    combined.push([g2, g1]);
                  });
                  const rows: Array<Array<[number, number]>> = [];
                  for (let i = 0; i < combined.length; i += 6) {
                    rows.push(combined.slice(i, i + 6));
                  }
                  return (
                    <div style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {rows.map((row, rIdx) => (
                        <div
                          key={rIdx}
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 6,
                            justifyContent: 'center',
                          }}
                        >
                          {row.map(([g1, g2], i) => (
                            <button
                              key={`${rIdx}-${i}`}
                              type="button"
                              className="btn btn-outline"
                              onClick={() => handlePresetClick(setIndex, g1, g2)}
                              disabled={set.champion_tb_enabled}
                            >
                              {g1}:{g2}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Ваш счет */}
              <div style={{ marginTop: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={set.custom_enabled}
                    onChange={(e) => handleCustomToggle(setIndex, e.target.checked)}
                    disabled={set.champion_tb_enabled}
                  />
                  <span style={{ fontSize: 14, fontWeight: 500 }}>Ваш счет</span>
                </label>

                {set.custom_enabled && (
                  <div style={{ marginLeft: 24 }}>
                    <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, width: 96 }}>{team1Name}:</span>
                        <input
                          type="number"
                          min="0"
                          max="20"
                          value={set.games_1}
                          onChange={(e) => handleGamesChange(setIndex, 1, parseInt(e.target.value) || 0)}
                          className="input"
                          style={{ width: 64 }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, width: 96 }}>{team2Name}:</span>
                        <input
                          type="number"
                          min="0"
                          max="20"
                          value={set.games_2}
                          onChange={(e) => handleGamesChange(setIndex, 2, parseInt(e.target.value) || 0)}
                          className="input"
                          style={{ width: 64 }}
                        />
                      </div>
                    </div>

                    {/* TB */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={set.tb_enabled}
                        onChange={(e) => handleTBToggle(setIndex, e.target.checked)}
                      />
                      <span style={{ fontSize: 14 }}>TB</span>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        disabled={!set.tb_enabled}
                        value={set.tb_loser_points || ''}
                        onChange={(e) => handleTBPointsChange(setIndex, parseInt(e.target.value) || 0)}
                        placeholder="Очки проигравшего"
                        className="input"
                        style={{ width: 128 }}
                      />
                    </div>
                  </div>
                )}

                {/* Чемпионский тайбрейк */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={set.champion_tb_enabled}
                    onChange={(e) => handleChampionTBToggle(setIndex, e.target.checked)}
                  />
                  <span style={{ fontSize: 14, fontWeight: 500 }}>Чемпионский тай-брейк (до 10)</span>
                </label>

                {set.champion_tb_enabled && (
                  <div style={{ marginLeft: 24, marginTop: 8, display: 'flex', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, color: '#6b7280' }}>{team1Name}</div>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        value={set.games_1}
                        onChange={(e) => handleGamesChange(setIndex, 1, parseInt(e.target.value) || 0)}
                        className="input"
                        style={{ width: 120 }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: '#6b7280' }}>{team2Name}</div>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        value={set.games_2}
                        onChange={(e) => handleGamesChange(setIndex, 2, parseInt(e.target.value) || 0)}
                        className="input"
                        style={{ width: 120 }}
                      />
                    </div>
                    <div style={{ alignSelf: 'center', color: '#6b7280' }}>Разница не менее 2</div>
                  </div>
                )}
              </div>
              </div>
            </div>
          ))}

          {/* Кнопка добавить сет */}
          <button
            type="button"
            onClick={handleAddSet}
            className="btn btn-outline"
            style={{ width: '100%', marginTop: 8 }}
          >
            + Добавить сет
          </button>
        </div>

        {/* Ошибка */}
        {error && (
          <div
            style={{
              padding: '8px 12px',
              marginTop: 16,
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              borderRadius: 4,
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        {/* Футер */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={onClose}
            disabled={saving}
          >
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Сохранение...' : 'Подтвердить счёт'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FreeFormatScoreModal;
