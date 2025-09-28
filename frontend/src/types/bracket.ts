export type MatchStatus = 'scheduled' | 'live' | 'completed' | 'walkover' | 'retired' | 'default';

export interface MatchConnection {
  type: 'normal' | 'third_place';
  target_match_id?: number;
  target_slot?: 'team_1' | 'team_2';
  source_slot?: 'top' | 'bottom';
  sources?: Array<{ match_id: number; slot: 'loser' }>;
}

export interface SimpleTeam {
  id: number;
  name: string;
}

export interface BracketMatch {
  id: number;
  order_in_round: number;
  team_1: SimpleTeam | null;
  team_2: SimpleTeam | null;
  winner_id: number | null;
  status: MatchStatus;
  is_third_place: boolean;
  connection_info: MatchConnection | null;
  position_data: {
    round_index: number;
    match_order: number;
    total_matches_in_round: number;
  };
}

export interface BracketRound {
  round_name: string;
  round_index: number;
  is_third_place: boolean;
  matches: BracketMatch[];
}

export interface BracketData {
  ok: boolean;
  bracket: { id: number; index: number; size: number; has_third_place: boolean };
  rounds: BracketRound[];
  visual_config: {
    match_width: number;
    match_height: number;
    round_gap: number;
    match_gap: number;
  };
}
