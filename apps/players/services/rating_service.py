from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import logging

from django.db import transaction

from apps.players.models import Player, PlayerRatingHistory, PlayerRatingDynamic
from apps.tournaments.models import Tournament
from apps.matches.models import Match, MatchSet
from apps.players.services.initial_rating_service import get_initial_bp_rating


logger = logging.getLogger(__name__)


@dataclass
class RecomputeOptions:
    from_date: Optional[str] = None  # 'YYYY-MM-DD'
    to_date: Optional[str] = None
    tournaments: Optional[List[int]] = None
    start_rating: float = 1000.0
    start_ratings_per_player: Optional[Dict[int, float]] = None
    wipe_history: bool = False


def _expected(team_rating: float, opponent_rating: float) -> float:
    return 1.0 / (1.0 + 10 ** ((opponent_rating - team_rating) / 400.0))


def _team_rating(p1: float, p2: Optional[float]) -> float:
    # Для одиночных матчей используем рейтинг игрока как средний рейтинг пары
    return (p1 + (p2 if p2 is not None else p1)) / 2.0


def _format_modifier(match_id: int) -> float:
    """Рассчитывает форматный множитель на основе количества и результатов сетов.
    
    Правила:
    - Один тай-брейк: 0.3
    - Один полный сет: 1.0
    - Несколько сетов: 1.0 + 0.1 * |diff_sets|, где diff_sets - разница выигранных сетов
      Примеры: 2:0 → 1.2, 3:0 → 1.3, 2:1 → 1.1, 3:1 → 1.2, 1:1 → 1.0
    """
    sets = list(MatchSet.objects.filter(match_id=match_id).order_by('index'))
    if not sets:
        # Частая ситуация при старых данных: матч завершён, но нет детализации по сетам.
        # Для прозрачности логируем это при полном пересчёте.
        logger.warning("[rating] Match %s: нет записей MatchSet, форматный множитель принят = 1.0", match_id)
        return 1.0
    total_sets = len(sets)
    if total_sets == 1:
        s = sets[0]
        return 0.3 if s.is_tiebreak_only else 1.0
    # 2+ сетов: 1.0 + 0.1 * |diff_sets|
    sets_won_a = 0
    sets_won_b = 0
    for s in sets:
        if s.games_1 > s.games_2:
            sets_won_a += 1
        else:
            sets_won_b += 1
    diff_sets = abs(sets_won_a - sets_won_b)
    return 1.0 + diff_sets * 0.1


