import React, { useEffect, useState } from 'react';
import './NewTournamentModal.css';
import { schedulePatternApi, SchedulePattern, tournamentApi } from '../services/api';

interface SetFormat {
  id: number;
  name: string;
}

interface Ruleset {
  id: number;
  name: string;
}

interface NewTournamentModalProps {
  setFormats: SetFormat[];
  rulesets: Ruleset[]; // fallback, если локальная загрузка не сработала
  onSubmit: (data: any) => void;
  onClose: () => void;
}

export const NewTournamentModal: React.FC<NewTournamentModalProps> = ({
  setFormats,
  rulesets,
  onSubmit,
  onClose,
}) => {
  // Дефолт для круговой по заданной строке, затем fallback на (ITF), затем на первый
  const RR_DEFAULT_NAME = '(ITF): победы > личные встречи > разница сетов между всеми > личные встречи > разница геймов между всеми > личные встречи';
  const KING_DEFAULT_NAME = 'победы > разница геймов между всеми > разница геймов между собой > личные встречи';
  const FREE_FORMAT_NAME = 'свободный формат';
  const defaultSetFormatId = (setFormats.find(f => f.name === FREE_FORMAT_NAME)?.id)
    || (setFormats.find(f => f.name.toLowerCase().includes(FREE_FORMAT_NAME))?.id)
    || setFormats[0]?.id
    || '';
  const defaultRulesetId = (rulesets.find(r => r.name === RR_DEFAULT_NAME)?.id)
    || (rulesets.find(r => r.name.includes('ITF'))?.id)
    || rulesets[0]?.id || '';

  const [formData, setFormData] = useState({
    name: '',
    date: '',
    participant_mode: 'doubles',
    set_format_id: defaultSetFormatId,
    system: 'round_robin',
    ruleset_id: defaultRulesetId,
    groups_count: 1,
    participants: '',
    ko_participants: '',
    brackets_count: 1,
    schedule_pattern_id: '',
    is_rating_calc: true,
    has_prize_fund: false,
    prize_fund: '',
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [schedulePatterns, setSchedulePatterns] = useState<SchedulePattern[]>([]);
  const [loadingPatterns, setLoadingPatterns] = useState(false);
  // Локально загруженные регламенты по выбранной системе
  const [localRulesets, setLocalRulesets] = useState<Ruleset[]>([]);
  const effectiveRulesets = (localRulesets && localRulesets.length > 0) ? localRulesets : rulesets;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Введите название турнира';
    }
    if (!formData.date) {
      newErrors.date = 'Выберите дату';
    }
    if (formData.has_prize_fund && !formData.prize_fund.trim()) {
      newErrors.prize_fund = 'Укажите призовой фонд';
    }

    if (formData.system === 'round_robin') {
      const participants = parseInt(formData.participants || '0', 10);
      const groups = parseInt(formData.groups_count.toString(), 10);
      if (participants && groups && participants <= groups * 2) {
        newErrors.participants = 'Слишком мало участников для такого количества групп.';
      }
    } else if (formData.system === 'knockout') {
      const participants = parseInt(formData.ko_participants || '0', 10);
      if (!participants || participants < 1) {
        newErrors.ko_participants = 'Укажите число участников';
      } else if (participants > 512) {
        newErrors.ko_participants = 'Количество участников не может превышать 512';
      }
    } else if (formData.system === 'king') {
      const participants = parseInt(formData.participants || '0', 10);
      const groups = parseInt(formData.groups_count.toString(), 10);
      if (participants && groups) {
        const perGroup = Math.ceil(participants / groups);
        if (perGroup < 4) {
          newErrors.participants = 'Для Кинг должно быть минимум 4 участника в группе';
        } else if (perGroup > 16) {
          newErrors.participants = 'Для Кинг должно быть максимум 16 участников в группе';
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    // Нормализуем числовые поля
    const payload = {
      ...formData,
      set_format_id: Number(formData.set_format_id),
      ruleset_id: Number(formData.ruleset_id),
      groups_count: Number(formData.groups_count) || 1,
      participants: formData.participants ? Number(formData.participants) : undefined,
      ko_participants: formData.ko_participants ? Number(formData.ko_participants) : undefined,
      brackets_count: 1, // Всегда 1 сетка
      schedule_pattern_id: formData.schedule_pattern_id ? Number(formData.schedule_pattern_id) : undefined,
      is_rating_calc: formData.is_rating_calc,
      prize_fund: formData.has_prize_fund ? formData.prize_fund.trim() : null,
    };
    onSubmit(payload);
  };

  const isRoundRobin = formData.system === 'round_robin';
  const isKnockout = formData.system === 'knockout';
  const isKing = formData.system === 'king';

  // Загрузка шаблонов расписания для круговой системы и Кинг
  useEffect(() => {
    if (formData.system === 'round_robin') {
      loadSchedulePatterns('round_robin');
    } else if (formData.system === 'king') {
      loadSchedulePatterns('king');
    }
  }, [formData.system]);

  // Автоматический выбор "Индивидуальный" для Кинг
  useEffect(() => {
    if (formData.system === 'king' && formData.participant_mode !== 'singles') {
      setFormData(prev => ({ ...prev, participant_mode: 'singles' }));
    }
  }, [formData.system]);

  // Автоматический выбор регламента для Кинг
  useEffect(() => {
    if (formData.system === 'king') {
      const desired = (localRulesets.find(r => r.name === KING_DEFAULT_NAME)?.id)
        || (effectiveRulesets.find(r => r.name === KING_DEFAULT_NAME)?.id)
        || formData.ruleset_id;
      if (desired && formData.ruleset_id !== desired) {
        setFormData(prev => ({ ...prev, ruleset_id: desired }));
      }
    } else if (formData.system === 'round_robin') {
      const desired = (localRulesets.find(r => r.name === RR_DEFAULT_NAME)?.id)
        || (effectiveRulesets.find(r => r.name === RR_DEFAULT_NAME)?.id)
        || (effectiveRulesets.find(r => r.name.includes('ITF'))?.id)
        || formData.ruleset_id;
      if (desired && formData.ruleset_id !== desired) {
        setFormData(prev => ({ ...prev, ruleset_id: desired }));
      }
    }
  }, [formData.system, localRulesets]);

  const loadSchedulePatterns = async (system: 'round_robin' | 'king') => {
    setLoadingPatterns(true);
    try {
      const patterns = await schedulePatternApi.getAll();
      const filteredPatterns = patterns
        .filter(p => p.tournament_system === system)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      setSchedulePatterns(filteredPatterns);
      
      // Автоматически выбираем шаблон по умолчанию
      if (system === 'round_robin') {
        const bergerPattern = filteredPatterns.find(p => p.name === 'Алгоритм Бергера');
        if (bergerPattern && !formData.schedule_pattern_id) {
          setFormData(prev => ({ ...prev, schedule_pattern_id: bergerPattern.id.toString() }));
        }
      } else if (system === 'king') {
        const balancedPattern = filteredPatterns.find(p => p.name === 'Балансированный Американо');
        if (balancedPattern) {
          setFormData(prev => ({ ...prev, schedule_pattern_id: balancedPattern.id.toString() }));
        }
      }
    } catch (error) {
      console.error('Ошибка загрузки шаблонов расписания:', error);
    } finally {
      setLoadingPatterns(false);
    }
  };

  // Обновляем дефолтные значения при поступлении справочников
  useEffect(() => {
    const sf = (setFormats.find(f => f.name === FREE_FORMAT_NAME)?.id)
      || (setFormats.find(f => f.name.toLowerCase().includes(FREE_FORMAT_NAME))?.id)
      || setFormats[0]?.id;
    const rs = (rulesets.find(r => r.name === RR_DEFAULT_NAME)?.id)
      || (rulesets.find(r => r.name.includes('ITF'))?.id)
      || rulesets[0]?.id;
    setFormData(prev => ({
      ...prev,
      set_format_id: prev.set_format_id || (sf ?? ''),
      ruleset_id: prev.ruleset_id || (rs ?? ''),
    }));
  }, [setFormats, rulesets]);

  // Загрузка регламентов по системе (round_robin | king)
  useEffect(() => {
    const load = async () => {
      try {
        if (isRoundRobin) {
          const list = await tournamentApi.getRulesets('round_robin');
          setLocalRulesets(list);
        } else if (isKing) {
          const list = await tournamentApi.getRulesets('king');
          setLocalRulesets(list);
        } else {
          setLocalRulesets([]);
        }
      } catch (e) {
        setLocalRulesets([]);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.system]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <header>
          <strong>Новый турнир</strong>
          <button onClick={onClose} className="close-btn">✕</button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-row">
              <label htmlFor="name">Название турнира</label>
              <input
                type="text"
                id="name"
                name="name"
                placeholder="Например, BeachPlay Open"
                value={formData.name}
                onChange={handleChange}
              />
              {errors.name && <div className="error">{errors.name}</div>}
            </div>

            <div className="form-row">
              <label htmlFor="date">Дата</label>
              <input type="date" id="date" name="date" value={formData.date} onChange={handleChange} />
              {errors.date && <div className="error">{errors.date}</div>}
            </div>

            <div className="form-row">
              <label>Рейтинг</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input 
                  type="checkbox" 
                  id="is_rating_calc" 
                  name="is_rating_calc"
                  checked={formData.is_rating_calc}
                  onChange={handleChange}
                />
                <label htmlFor="is_rating_calc" style={{ margin: 0, cursor: 'pointer' }}>с обсчётом рейтинга BP</label>
              </div>
            </div>

            <div className="form-row">
              <label>Призовой фонд</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input 
                  type="checkbox" 
                  id="has_prize_fund" 
                  name="has_prize_fund"
                  checked={formData.has_prize_fund}
                  onChange={handleChange}
                />
                {formData.has_prize_fund && (
                  <input
                    type="text"
                    id="prize_fund"
                    name="prize_fund"
                    placeholder="Например, 50 000₽"
                    value={formData.prize_fund}
                    onChange={handleChange}
                    style={{ flex: 1 }}
                  />
                )}
              </div>
              {errors.prize_fund && <div className="error">{errors.prize_fund}</div>}
            </div>

            <div className="form-row">
              <label>Тип турнира</label>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" name="participant_mode" value="singles" checked={formData.participant_mode === 'singles'} onChange={handleChange} />
                  <span>Индивидуальный</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: isKing ? 0.5 : 1 }}>
                  <input type="radio" name="participant_mode" value="doubles" checked={formData.participant_mode === 'doubles'} onChange={handleChange} disabled={isKing} />
                  <span>Парный</span>
                </label>
              </div>
            </div>

            <div className="form-row">
              <label htmlFor="set_format_id">Формат</label>
              <select id="set_format_id" name="set_format_id" value={formData.set_format_id} onChange={handleChange}>
                {setFormats.map(format => (
                  <option key={format.id} value={format.id}>
                    {format.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <label>Система проведения</label>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" name="system" value="round_robin" checked={formData.system === 'round_robin'} onChange={handleChange} />
                  <span>Круговая</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" name="system" value="knockout" checked={formData.system === 'knockout'} onChange={handleChange} />
                  <span>Олимпийская</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" name="system" value="king" checked={formData.system === 'king'} onChange={handleChange} />
                  <span>Кинг</span>
                </label>
              </div>
            </div>

            {isRoundRobin && (
              <div id="rr-fields">
                <div className="form-row">
                  <label htmlFor="participants">Число участников</label>
                  <input
                    type="number"
                    id="participants"
                    name="participants"
                    min={1}
                    step={1}
                    placeholder="Например, 12"
                    value={formData.participants}
                    onChange={handleChange}
                  />
                  {errors.participants && <div className="error">{errors.participants}</div>}
                </div>
                <div className="form-row">
                  <label htmlFor="groups_count">Число групп</label>
                  <input
                    type="number"
                    id="groups_count"
                    name="groups_count"
                    min={1}
                    step={1}
                    value={formData.groups_count}
                    onChange={handleChange}
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="schedule_pattern_id">Порядок игр</label>
                  {loadingPatterns ? (
                    <div className="muted">Загрузка шаблонов...</div>
                  ) : (
                    <select 
                      id="schedule_pattern_id" 
                      name="schedule_pattern_id" 
                      value={formData.schedule_pattern_id} 
                      onChange={handleChange}
                    >
                      {schedulePatterns.map(pattern => (
                        <option key={pattern.id} value={pattern.id}>
                          {pattern.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="form-row">
                  <label htmlFor="ruleset_id">Регламент</label>
                  <select id="ruleset_id" name="ruleset_id" value={formData.ruleset_id} onChange={handleChange}>
                    {effectiveRulesets.map(ruleset => (
                      <option key={ruleset.id} value={ruleset.id}>
                        {ruleset.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {isKnockout && (
              <div id="ko-fields">
                <div className="form-row">
                  <label htmlFor="ko_participants">Число участников</label>
                  <input
                    type="number"
                    id="ko_participants"
                    name="ko_participants"
                    min={1}
                    step={1}
                    placeholder="Например, 16"
                    value={formData.ko_participants}
                    onChange={handleChange}
                  />
                  {errors.ko_participants && <div className="error">{errors.ko_participants}</div>}
                </div>
                {/* Поле "Число сеток" скрыто, всегда = 1 */}
              </div>
            )}

            {isKing && (
              <div id="king-fields">
                <div className="form-row">
                  <label htmlFor="participants">Число участников</label>
                  <input
                    type="number"
                    id="participants"
                    name="participants"
                    min={4}
                    step={1}
                    placeholder="Например, 8"
                    value={formData.participants}
                    onChange={handleChange}
                  />
                  {errors.participants && <div className="error">{errors.participants}</div>}
                  <div className="muted" style={{ fontSize: '0.85rem', marginTop: '4px' }}>От 4 до 16 участников в группе</div>
                </div>
                <div className="form-row">
                  <label htmlFor="groups_count">Число групп</label>
                  <input
                    type="number"
                    id="groups_count"
                    name="groups_count"
                    min={1}
                    step={1}
                    value={formData.groups_count}
                    onChange={handleChange}
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="schedule_pattern_id">Порядок игр</label>
                  {loadingPatterns ? (
                    <div className="muted">Загрузка шаблонов...</div>
                  ) : (
                    <select 
                      id="schedule_pattern_id" 
                      name="schedule_pattern_id" 
                      value={formData.schedule_pattern_id} 
                      onChange={handleChange}
                    >
                      {schedulePatterns.map(pattern => (
                        <option key={pattern.id} value={pattern.id}>
                          {pattern.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="form-row">
                  <label htmlFor="ruleset_id">Регламент</label>
                  <select id="ruleset_id" name="ruleset_id" value={formData.ruleset_id} onChange={handleChange}>
                    {effectiveRulesets.map(ruleset => (
                      <option key={ruleset.id} value={ruleset.id}>
                        {ruleset.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          <footer>
            <button type="button" onClick={onClose} className="btn-cancel">Отменить</button>
            <button type="submit" className="btn-create">Создать</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
