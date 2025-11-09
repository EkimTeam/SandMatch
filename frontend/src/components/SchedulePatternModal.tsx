import React, { useState, useEffect } from 'react';
import { SchedulePattern, schedulePatternApi } from '../services/api';

interface SchedulePatternModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupName: string;
  participantsCount: number;
  tournamentId: number;
  currentPatternId?: number | null;
  onSuccess: () => void;
  tournamentSystem?: 'round_robin' | 'knockout' | 'king';
}

const SchedulePatternModal: React.FC<SchedulePatternModalProps> = ({
  isOpen,
  onClose,
  groupName,
  participantsCount,
  tournamentId,
  currentPatternId,
  onSuccess,
  tournamentSystem = 'round_robin',
}) => {
  const [patterns, setPatterns] = useState<SchedulePattern[]>([]);
  const [selectedPattern, setSelectedPattern] = useState<SchedulePattern | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadPatterns();
    }
  }, [isOpen, participantsCount, currentPatternId, tournamentSystem]);

  const loadPatterns = async () => {
    setLoading(true);
    setError(null);
    try {
      let filtered: SchedulePattern[] = [];
      if (tournamentSystem === 'king') {
        // KING: только точное совпадение количества участников и только системные шаблоны
        const baseList = await schedulePatternApi.getByParticipants(participantsCount, 'king');
        filtered = baseList.filter(pattern => {
          if (currentPatternId && pattern.id === currentPatternId) return true;
          // Для системных king-шаблонов participants_count может быть равен participantsCount или быть null
          const pcRaw: any = (pattern as any).participants_count;
          const pcNum = pcRaw == null ? null : Number(pcRaw);
          const pcOk = pcNum == null || pcNum === participantsCount || pcNum === 0;
          // Мы уже запросили by_participants с system=king, поэтому не требуем явного флага tournament_system в сущности
          return pattern.is_system === true && pcOk;
        });
      } else {
        // Round-robin/knockout: прежняя логика, при нечетном N подмешиваем N+1
        let baseList = await schedulePatternApi.getByParticipants(participantsCount, tournamentSystem);
        let plusOneList: typeof baseList = [];
        if (participantsCount % 2 === 1) {
          plusOneList = await schedulePatternApi.getByParticipants(participantsCount + 1, tournamentSystem);
        }

        // Объединяем по id
        const map = new Map<number, SchedulePattern>();
        [...baseList, ...plusOneList].forEach(p => map.set(p.id, p));
        const merged = Array.from(map.values());

        // Фильтруем согласно правилам:
        // - Системные (is_system=true) всегда показываем
        // - Кастомные:
        //   * при нечетном N — только с participants_count = N+1
        //   * при четном N — только с participants_count = N
        filtered = merged.filter(pattern => {
          // Всегда включаем текущий выбранный шаблон, даже если он не проходит общие правила
          if (currentPatternId && pattern.id === currentPatternId) return true;
          if (pattern.is_system) return true;
          const pc = pattern.participants_count;
          if (pattern.pattern_type === 'custom' && typeof pc === 'number') {
            return (participantsCount % 2 === 1)
              ? pc === participantsCount + 1
              : pc === participantsCount;
          }
          return false;
        });
      }
      
      // Сортируем по алфавиту
      const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      
      setPatterns(sorted);
      
      // Выбираем текущий шаблон, если он есть в списке, иначе первый
      if (sorted.length > 0) {
        const current = currentPatternId ? sorted.find(p => p.id === currentPatternId) : null;
        setSelectedPattern(current || sorted[0]);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка загрузки шаблонов');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!selectedPattern) return;

    setApplying(true);
    setError(null);

    try {
      await schedulePatternApi.regenerateGroupSchedule(
        tournamentId,
        groupName,
        selectedPattern.id
      );
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка при применении шаблона');
    } finally {
      setApplying(false);
    }
  };

  const renderPreview = (pattern: SchedulePattern) => {
    if (pattern.pattern_type === 'berger') {
      return (
        <div className="text-sm text-gray-600 mt-2">
          <p className="font-medium">Алгоритм Бергера:</p>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li>Оптимальное распределение пар по турам</li>
            <li>Каждый участник играет 1 матч за тур</li>
            <li>Сбалансированная нагрузка</li>
          </ul>
        </div>
      );
    }

    if (pattern.pattern_type === 'snake') {
      return (
        <div className="text-sm text-gray-600 mt-2">
          <p className="font-medium">Алгоритм Змейка:</p>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li>Последовательное составление пар</li>
            <li>Простой для понимания</li>
            <li>Неравномерная нагрузка по турам</li>
          </ul>
        </div>
      );
    }

    if (pattern.pattern_type === 'custom' && pattern.custom_schedule) {
      // custom_schedule может приходить строкой — парсим
      let cs: any = pattern.custom_schedule as any;
      if (typeof cs === 'string') {
        try { cs = JSON.parse(cs); } catch { cs = {}; }
      }
      const rounds = Array.isArray(cs?.rounds) ? cs.rounds : [];
      const isKing = (pattern as any)?.tournament_system === 'king';
      // Вычисляем базу индексации (0 или 1) по минимальному индексу во всех парах
      const detectIndexBase = (roundsData: any[]): 0 | 1 => {
        let minVal: number | null = null;
        for (const r of roundsData) {
          const source = Array.isArray(r?.pairs) ? r.pairs : (Array.isArray(r?.matches) ? r.matches : []);
          for (const pair of source) {
            const candidates = [] as any[];
            if (Array.isArray(pair)) {
              candidates.push(pair[0], pair[1]);
            } else if (pair && typeof pair === 'object') {
              candidates.push(pair.team1 ?? pair.left ?? pair.a, pair.team2 ?? pair.right ?? pair.b);
            }
            for (const side of candidates) {
              const arr = Array.isArray(side) ? side : [side];
              for (const v of arr) {
                const n = Number(v);
                if (Number.isFinite(n)) {
                  if (minVal === null || n < minVal) minVal = n;
                }
              }
            }
          }
        }
        return minVal === 1 ? 1 : 0; // по умолчанию считаем 0-базу
      };
      const indexBase = detectIndexBase(rounds);
      const toLetter = (idx: number) => {
        const i = Number(idx);
        if (!Number.isFinite(i)) return '';
        const code = indexBase === 0 ? (65 + i) : (64 + i);
        return String.fromCharCode(code);
      };
      const formatSide = (side: any) => {
        if (Array.isArray(side)) {
          return side.map((v) => isKing ? toLetter(v) : String(v)).join(isKing ? '+' : '+');
        }
        return isKing ? toLetter(side) : String(side);
      };
      return (
        <div className="text-sm text-gray-600 mt-2">
          <p className="font-medium">Кастомное расписание:</p>
          <div className="mt-2 max-h-48 overflow-y-auto border border-gray-200 rounded p-2">
            {rounds.map((round: any, idx: number) => (
              <div key={idx} className="mb-1 flex flex-wrap gap-2 items-center">
                <span className="font-semibold text-xs text-gray-700">Тур {round.round}:</span>
                {(() => {
                  const source = Array.isArray((round as any).pairs)
                    ? (round as any).pairs
                    : (Array.isArray((round as any).matches) ? (round as any).matches : []);
                  return source.map((pair: any, pairIdx: number) => {
                    // Пара может приходить как массив [A,B] или объект {team1,team2}/{left,right}
                    let a = pair?.[0];
                    let b = pair?.[1];
                    if (a == null && b == null && pair && typeof pair === 'object') {
                      a = pair.team1 ?? pair.left ?? pair.a ?? null;
                      b = pair.team2 ?? pair.right ?? pair.b ?? null;
                    }
                    const left = formatSide(a);
                    const right = formatSide(b);
                    return (
                      <span
                        key={pairIdx}
                        className="inline-block bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs"
                      >
                        {left && right ? `${left} vs ${right}` : ''}
                      </span>
                    );
                  });
                })()}
                {!(Array.isArray((round as any).pairs) && (round as any).pairs.length > 0) &&
                 !(Array.isArray((round as any).matches) && (round as any).matches.length > 0) && (
                  <span className="text-xs text-gray-400">(нет пар)</span>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    }

    return null;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">
              Выбрать формат расписания
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mt-1 flex items-center gap-3 flex-wrap">
            <p className="text-sm text-gray-600">
              {groupName} • {participantsCount} участников
            </p>
            {selectedPattern && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                Текущий формат: <strong className="ml-1">{selectedPattern.name}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {loading && (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-2 text-gray-600">Загрузка шаблонов...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {!loading && patterns.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              Нет доступных шаблонов для {participantsCount} участников
            </div>
          )}

          {!loading && patterns.length > 0 && (
            <div className="space-y-3">
              {patterns.map((pattern) => (
                <div
                  key={pattern.id}
                  className={`border rounded-lg p-4 cursor-pointer transition-all ${
                    selectedPattern?.id === pattern.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedPattern(pattern)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900">{pattern.name}</h3>
                        {pattern.is_system && (
                          <span className="inline-block bg-gray-200 text-gray-700 px-2 py-0.5 rounded text-xs">
                            Системный
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{pattern.description}</p>
                      {renderPreview(pattern)}
                    </div>
                    <div className="ml-4">
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          selectedPattern?.id === pattern.id
                            ? 'border-blue-500 bg-blue-500'
                            : 'border-gray-300'
                        }`}
                      >
                        {selectedPattern?.id === pattern.id && (
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={applying}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            onClick={handleApply}
            disabled={!selectedPattern || applying}
            className="px-4 py-2 text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {applying && (
              <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            )}
            {applying ? 'Применение...' : 'Применить'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SchedulePatternModal;