@transaction.atomic
def compute_ratings_for_tournament(tournament_id: int, k_factor: float = 32.0) -> None:
    """
    Полный расчёт рейтинга для одного турнира:
    - Накапливаем изменения по матчам внутри турнира, но применяем к игрокам одним действием (после турнира)
    - Пишем per-match записи в PlayerRatingHistory (значение = rating_after, reason = модификаторы)
    - Пишем агрегат в PlayerRatingDynamic
    - Обновляем Player.current_rating
    - Применяем коэффициент турнира (rating_coefficient) к изменениям рейтинга
    """
    tournament = Tournament.objects.select_for_update().get(id=tournament_id)
    tournament_date = getattr(tournament, 'date', None)
    tournament_coefficient = float(getattr(tournament, 'rating_coefficient', 1.0))

    # Дополнительный вывод в консоль для ручного пересчёта
    print(f"[recompute] Турнир #{tournament.id} '{tournament.name}' ({tournament_date}) system={tournament.system} single-stage")
    logger.info("[rating] === Турнир #%s '%s' (%s), k=%.1f, coef=%.2f ===", tournament.id, tournament.name, tournament_date, k_factor, tournament_coefficient)

    matches = (
        Match.objects
        .filter(tournament_id=tournament_id, status=Match.Status.COMPLETED)
        .select_related('team_1', 'team_2')
        .prefetch_related('tournament__entries')
        .order_by('id')
    )

    matches_count = matches.count()
    if matches_count == 0:
        msg = f"[recompute] Турнир #{tournament.id}: нет завершённых матчей, рейтинг не меняется"
        print(msg)
        logger.warning("[rating] Турнир #%s: нет завершённых матчей, рейтинг не меняется", tournament_id)
        return
    print(f"[recompute] Турнир #{tournament.id}: завершённых матчей = {matches_count}")
    logger.info("[rating] Турнир #%s: завершённых матчей = %s", tournament_id, matches_count)
    
    # Получаем все TournamentEntry для проверки is_out_of_competition
    from apps.tournaments.models import TournamentEntry
    entries_map = {
        entry.team_id: entry
        for entry in TournamentEntry.objects.filter(tournament_id=tournament_id).select_related('team')
    }

    # Собираем всех вовлечённых игроков
    player_ids: set[int] = set()
    for m in matches:
        for p in [getattr(m.team_1, 'player_1_id', None), getattr(m.team_1, 'player_2_id', None),
                  getattr(m.team_2, 'player_1_id', None), getattr(m.team_2, 'player_2_id', None)]:
            if p:
                player_ids.add(p)

    players_map: Dict[int, Player] = Player.objects.in_bulk(player_ids)
    # Текущие рейтинги на вход турнира
    # Если рейтинг = 0, определяем стартовый рейтинг по BTR или по названию турнира
    ratings_before: Dict[int, float] = {}
    for pid, p in players_map.items():
        if p.current_rating and p.current_rating > 0:
            ratings_before[pid] = float(p.current_rating)
        else:
            initial_rating = get_initial_bp_rating(p, tournament)
            ratings_before[pid] = float(initial_rating)
            logger.info("[rating] Турнир #%s: игрок #%s '%s' не имел рейтинга, присвоен стартовый %.1f", tournament_id, pid, p, initial_rating)
    # Накопленные изменения по игрокам за турнир (int)
    delta_by_player: Dict[int, int] = {pid: 0 for pid in player_ids}
    # Пер-матч журнал для записи истории: (match_id, change:int, fmt:float, opp_team_rating:float)
    per_match_records: Dict[int, List[Tuple[int, int, float, float]]] = {pid: [] for pid in player_ids}

    for m in matches:
        # Проверяем, не участвуют ли команды вне зачета (is_out_of_competition)
        team1_id = getattr(m.team_1, 'id', None) if m.team_1 else None
        team2_id = getattr(m.team_2, 'id', None) if m.team_2 else None
        
        team1_entry = entries_map.get(team1_id) if team1_id else None
        team2_entry = entries_map.get(team2_id) if team2_id else None
        
        # Если хотя бы одна команда вне зачета - не считаем рейтинг для этого матча
        if (team1_entry and team1_entry.is_out_of_competition) or (team2_entry and team2_entry.is_out_of_competition):
            # Записываем нулевые дельты для истории
            t1_p1 = getattr(m.team_1, 'player_1_id', None) if m.team_1 else None
            t1_p2 = getattr(m.team_1, 'player_2_id', None) if m.team_1 else None
            t2_p1 = getattr(m.team_2, 'player_1_id', None) if m.team_2 else None
            t2_p2 = getattr(m.team_2, 'player_2_id', None) if m.team_2 else None
            
            t1_r1 = ratings_before.get(t1_p1, 0.0) if t1_p1 else 0.0
            t1_r2 = ratings_before.get(t1_p2, t1_r1) if t1_p1 else 0.0
            t2_r1 = ratings_before.get(t2_p1, 0.0) if t2_p1 else 0.0
            t2_r2 = ratings_before.get(t2_p2, t2_r1) if t2_p1 else 0.0
            team1_rating = _team_rating(t1_r1, t1_p2 and t1_r2 if t1_p1 else None)
            team2_rating = _team_rating(t2_r1, t2_p2 and t2_r2 if t2_p1 else None)
            fmt = _format_modifier(m.id)
            
            for pid in filter(None, [t1_p1, t1_p2]):
                per_match_records[pid].append((m.id, 0, fmt, team2_rating))
            for pid in filter(None, [t2_p1, t2_p2]):
                per_match_records[pid].append((m.id, 0, fmt, team1_rating))
            continue
        
        # Форматный множитель по сетам
        fmt = _format_modifier(m.id)

        # Если определить победителя нельзя или не хватает команд — пишем нулевые дельты
        if not m.team_1 or not m.team_2 or not m.winner_id:
            logger.warning(
                "[rating] Турнир #%s: матч #%s пропущен для расчёта (team_1=%s, team_2=%s, winner_id=%s)",
                tournament_id,
                m.id,
                bool(m.team_1),
                bool(m.team_2),
                m.winner_id,
            )
            t1_p1 = getattr(m.team_1, 'player_1_id', None) if m.team_1 else None
            t1_p2 = getattr(m.team_1, 'player_2_id', None) if m.team_1 else None
            t2_p1 = getattr(m.team_2, 'player_1_id', None) if m.team_2 else None
            t2_p2 = getattr(m.team_2, 'player_2_id', None) if m.team_2 else None
            # Рассчитаем рейтинги команд на вход турнира для заполнения meta
            t1_r1 = ratings_before.get(t1_p1, 0.0) if t1_p1 else 0.0
            t1_r2 = ratings_before.get(t1_p2, t1_r1) if t1_p1 else 0.0
            t2_r1 = ratings_before.get(t2_p1, 0.0) if t2_p1 else 0.0
            t2_r2 = ratings_before.get(t2_p2, t2_r1) if t2_p1 else 0.0
            team1_rating = _team_rating(t1_r1, t1_p2 and t1_r2 if t1_p1 else None)
            team2_rating = _team_rating(t2_r1, t2_p2 and t2_r2 if t2_p1 else None)
            for pid in filter(None, [t1_p1, t1_p2]):
                per_match_records[pid].append((m.id, 0, fmt, team2_rating))
            for pid in filter(None, [t2_p1, t2_p2]):
                per_match_records[pid].append((m.id, 0, fmt, team1_rating))
            continue
        t1_p1 = getattr(m.team_1, 'player_1_id', None)
        t1_p2 = getattr(m.team_1, 'player_2_id', None)
        t2_p1 = getattr(m.team_2, 'player_1_id', None)
        t2_p2 = getattr(m.team_2, 'player_2_id', None)
        if not t1_p1 or not t2_p1:
            logger.warning(
                "[rating] Турнир #%s: матч #%s без обеих команд для расчёта (t1_p1=%s, t2_p1=%s)",
                tournament_id,
                m.id,
                t1_p1,
                t2_p1,
            )
            # Один из игроков отсутствует — трактуем как 0-дельты
            for pid in filter(None, [t1_p1, t1_p2, t2_p1, t2_p2]):
                per_match_records[pid].append((m.id, 0, fmt, 0.0))
            continue

        # Рейтинги игроков на начало турнира (без применения промежуточных изменений)
        t1_r1 = ratings_before.get(t1_p1, 0.0)
        t1_r2 = ratings_before.get(t1_p2, t1_r1) if t1_p2 else t1_r1
        t2_r1 = ratings_before.get(t2_p1, 0.0)
        t2_r2 = ratings_before.get(t2_p2, t2_r1) if t2_p2 else t2_r1
        team1_rating = _team_rating(t1_r1, t1_r2)
        team2_rating = _team_rating(t2_r1, t2_r2)

        actual1 = 1.0 if (m.winner_id == getattr(m, 'team_1_id', None) or m.winner_id == getattr(m.team_1, 'id', None)) else 0.0
        actual2 = 1.0 - actual1
        reason_base = f"K={k_factor};FMT={fmt:.2f};COEF={tournament_coefficient:.2f}"

        # Изменение для игроков команды 1
        exp1 = _expected(team1_rating, team2_rating)
        # Применяем коэффициент турнира к изменению рейтинга
        change1 = int(round(k_factor * fmt * (actual1 - exp1) * tournament_coefficient))
        for pid in filter(None, [t1_p1, t1_p2]):
            delta_by_player[pid] = int(delta_by_player.get(pid, 0)) + change1
            # Запомним per-match запись (match_id, delta:int, fmt, opp_team_rating)
            per_match_records[pid].append((m.id, change1, fmt, team2_rating))

        # Изменение для игроков команды 2
        exp2 = _expected(team2_rating, team1_rating)
        # Применяем коэффициент турнира к изменению рейтинга
        change2 = int(round(k_factor * fmt * (actual2 - exp2) * tournament_coefficient))
        for pid in filter(None, [t2_p1, t2_p2]):
            delta_by_player[pid] = int(delta_by_player.get(pid, 0)) + change2
            per_match_records[pid].append((m.id, change2, fmt, team1_rating))

    # Применяем изменения: обновляем current_rating и пишем историю
    total_matches_by_player: Dict[int, int] = {pid: len(per_match_records.get(pid, [])) for pid in player_ids}
    for pid, player in players_map.items():
        before = ratings_before.get(pid, 0.0)
        total_delta = int(delta_by_player.get(pid, 0))
        after = int(round(before + total_delta))
        if after < 1:
            after = 1
        logger.info(
            "[rating] Турнир #%s: игрок #%s '%s' рейтинг %.1f → %.1f (Δ=%+d, матчей=%s)",
            tournament_id,
            pid,
            player,
            before,
            after,
            total_delta,
            total_matches_by_player.get(pid, 0),
        )
        # Обновляем текущий рейтинг
        player.current_rating = after
        player.save(update_fields=["current_rating"])

        # Пер-матч история: value = дельта за ЭТОТ матч (int, со знаком)
        for match_id, dlt, fmt_val, _opp_team_rating in per_match_records.get(pid, []):
            PlayerRatingHistory.objects.create(
                player_id=pid,
                value=int(dlt),
                tournament_id=tournament_id,
                match_id=match_id,
                reason=f"fmt={fmt_val:.2f}"
            )

        # Агрегат по турниру
        # Сохраняем meta: список матчей с деталями
        meta = []
        for match_id, dlt, fmt_val, opp_team_rating in per_match_records.get(pid, []):
            meta.append({
                'match_id': match_id,
                'change': int(dlt),
                'opponent_team_rating': float(opp_team_rating),
                'format_modifier': float(fmt_val),
                'datetime': tournament_date.isoformat() if tournament_date else None,
            })

        PlayerRatingDynamic.objects.update_or_create(
            player_id=pid,
            tournament_id=tournament_id,
            defaults={
                'tournament_date': tournament_date,
                'rating_before': float(before),
                'rating_after': float(after),
                'total_change': float(total_delta),
                'matches_count': total_matches_by_player.get(pid, 0),
                'meta': meta,
            }
        )


