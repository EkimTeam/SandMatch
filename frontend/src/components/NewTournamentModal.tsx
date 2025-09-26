import React, { useEffect, useState } from 'react';
import './NewTournamentModal.css';

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
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});

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
      const brackets = parseInt(formData.brackets_count.toString(), 10);
      if (!participants || participants < 1) {
        newErrors.ko_participants = 'Укажите число участников';
      } else if (brackets < 1) {
        newErrors.brackets_count = 'Число сеток должно быть не менее 1';
      } else if (participants <= brackets * 2) {
        newErrors.ko_participants = 'Слишком мало участников для такого количества сеток.';
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
      brackets_count: Number(formData.brackets_count) || undefined,
    };
    onSubmit(payload);
  };

  const isRoundRobin = formData.system === 'round_robin';
  const isKnockout = formData.system === 'knockout';

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
                placeholder="Например, SandMatch Open"
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
              <label htmlFor="participant_mode">Тип турнира</label>
              <select id="participant_mode" name="participant_mode" value={formData.participant_mode} onChange={handleChange}>
                <option value="singles">Индивидуальный</option>
                <option value="doubles">Парный</option>
              </select>
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
              <label htmlFor="system">Система проведения</label>
              <select id="system" name="system" value={formData.system} onChange={handleChange}>
                <option value="round_robin">Круговая</option>
                <option value="knockout">Олимпийская</option>
                <option value="mixed" disabled>Смешанная</option>
              </select>
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
                  <label>Порядок игр</label>
                  <div className="muted">выбирается/генерируется (скоро)</div>
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
                <div className="form-row">
                  <label htmlFor="brackets_count">Число сеток</label>
                  <input
                    type="number"
                    id="brackets_count"
                    name="brackets_count"
                    min={1}
                    step={1}
                    value={formData.brackets_count}
                    onChange={handleChange}
                  />
                  {errors.brackets_count && <div className="error">{errors.brackets_count}</div>}
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
