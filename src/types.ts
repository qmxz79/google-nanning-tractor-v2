/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Suit = 'spade' | 'heart' | 'club' | 'diamond' | 'joker';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | 'SJ' | 'BJ';

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
}

export type PlayerPosition = 0 | 1 | 2 | 3;

export type GamePhase = 'PREGAME' | 'DEALING' | 'BIDDING' | 'BOTTOM_REPLACEMENT' | 'PLAYING' | 'GAMEOVER';

export interface GameSettings {
  isPublicBid: boolean;      // 明叫 vs 暗叫
  bottomCardCount: number;  // 底牌数量 (usually 8)
  allowShuaiPai: boolean;   // 是否允许甩牌
  allowCounterBid: boolean; // 是否允许反扣 (Fan Kou)
}

export type CardPatternType = 
  | 'SINGLE' 
  | 'PAIR' 
  | 'TRACTOR' 
  | 'TRIPLE' 
  | 'BULLDOZER' 
  | 'QUAD' 
  | 'PLANE' 
  | 'NONE';

export interface CardPattern {
  type: CardPatternType;
  primaryValue: number; // For comparison within same pattern
  length: number;       // Number of consecutive pairs/triples
  count: number;        // Total cards
}

export interface Bid {
  player: PlayerPosition;
  suit: Suit;
  count: number; // 2, 3, or 4
}

export interface Trick {
  leader: PlayerPosition;
  cards: Record<PlayerPosition, Card[]>;
  winner?: PlayerPosition;
  points: number;
}

export interface TeamState {
  level: Rank;
  score: number;
  isBanker: boolean;
}

export interface GameState {
  phase: GamePhase;
  trumpSuit: Suit | null;
  bankerPos: PlayerPosition;
  currentPlayer: PlayerPosition;
  hands: Record<PlayerPosition, Card[]>;
  currentTrick: Trick | null;
  pastTricks: Trick[];
  teams: [TeamState, TeamState]; // 0: South/North, 1: East/West
  currentBid: Bid | null;
  message?: string;
  trumpLevel: Rank; // Added to track current grade
  isFirstRound: boolean;
  settings: GameSettings;
  dealingCount: number; // To track progress during deal
  bottomCards?: Card[]; // Bottom cards (usually 8 cards)
  nextBankerOfTeam: Record<0 | 1, PlayerPosition>; // 轮流做庄：记录各队的下一次庄家候选人位置
  gameWinner?: 0 | 1 | null; // Wins the entire game (reaches A and exceeds A)
}

export interface GameRuleEngine {
  name: string;
  numDecks: number;
  isTrump: (card: Card | undefined, trumpSuit: Suit | null, level: Rank) => boolean;
  getCardWeight: (card: Card | undefined, trumpSuit: Suit | null, level: Rank) => number;
  getPattern: (cards: Card[], trumpSuit: Suit | null, level: Rank) => CardPattern;
  isLegalPlay: (selected: Card[], hand: Card[], leadPattern: CardPattern, leadSuit: Suit | 'trump', trumpSuit: Suit | null, level: Rank) => boolean;
  getWinner: (trick: Trick, trumpSuit: Suit | null, level: Rank) => PlayerPosition;
  sortHand: (hand: Card[], trumpSuit: Suit | null, level: Rank) => Card[];
  calculatePoints: (cards: Card[]) => number;
}
