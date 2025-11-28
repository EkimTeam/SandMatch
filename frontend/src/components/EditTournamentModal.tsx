import React, { useEffect, useState } from 'react';
import './NewTournamentModal.css';
import { tournamentApi } from '../services/api';

interface SetFormat {
  id: number;
  name: string;
}

interface Ruleset {
  id: number;
  name: string;
}

interface EditTournamentModalProps {
  tournament: any;
  setFormats: SetFormat[];
  rulesets: Ruleset[];
  onSubmit: (data: any) => void;
  onClose: () => void;
}

export const EditTournamentModal: React.FC<EditTournamentModalProps> = ({
  tournament,
  setFormats,
  rulesets,
  onSubmit,
  onClose,
}) => {
  const RR_DEFAULT_NAME = '(ITF): победы > личные встречи > разница сетов между всеми > личные встречи > разница геймов между всеми > личные встречи';
  const FREE_FORMAT_NAME = 'свободный формат';

  const initialSetFormatId: string | number =
    (tournament.set_format && tournament.set_format.id) ||
    (setFormats.find(f => f.name === FREE_FORMAT_NAME)?.id) ||
    setFormats[0]?.id || '';

  const initialRulesetId: string | number =
    (tournament.ruleset && tournament.ruleset.id) ||
    (rulesets.find(r => r.name === RR_DEFAULT_NAME)?.id) ||
    rulesets[0]?.id || '';

  const [formData, setFormData] = useState({
    name: tournament.name || '',
    date: tournament.date || '',
    participant_mode: tournament.participant_mode || 'doubles',
    set_format_id: initialSetFormatId,
    system: (tournament.system === 'round_robin' || tournament.system === 'knockout') ? tournament.system : 'round_robin',
    ruleset_id: initialRulesetId,
    groups_count: tournament.groups_count || 1,
    participants: tournament.planned_participants || '',
    ko_participants: tournament.planned_participants || '',
    schedule_pattern_id: '',
    is_rating_calc: typeof tournament.is_rating_calc === 'boolean' ? tournament.is_rating_calc : true,
    has_prize_fund: !!tournament.prize_fund,
    prize_fund: tournament.prize_fund || '',
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
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
      const participants = parseInt((formData.participants as any) || '0', 10);
      const groups = parseInt(formData.groups_count.toString(), 10);
      if (participants && groups && participants <= groups * 2) {
        newErrors.participants = 'Слишком мало участников для такого количества групп.';
      }
    } else if (formData.system === 'knockout') {
      const participants = parseInt((formData.ko_participants as any) || '0', 10);
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
    const payload = {
      ...formData,
      set_format_id: Number(formData.set_format_id),
      ruleset_id: Number(formData.ruleset_id),
      groups_count: Number(formData.groups_count) || 1,
      participants: formData.system === 'round_robin' ? (formData.participants ? Number(formData.participants) : undefined) : undefined,
      ko_participants: formData.system === 'knockout' ? (formData.ko_participants ? Number(formData.ko_participants) : undefined) : undefined,
      schedule_pattern_id: formData.schedule_pattern_id ? Number(formData.schedule_pattern_id) : undefined,
      is_rating_calc: formData.is_rating_calc,
      has_prize_fund: formData.has_prize_fund,
      prize_fund: formData.has_prize_fund ? formData.prize_fund.trim() : null,
    };
    onSubmit(payload);
  };

  const isRoundRobin = formData.system === 'round_robin';
  const isKnockout = formData.system === 'knockout';

  // Загрузка регламентов по системе (round_robin | knockout)
  useEffect(() => {
    const load = async () => {
      try {
        if (isRoundRobin) {
          const list = await tournamentApi.getRulesets('round_robin');
          setLocalRulesets(list);
        } else if (isKnockout) {
          const list = await tournamentApi.getRulesets('knockout');
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
          <strong>Изменить настройки турнира</strong>
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
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.7 }}>
                  <input type="radio" name="participant_mode" value="singles" checked={formData.participant_mode === 'singles'} disabled />
                  <span>Индивидуальный</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.7 }}>
                  <input type="radio" name="participant_mode" value="doubles" checked={formData.participant_mode === 'doubles'} disabled />
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
              </div>
            )}
          </div>

          <footer>
            <button type="button" onClick={onClose} className="btn-cancel">Отменить</button>
            <button type="submit" className="btn-create">Изменить настройки</button>
          </footer>
        </form>
      </div>
    </div>
  );
};