@transaction.atomic
def compute_ratings_for_multi_stage_tournament(master_tournament_id: int, stage_ids: List[int], k_factor: float = 32.0) -> None:
    """
    Расчет рейтинга для многостадийного турнира.
    
    Логика:
    1. Собрать список всех стадий турнира
    2. Зафиксировать для каждого игрока "рейтинг до" (rating_before)
    3. Последовательно для каждой стадии считать рейтинг для матчей и записывать его в БД (PlayerRatingHistory),
       но не изменять для игроков текущий рейтинг, а накапливать его в памяти
    4. Когда для всех стадий рейтинг рассчитан, фиксировать интегрированные показатели в БД (PlayerRatingDynamic)
       для id головного турнира (master_tournament_id) и менять рейтинг игроков (current_rating)
    """
    from apps.tournaments.models import Tournament
    
    master_tournament = Tournament.objects.get(id=master_tournament_id)
    tournament_date = getattr(master_tournament, 'date', None)

    # Дополнительный вывод в консоль для ручного пересчёта
    print(f"[recompute] Мастер-турнир #{master_tournament.id} '{master_tournament.name}' ({tournament_date}) system={master_tournament.system} stages={stage_ids}")

    logger.info(
        "[rating] === Мастер-турнир #%s '%s' (%s), multi-stage, k=%.1f ===",
        master_tournament.id,
        master_tournament.name,
        tournament_date,
        k_factor,
    )

    # Получаем все стадии
    stages = Tournament.objects.filter(id__in=stage_ids).order_by('stage_order')
    
    # Собираем всех игроков из всех стадий
    player_ids: set[int] = set()
    for stage in stages:
        matches = Match.objects.filter(tournament=stage, status=Match.Status.COMPLETED).select_related('team_1', 'team_2')
        for m in matches:
            for p in [getattr(m.team_1, 'player_1_id', None), getattr(m.team_1, 'player_2_id', None),
                      getattr(m.team_2, 'player_1_id', None), getattr(m.team_2, 'player_2_id', None)]:
                if p:
                    player_ids.add(p)
    
    players_map: Dict[int, Player] = Player.objects.in_bulk(player_ids)
    
    # Шаг 2: Фиксируем "рейтинг до" для каждого игрока
    ratings_before: Dict[int, float] = {}
    for pid, p in players_map.items():
        if p.current_rating and p.current_rating > 0:
            ratings_before[pid] = float(p.current_rating)
        else:
            # Определяем стартовый рейтинг
            initial_rating = get_initial_bp_rating(p, master_tournament)
            ratings_before[pid] = float(initial_rating)
            logger.info(
                "[rating] Мастер-турнир #%s: игрок #%s '%s' не имел рейтинга, присвоен стартовый %.1f",
                master_tournament_id,
                pid,
                p,
                initial_rating,
            )
    
    # Накопленные изменения по игрокам за весь турнир
    delta_by_player: Dict[int, int] = {pid: 0 for pid in player_ids}
    # Пер-матч журнал для записи истории
    per_match_records: Dict[int, List[Tuple[int, int, float, float, int]]] = {pid: [] for pid in player_ids}
    
    # Шаг 3: Последовательно обрабатываем каждую стадию
    for stage in stages:
        tournament_coefficient = float(getattr(stage, 'rating_coefficient', 1.0))
        
        matches = (
            Match.objects
            .filter(tournament=stage, status=Match.Status.COMPLETED)
            .select_related('team_1', 'team_2')
            .order_by('id')
        )
        
        # Получаем TournamentEntry для проверки is_out_of_competition
        from apps.tournaments.models import TournamentEntry
        entries_map = {
            entry.team_id: entry
            for entry in TournamentEntry.objects.filter(tournament=stage).select_related('team')
        }
        
        for m in matches:
            # Проверяем участие вне зачета
            team1_id = getattr(m.team_1, 'id', None) if m.team_1 else None
            team2_id = getattr(m.team_2, 'id', None) if m.team_2 else None
            
            team1_entry = entries_map.get(team1_id) if team1_id else None
            team2_entry = entries_map.get(team2_id) if team2_id else None
            
            if (team1_entry and team1_entry.is_out_of_competition) or (team2_entry and team2_entry.is_out_of_competition):
                # Записываем нулевые дельты, используя стартовые рейтинги на вход турнира
                t1_p1 = getattr(m.team_1, 'player_1_id', None) if m.team_1 else None
                t1_p2 = getattr(m.team_1, 'player_2_id', None) if m.team_1 else None
                t2_p1 = getattr(m.team_2, 'player_1_id', None) if m.team_2 else None
                t2_p2 = getattr(m.team_2, 'player_2_id', None) if m.team_2 else None
                
                t1_r1 = ratings_before.get(t1_p1, 0.0) if t1_p1 else 0.0
                t1_r2 = ratings_before.get(t1_p2, t1_r1) if t1_p2 else t1_r1
                t2_r1 = ratings_before.get(t2_p1, 0.0) if t2_p1 else 0.0
                t2_r2 = ratings_before.get(t2_p2, t2_r1) if t2_p2 else t2_r1
                team1_rating = _team_rating(t1_r1, t1_r2 if t1_p2 else None)
                team2_rating = _team_rating(t2_r1, t2_r2 if t2_p2 else None)
                fmt = _format_modifier(m.id)
                
                for pid in filter(None, [t1_p1, t1_p2]):
                    per_match_records[pid].append((m.id, 0, fmt, team2_rating, stage.id))
                for pid in filter(None, [t2_p1, t2_p2]):
                    per_match_records[pid].append((m.id, 0, fmt, team1_rating, stage.id))
                continue
            
            fmt = _format_modifier(m.id)
            
            if not m.team_1 or not m.team_2 or not m.winner_id:
                logger.warning(
                    "[rating] Мастер-турнир #%s, стадия #%s: матч #%s пропущен для расчёта (team_1=%s, team_2=%s, winner_id=%s)",
                    master_tournament_id,
                    stage.id,
                    m.id,
                    bool(m.team_1),
                    bool(m.team_2),
                    m.winner_id,
                )
                # Нулевые дельты, но для meta считаем рейтинги команд от стартового рейтинга
                t1_p1 = getattr(m.team_1, 'player_1_id', None) if m.team_1 else None
                t1_p2 = getattr(m.team_1, 'player_2_id', None) if m.team_1 else None
                t2_p1 = getattr(m.team_2, 'player_1_id', None) if m.team_2 else None
                t2_p2 = getattr(m.team_2, 'player_2_id', None) if m.team_2 else None
                
                t1_r1 = ratings_before.get(t1_p1, 0.0) if t1_p1 else 0.0
                t1_r2 = ratings_before.get(t1_p2, t1_r1) if t1_p2 else t1_r1
                t2_r1 = ratings_before.get(t2_p1, 0.0) if t2_p1 else 0.0
                t2_r2 = ratings_before.get(t2_p2, t2_r1) if t2_p2 else t2_r1
                team1_rating = _team_rating(t1_r1, t1_r2 if t1_p2 else None)
                team2_rating = _team_rating(t2_r1, t2_r2 if t2_p2 else None)
                
                for pid in filter(None, [t1_p1, t1_p2]):
                    per_match_records[pid].append((m.id, 0, fmt, team2_rating, stage.id))
                for pid in filter(None, [t2_p1, t2_p2]):
                    per_match_records[pid].append((m.id, 0, fmt, team1_rating, stage.id))
                continue
            
            t1_p1 = getattr(m.team_1, 'player_1_id', None)
            t1_p2 = getattr(m.team_1, 'player_2_id', None)
            t2_p1 = getattr(m.team_2, 'player_1_id', None)
            t2_p2 = getattr(m.team_2, 'player_2_id', None)
            
            if not t1_p1 or not t2_p1:
                logger.warning(
                    "[rating] Мастер-турнир #%s, стадия #%s: матч #%s без обеих команд для расчёта (t1_p1=%s, t2_p1=%s)",
                    master_tournament_id,
                    stage.id,
                    m.id,
                    t1_p1,
                    t2_p1,
                )
                for pid in filter(None, [t1_p1, t1_p2, t2_p1, t2_p2]):
                    per_match_records[pid].append((m.id, 0, fmt, 0.0, stage.id))
                continue
            
            # Рейтинги игроков на вход многостадийного турнира (фиксированные в рамках турнира)
            t1_r1 = ratings_before.get(t1_p1, 0.0)
            t1_r2 = ratings_before.get(t1_p2, t1_r1) if t1_p2 else t1_r1
            t2_r1 = ratings_before.get(t2_p1, 0.0)
            t2_r2 = ratings_before.get(t2_p2, t2_r1) if t2_p2 else t2_r1
            team1_rating = _team_rating(t1_r1, t1_r2)
            team2_rating = _team_rating(t2_r1, t2_r2)
            
            actual1 = 1.0 if (m.winner_id == getattr(m, 'team_1_id', None) or m.winner_id == getattr(m.team_1, 'id', None)) else 0.0
            actual2 = 1.0 - actual1
            
            # Изменение для команды 1
            exp1 = _expected(team1_rating, team2_rating)
            change1 = int(round(k_factor * fmt * (actual1 - exp1) * tournament_coefficient))
            for pid in filter(None, [t1_p1, t1_p2]):
                delta_by_player[pid] += change1
                per_match_records[pid].append((m.id, change1, fmt, team2_rating, stage.id))
            
            # Изменение для команды 2
            exp2 = _expected(team2_rating, team1_rating)
            change2 = int(round(k_factor * fmt * (actual2 - exp2) * tournament_coefficient))
            for pid in filter(None, [t2_p1, t2_p2]):
                delta_by_player[pid] += change2
                per_match_records[pid].append((m.id, change2, fmt, team1_rating, stage.id))
    
    # Шаг 4: Фиксируем результаты в БД
    total_matches_by_player: Dict[int, int] = {pid: len(per_match_records.get(pid, [])) for pid in player_ids}
    for pid, player in players_map.items():
        before = ratings_before.get(pid, 0.0)
        total_delta = int(delta_by_player.get(pid, 0))
        after = int(round(before + total_delta))
        if after < 1:
            after = 1
        logger.info(
            "[rating] Мастер-турнир #%s: игрок #%s '%s' рейтинг %.1f → %.1f (Δ=%+d, матчей=%s)",
            master_tournament_id,
            pid,
            player,
            before,
            after,
            total_delta,
            total_matches_by_player.get(pid, 0),
        )
        
        # Обновляем текущий рейтинг
        player.current_rating = after
        player.save(update_fields=["current_rating"])
        
        # Пер-матч история для каждой стадии
        for match_id, dlt, fmt_val, _opp_team_rating, stage_id in per_match_records.get(pid, []):
            PlayerRatingHistory.objects.create(
                player_id=pid,
                value=int(dlt),
                tournament_id=stage_id,  # Записываем ID стадии
                match_id=match_id,
                reason=f"fmt={fmt_val:.2f}"
            )
        
        # Агрегат по головному турниру
        meta = []
        for match_id, dlt, fmt_val, opp_team_rating, stage_id in per_match_records.get(pid, []):
            meta.append({
                'match_id': match_id,
                'stage_id': stage_id,
                'change': int(dlt),
                'opponent_team_rating': float(opp_team_rating),
                'format_modifier': float(fmt_val),
                'datetime': tournament_date.isoformat() if tournament_date else None,
            })
        
        PlayerRatingDynamic.objects.update_or_create(
            player_id=pid,
            tournament_id=master_tournament_id,  # ID головного турнира
            defaults={
                'tournament_date': tournament_date,
                'rating_before': float(before),
                'rating_after': float(after),
                'total_change': float(total_delta),
                'matches_count': total_matches_by_player.get(pid, 0),
                'meta': meta,
            }
        )


