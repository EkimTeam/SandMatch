import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BracketData } from '../types/bracket';
import { BracketWithSVGConnectors } from '../components/BracketWithSVGConnectors';
import { tournamentApi, matchApi } from '../services/api';
import { formatDate } from '../services/date';

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
  const [tMeta, setTMeta] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

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
    // загрузим метаданные турнира для шапки
    (async () => {
      if (!tournamentId) return;
      try {
        const resp = await fetch(`/api/tournaments/${tournamentId}/`);
        if (resp.ok) {
          const j = await resp.json();
          setTMeta(j);
        }
      } catch {}
    })();
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

  // createBracket/demos удалены — управление сетками теперь через бэк/модалку создания турнира

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

  // demoCreateSeed8 удалена

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
      {/* Шапка в стиле кругового турнира */}
      <div style={{ position: 'relative', padding: '16px 16px 8px 16px', borderBottom: '1px solid #eee', background: '#fff', marginBottom: 12 }}>
        <img src="/static/img/logo.png" alt="SandMatch" style={{ position: 'absolute', right: 16, top: 16, height: 40 }} />
        <div style={{ fontSize: 24, fontWeight: 700 }}>{tMeta?.name || 'Плей-офф'}</div>
        <div className="meta" style={{ color: '#666' }}>
          {tMeta ? `${formatDate(tMeta.date)} • ${tMeta.get_system_display} • ${tMeta.get_participant_mode_display}` : ''}
        </div>
      </div>

      {/* Панель управления сеткой (только нужные кнопки) */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="btn" disabled={!bracketId} onClick={seed}>Автозасев</button>
        <button className="btn" disabled={!bracketId} onClick={loadDraw}>Обновить</button>
      </div>

      {loading && <div>Загрузка...</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}

      {data && (
        <BracketWithSVGConnectors data={data} onMatchClick={onMatchClick} highlightIds={highlight} />
      )}

      {/* Нижние общие кнопки */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start', marginTop: 24 }}>
        <button className="btn" disabled={saving || !tMeta} onClick={async () => {
          if (!tMeta) return;
          setSaving(true);
          try { await fetch(`/api/tournaments/${tMeta.id}/complete/`, { method: 'POST' }); } finally { setSaving(false); }
          await loadDraw();
        }}>Завершить турнир</button>
        <button className="btn" style={{ background: '#dc3545', borderColor: '#dc3545' }} disabled={saving || !tMeta} onClick={async () => {
          if (!tMeta) return;
          if (!confirm('Удалить турнир без возможности восстановления?')) return;
          setSaving(true);
          try { await fetch(`/api/tournaments/${tMeta.id}/remove/`, { method: 'POST' }); } finally { setSaving(false); }
          navigate('/tournaments');
        }}>Удалить турнир</button>
        <button className="btn" disabled title="Скоро">Поделиться</button>
      </div>

      {/* Нижний DOM-футер для экспорта: скрыт на странице, показывается только при экспортe */}
      <div data-export-only="true" style={{ padding: '12px 24px 20px 24px', borderTop: '1px solid #eee', display: 'none', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14 }}>SandMatch</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>скоро онлайн</div>
      </div>
    </div>
  );
};
