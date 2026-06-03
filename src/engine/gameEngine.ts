import { Card, GameRuleEngine, GameState, PlayerPosition, Rank, Suit, Trick, TeamState } from "../types";

/**
 * 核心游戏引擎 v2.0
 */
export class GeneralGameEngine {
  private rules: GameRuleEngine;

  constructor(rules: GameRuleEngine) {
    this.rules = rules;
  }

  createDeck(): Card[] {
    const suits: Suit[] = ['spade', 'heart', 'club', 'diamond'];
    const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const deck: Card[] = [];
    const sessionPrefix = Math.random().toString(36).substring(2, 7);
    let idCounter = 0;

    for (let d = 0; d < this.rules.numDecks; d++) {
      for (const suit of suits) {
        for (const rank of ranks) {
          deck.push({ id: `c-${sessionPrefix}-${idCounter++}-${suit}-${rank}`, suit, rank });
        }
      }
      deck.push({ id: `c-${sessionPrefix}-${idCounter++}-joker-SJ`, suit: 'joker', rank: 'SJ' });
      deck.push({ id: `c-${sessionPrefix}-${idCounter++}-joker-BJ`, suit: 'joker', rank: 'BJ' });
    }

    return this.shuffle(deck);
  }

  private shuffle(array: Card[]): Card[] {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
  }

  initGameState(
    bankerPos: PlayerPosition = 0, 
    team0Level: Rank = '3', 
    team1Level: Rank = '3',
    nextBankerOfTeam?: Record<0 | 1, PlayerPosition>,
    isFirstRound: boolean = true
  ): GameState {
    const team0: TeamState = { level: team0Level, score: 0, isBanker: (bankerPos === 0 || bankerPos === 2) };
    const team1: TeamState = { level: team1Level, score: 0, isBanker: (bankerPos === 1 || bankerPos === 3) };

    const resolvedNextBankers = nextBankerOfTeam || (bankerPos % 2 === 0 ? {
      0: ((bankerPos + 2) % 4) as PlayerPosition,
      1: 1 as PlayerPosition // 玩家2当庄家 (East, 1) as default first banker
    } : {
      0: 0 as PlayerPosition, // 玩家1当庄家 (South, 0) as default first banker
      1: ((bankerPos + 2) % 4) as PlayerPosition
    });

    return {
      phase: 'PREGAME',
      trumpSuit: null,
      bankerPos: bankerPos,
      currentPlayer: bankerPos,
      hands: { 0: [], 1: [], 2: [], 3: [] },
      currentTrick: null,
      pastTricks: [],
      teams: [team0, team1],
      currentBid: null,
      trumpLevel: team0.isBanker ? team0Level : team1Level,
      isFirstRound: isFirstRound,
      dealingCount: 0,
      settings: {
        isPublicBid: true,
        bottomCardCount: 0,
        allowShuaiPai: true,
        allowCounterBid: true
      },
      nextBankerOfTeam: resolvedNextBankers
    };
  }

  calculateLevelIncrease(score: number): number {
    if (score < 0) {
      return 3 + Math.floor(Math.abs(score) / 80);
    }
    if (score === 0) return 3;
    if (score < 80) return 2;
    if (score < 160) return 1;
    return 0; // Banker loses
  }

  calculateChallengerLevelIncrease(score: number): number {
    if (score >= 320) return 2 + Math.floor((score - 320) / 80);
    if (score >= 240) return 1;
    if (score >= 160) return 0; // Take over but no level up
    return -1; // Fail to take over
  }
}
