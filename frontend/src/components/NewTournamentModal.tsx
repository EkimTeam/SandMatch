import React, { useEffect, useState } from 'react';
import './NewTournamentModal.css';
import { schedulePatternApi, SchedulePattern } from '../services/api';

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
  rulesets: Ruleset[];
  onSubmit: (data: any) => void;
  onClose: () => void;
}

export const NewTournamentModal: React.FC<NewTournamentModalProps> = ({
  setFormats,
  rulesets,
  onSubmit,
  onClose,
}) => {
  const defaultRulesetId = rulesets.find(r => r.name.includes('ITF'))?.id || rulesets[0]?.id || '';

  const [formData, setFormData] = useState({
    name: '',
    date: '',
    participant_mode: 'doubles',
    set_format_id: setFormats[0]?.id || '',
    system: 'round_robin',
    ruleset_id: defaultRulesetId,
    groups_count: 1,
    participants: '',
    ko_participants: '',
    brackets_count: 1,
    schedule_pattern_id: '',
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [schedulePatterns, setSchedulePatterns] = useState<SchedulePattern[]>([]);
  const [loadingPatterns, setLoadingPatterns] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
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
    };
    onSubmit(payload);
  };

  const isRoundRobin = formData.system === 'round_robin';
  const isKnockout = formData.system === 'knockout';

  // Загрузка шаблонов расписания для круговой системы
  useEffect(() => {
    if (formData.system === 'round_robin') {
      loadSchedulePatterns();
    }
  }, [formData.system]);

  const loadSchedulePatterns = async () => {
    setLoadingPatterns(true);
    try {
      const patterns = await schedulePatternApi.getAll();
      const roundRobinPatterns = patterns
        .filter(p => p.tournament_system === 'round_robin')
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      setSchedulePatterns(roundRobinPatterns);
      
      // Автоматически выбираем "Алгоритм Бергера" по умолчанию
      const bergerPattern = roundRobinPatterns.find(p => p.name === 'Алгоритм Бергера');
      if (bergerPattern && !formData.schedule_pattern_id) {
        setFormData(prev => ({ ...prev, schedule_pattern_id: bergerPattern.id.toString() }));
      }
    } catch (error) {
      console.error('Ошибка загрузки шаблонов расписания:', error);
    } finally {
      setLoadingPatterns(false);
    }
  };

  // Обновляем дефолтные значения при поступлении справочников
  useEffect(() => {
    const sf = setFormats[0]?.id;
    const rs = rulesets.find(r => r.name.includes('ITF'))?.id || rulesets[0]?.id;
    setFormData(prev => ({
      ...prev,
      set_format_id: prev.set_format_id || (sf ?? ''),
      ruleset_id: prev.ruleset_id || (rs ?? ''),
    }));
  }, [setFormats, rulesets]);

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
              <div className="muted">
                <input type="checkbox" id="rating" disabled /> с обсчётом рейтинга (скоро)
              </div>
            </div>

            <div className="form-row">
              <label>Тип турнира</label>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" name="participant_mode" value="singles" checked={formData.participant_mode === 'singles'} onChange={handleChange} />
                  <span>Индивидуальный</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" name="participant_mode" value="doubles" checked={formData.participant_mode === 'doubles'} onChange={handleChange} />
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
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.6 }} title="Скоро">
                  <input type="radio" name="system" value="mixed" disabled />
                  <span>Американо</span>
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
                    {rulesets.map(ruleset => (
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
