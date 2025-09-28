import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BracketData } from '../types/bracket';
import { BracketWithSVGConnectors } from '../components/BracketWithSVGConnectors';
import { tournamentApi, matchApi } from '../services/api';

export const KnockoutPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tournamentId = useMemo(() => Number(id), [id]);

  const [bracketId, setBracketId] = useState<number | null>(() => {
    const p = Number(searchParams.get('bracket'));
    return Number.isFinite(p) && p > 0 ? p : null;
  });
  const [data, setData] = useState<BracketData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Set<number>>(new Set());

  const loadDraw = useCallback(async () => {
    if (!tournamentId || !bracketId) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await tournamentApi.getBracketDraw(tournamentId, bracketId);
      setData(resp as BracketData);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Ошибка загрузки сетки');
    } finally {
      setLoading(false);
    }
  }, [tournamentId, bracketId]);

  useEffect(() => {
    // Если bracketId не задан в URL — попробуем создать/получить его автоматически
    (async () => {
      if (!tournamentId) return;
      if (!bracketId) {
        try {
          const resp = await tournamentApi.createKnockoutBracket(tournamentId, { size: 8, has_third_place: true });
          const bid = resp?.bracket?.id;
          if (bid) {
            setBracketId(bid);
            setSearchParams(prev => {
              const sp = new URLSearchParams(prev);
              sp.set('bracket', String(bid));
              return sp;
            }, { replace: true });
          }
        } catch (e: any) {
          setError(e?.response?.data?.error || 'Не удалось получить сетку');
        }
      } else {
        // bracketId уже есть в URL
        setSearchParams(prev => {
          const sp = new URLSearchParams(prev);
          sp.set('bracket', String(bracketId));
          return sp;
        }, { replace: true });
      }
      await loadDraw();
    })();
  }, [loadDraw, bracketId, tournamentId]);

  const createBracket = async (size: number) => {
    if (!tournamentId) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await tournamentApi.createKnockoutBracket(tournamentId, { size, has_third_place: true });
      if (resp?.ok && resp?.bracket?.id) {
        setBracketId(resp.bracket.id);
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Не удалось создать сетку');
    } finally {
      setLoading(false);
    }
  };

  const seed = async () => {
    if (!tournamentId || !bracketId) return;
    setLoading(true);
    setError(null);
    try {
      await tournamentApi.seedBracket(tournamentId, bracketId);
      await loadDraw();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Не удалось выполнить посев');
    } finally {
      setLoading(false);
    }
  };

  const demoCreateSeed8 = async () => {
    if (!tournamentId) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await tournamentApi.createKnockoutBracket(tournamentId, { size: 8, has_third_place: true });
      const bid = resp?.bracket?.id;
      if (bid) {
        setBracketId(bid);
        setSearchParams(prev => { const sp = new URLSearchParams(prev); sp.set('bracket', String(bid)); return sp; }, { replace: true });
        await tournamentApi.seedBracket(tournamentId, bid);
        await loadDraw();
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Не удалось создать и засеять сетку');
    } finally {
      setLoading(false);
    }
  };

  const onMatchClick = async (matchId: number) => {
    if (!data) return;
    const all = data.rounds.flatMap((r) => r.matches);
    const m = all.find((x) => x.id === matchId);
    if (!m) return;
    if (!m.team_1 || !m.team_2) return;
    // Определим целевой матч для подсветки после сохранения
    const targetId = m.connection_info && (m.connection_info as any).target_match_id ? (m.connection_info as any).target_match_id as number : null;
    const a = prompt(`Счёт для ${m.team_1.name} vs ${m.team_2.name} — геймы победителя:`);
    const b = prompt('Геймы проигравшего:');
    if (!a || !b) return;
    const gamesFirst = Number(a);
    const gamesSecond = Number(b);
    if (Number.isNaN(gamesFirst) || Number.isNaN(gamesSecond) || gamesFirst === gamesSecond) {
      alert('Некорректный счёт');
      return;
    }
    try {
      await matchApi.savePlayoffScore(
        tournamentId,
        m.id,
        m.team_1.id,
        m.team_2.id,
        gamesFirst,
        gamesSecond
      );
      // Подсветим текущий и целевой матч
      const hl = new Set<number>();
      hl.add(m.id);
      if (targetId) hl.add(targetId);
      setHighlight(hl);
      await loadDraw();
      // Снимем подсветку через секунду
      setTimeout(() => setHighlight(new Set()), 1000);
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Не удалось сохранить счёт');
    }
  };

  return (
    <div className="container" style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <button onClick={() => navigate(`/tournaments/${tournamentId}`)}>&larr; К турниру</button>
        <h2 style={{ margin: 0 }}>Плей-офф</h2>
      </div>

      {/* Панель управления сеткой */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={demoCreateSeed8}>Показать сетку на 8 (создать+посев)</button>
        <button onClick={() => createBracket(8)}>Создать сетку на 8</button>
        <button onClick={() => createBracket(16)}>Создать сетку на 16</button>
        <button onClick={() => createBracket(32)}>Создать сетку на 32</button>
        {/* Ручной ввод ID скрыт — используем URL-параметр ?bracket= */}
        <button disabled={!bracketId} onClick={seed}>Автозасев</button>
        <button disabled={!bracketId} onClick={loadDraw}>Обновить</button>
      </div>

      {loading && <div>Загрузка...</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}

      {data && (
        <BracketWithSVGConnectors data={data} onMatchClick={onMatchClick} highlightIds={highlight} />
      )}

      {/* Нижние общие кнопки */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24 }}>
        <button onClick={() => alert('TODO: Экспорт/Поделиться')}>Поделиться</button>
        <button onClick={() => navigate(`/api/tournaments/${tournamentId}/complete/`, { replace: false })}>
          Завершить турнир
        </button>
        <button onClick={() => navigate(`/api/tournaments/${tournamentId}/remove/`, { replace: false })}>
          Удалить турнир
        </button>
      </div>
    </div>
  );
};