@transaction.atomic
def recompute_history(options: RecomputeOptions) -> None:
    """
    Полный пересчёт истории рейтинга согласно заданным опциям.
    - Опционально чистим историю
    - Устанавливаем стартовые рейтинги
    - Идём по турнирам по дате, при совпадении даты — сортируем по названию: сначала включающие "редварит", затем "инал", затем остальные
    - Считаем каждый турнир функцией compute_ratings_for_tournament
    """
    print("[recompute] Запуск пересчёта рейтинга...")
    print(f"[recompute] Параметры: wipe_history={options.wipe_history}, from_date={options.from_date}, to_date={options.to_date}, tournaments={options.tournaments}, start_rating={options.start_rating}")

    if options.wipe_history:
        PlayerRatingHistory.objects.all().delete()
        PlayerRatingDynamic.objects.all().delete()

    # Инициализация стартовых рейтингов
    if options.start_ratings_per_player:
        for pid, val in options.start_ratings_per_player.items():
            Player.objects.filter(id=pid).update(current_rating=int(round(val)))
    else:
        # Глобальный старт, если у игрока рейтинг нулевой
        Player.objects.filter(current_rating=0).update(current_rating=int(round(options.start_rating)))

    # Берём только мастер-турниры (parent_tournament_id IS NULL)
    qs = Tournament.objects.filter(parent_tournament__isnull=True)
    if options.from_date:
        qs = qs.filter(date__gte=options.from_date)
    if options.to_date:
        qs = qs.filter(date__lte=options.to_date)
    if options.tournaments:
        qs = qs.filter(id__in=options.tournaments)

    # Сортировка: по дате проведения от старых к новым, затем по имени
    masters: List[Tournament] = list(qs)
    masters.sort(key=lambda t: (getattr(t, 'date', None) or '1900-01-01', getattr(t, 'name', '') or ''))

    print(f"[recompute] Найдено мастер-турниров: {len(masters)}")
    for master in masters:
        print(f"[recompute]  -> мастер #{master.id} '{master.name}' дата={master.date} system={master.system}")

    for master in masters:
        # Проверяем, есть ли у мастер-турнира стадии
        stages_qs = master.child_tournaments.all().order_by('stage_order', 'date', 'id')
        stage_ids = [s.id for s in stages_qs]

        if stage_ids:
            # Многостадийный турнир: считаем рейтинг по всем стадиям единым блоком
            for s in stages_qs:
                from apps.matches.models import Match
                mc = Match.objects.filter(tournament=s, status=Match.Status.COMPLETED).count()
                print(f"[recompute]   стадия #{s.id} '{s.name or s.stage_name}' дата={s.date} завершённых матчей={mc}")
            compute_ratings_for_multi_stage_tournament(master.id, stage_ids)
            print(f"[recompute] Мастер-турнир #{master.id} завершён (multi-stage)")
        else:
            # Обычный однотурнирный случай
            compute_ratings_for_tournament(master.id)
            print(f"[recompute] Турнир #{master.id} завершён (single-stage)")
