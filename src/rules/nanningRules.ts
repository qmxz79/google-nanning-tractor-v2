import { Card, CardPattern, CardPatternType, GameRuleEngine, PlayerPosition, Rank, Suit, Trick } from "../types";

/**
 * 南宁四副牌拖拉机规则实现 v2.0
 */
const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
  'SJ': 15, 'BJ': 16
};

const SUIT_VALUES: Record<Suit, number> = {
  'spade': 4, 'heart': 3, 'club': 2, 'diamond': 1, 'joker': 0
};

export const NanningRules: GameRuleEngine = {
  name: "南宁四副牌拖拉机 (v2.0)",
  numDecks: 4,

  calculatePoints(cards: Card[]): number {
    const seenIds = new Set<string>();
    return cards.reduce((sum, card) => {
      if (!card || !card.id || seenIds.has(card.id)) return sum;
      seenIds.add(card.id);
      if (card.rank === '5') return sum + 5;
      if (card.rank === '10' || card.rank === 'K') return sum + 10;
      return sum;
    }, 0);
  },

  isTrump(card: Card | undefined, trumpSuit: Suit | null, level: Rank): boolean {
    if (!card) return false;
    // 1. Jokers are always trump
    if (card.suit === 'joker' || card.rank === 'BJ' || card.rank === 'SJ') return true;
    // 2. Rank 2 are always trump
    if (card.rank === '2') return true;
    // 3. Current level cards are always trump
    if (card.rank === level) return true;
    // 4. Match the called trump suit
    if (trumpSuit && card.suit === trumpSuit) return true;
    
    return false;
  },

  getCardWeight(card: Card | undefined, trumpSuit: Suit | null, level: Rank): number {
    if (!card) return 0;
    
    // Order: BJ > SJ > Main Level > Sub Level > Main 2 > Sub 2 > Main A > Main K ...
    if (card.rank === 'BJ') return 1000;
    if (card.rank === 'SJ') return 900;
    
    const isLevel = card.rank === level;
    const isTwo = card.rank === '2';
    const isMainSuit = card.suit === trumpSuit;
    const suitVal = SUIT_VALUES[card.suit] || 0;

    if (isLevel && isMainSuit) return 800;
    if (isLevel) return 790 - (4 - suitVal); // Higher suit priority: Spade > Heart > Club > Diamond
    
    if (isTwo && (isMainSuit || trumpSuit === 'joker')) return 780;
    if (isTwo) return 770 - (4 - suitVal);

    if (this.isTrump(card, trumpSuit, level)) {
      let rValue = RANK_VALUES[card.rank] || 0;
      return 500 + rValue;
    }

    return RANK_VALUES[card.rank] || 0;
  },

  getPattern(cards: Card[], trumpSuit: Suit | null, level: Rank): CardPattern {
    const len = cards.length;
    if (len === 0) return { type: 'NONE', primaryValue: 0, length: 0, count: 0 };

    // Group cards by weight
    const groups: Record<number, number> = {};
    cards.forEach(c => {
      const w = this.getCardWeight(c, trumpSuit, level);
      groups[w] = (groups[w] || 0) + 1;
    });

    const weights = Object.keys(groups).map(Number).sort((a, b) => b - a);
    const maxFreq = Math.max(...Object.values(groups));

    // Plane check... QUAD check...
    if (maxFreq === 4 && len % 4 === 0) {
      if (isConsecutive(weights, len / 4, 4, groups, trumpSuit, level, cards)) {
        return { type: 'PLANE', primaryValue: weights[0], length: len / 4, count: len };
      }
      if (len === 4) return { type: 'QUAD', primaryValue: weights[0], length: 1, count: 4 };
    }

    if (maxFreq >= 3 && len % 3 === 0) {
      if (isConsecutive(weights, len / 3, 3, groups, trumpSuit, level, cards)) {
        return { type: 'BULLDOZER', primaryValue: weights[0], length: len / 3, count: len };
      }
      if (len === 3) return { type: 'TRIPLE', primaryValue: weights[0], length: 1, count: 3 };
    }

    if (maxFreq >= 2 && len % 2 === 0) {
      if (isConsecutive(weights, len / 2, 2, groups, trumpSuit, level, cards)) {
        return { type: 'TRACTOR', primaryValue: weights[0], length: len / 2, count: len };
      }
      if (len === 2) return { type: 'PAIR', primaryValue: weights[0], length: 1, count: 2 };
    }

    if (len === 1) {
      return { type: 'SINGLE', primaryValue: weights[0], length: 1, count: 1 };
    }

    return { type: 'NONE', primaryValue: weights[0] || 0, length: 0, count: len };
  },

  isLegalPlay(selected: Card[], hand: Card[], leadPattern: CardPattern, leadSuit: Suit | 'trump', trumpSuit: Suit | null, level: Rank): boolean {
    const targetCount = leadPattern.count || selected.length; 
    if (selected.length !== targetCount) return false;

    const leadIsTrump = leadSuit === 'trump';
    
    // Total count of matching suit in hand
    const handMatching = hand.filter(c => {
      if (!c) return false;
      const cIsTrump = this.isTrump(c, trumpSuit, level);
      if (leadIsTrump) return cIsTrump;
      // For non-trump lead, you must play non-trump card of that suit
      return !cIsTrump && c.suit === leadSuit;
    });

    const selectedMatching = selected.filter(c => {
      if (!c) return false;
      const cIsTrump = this.isTrump(c, trumpSuit, level);
      if (leadIsTrump) return cIsTrump;
      return !cIsTrump && c.suit === leadSuit;
    });

    // Rule 1: Follow suit count as much as possible
    if (selectedMatching.length < Math.min(targetCount, handMatching.length)) return false;

    // Rule 2: Follow pattern priorities if we actually have matching suit cards
    if (handMatching.length > 0) {
      const M = selectedMatching.length;
      
      const checkPriorities = (cards: Card[]): {
        hasQuad: boolean;
        hasTriple: boolean;
        hasTractor: boolean;
        hasTwoPairs: boolean;
        hasOnePair: boolean;
      } => {
        const hGroups: Record<number, number> = {};
        cards.forEach(c => {
          const w = this.getCardWeight(c, trumpSuit, level);
          hGroups[w] = (hGroups[w] || 0) + 1;
        });
        const counts = Object.values(hGroups);
        const weightsWithPairs = Object.keys(hGroups).map(Number).filter(w => hGroups[w] >= 2).sort((a,b) => b - a);
        
        let hasTractor = false;
        for (let i = 0; i < weightsWithPairs.length - 1; i++) {
          const w1 = weightsWithPairs[i];
          const w2 = weightsWithPairs[i+1];
          const c1 = cards.find(c => this.getCardWeight(c, trumpSuit, level) === w1);
          const c2 = cards.find(c => this.getCardWeight(c, trumpSuit, level) === w2);
          if (c1 && c2 && areCardsCompatibleAndAdjacent(c1, c2, trumpSuit, level)) {
            hasTractor = true;
            break;
          }
        }

        const hasQuad = counts.some(c => c >= 4);
        const hasTriple = counts.some(c => c >= 3);
        const hasTwoPairs = weightsWithPairs.length >= 2;
        const hasOnePair = weightsWithPairs.length >= 1;

        return { hasQuad, hasTriple, hasTractor, hasTwoPairs, hasOnePair };
      };

      if (M === 2) {
        if (leadPattern.type === 'PAIR') {
          const handP = checkPriorities(handMatching);
          const selP = checkPriorities(selectedMatching);
          if (handP.hasOnePair && !selP.hasOnePair) return false;
        }
      } else if (M === 3) {
        if (leadPattern.type === 'TRIPLE') {
          const handP = checkPriorities(handMatching);
          const selP = checkPriorities(selectedMatching);
          if (handP.hasTriple) {
            if (!selP.hasTriple) return false;
          } else if (handP.hasOnePair) {
            if (!selP.hasOnePair) return false;
          }
        }
      } else if (M === 4) {
        const handP = checkPriorities(handMatching);
        const selP = checkPriorities(selectedMatching);
        if (leadPattern.type === 'TRACTOR') {
          if (handP.hasTractor) {
            if (!selP.hasTractor) return false;
          } else if (handP.hasTwoPairs) {
            if (!selP.hasTwoPairs) return false;
          } else if (handP.hasOnePair) {
            if (!selP.hasOnePair) return false;
          }
        } else if (leadPattern.type === 'QUAD') {
          if (handP.hasQuad) {
            if (!selP.hasQuad) return false;
          } else if (handP.hasTriple) {
            if (!selP.hasTriple) return false;
          } else if (handP.hasTractor) {
            if (!selP.hasTractor) return false;
          } else if (handP.hasTwoPairs) {
            if (!selP.hasTwoPairs) return false;
          } else if (handP.hasOnePair) {
            if (!selP.hasOnePair) return false;
          }
        } else {
          // Fallback, if there's any other 4-card lead pattern
          if (handP.hasQuad) {
            if (!selP.hasQuad) return false;
          } else if (handP.hasTriple) {
            if (!selP.hasTriple) return false;
          } else if (handP.hasTractor) {
            if (!selP.hasTractor) return false;
          } else if (handP.hasTwoPairs) {
            if (!selP.hasTwoPairs) return false;
          } else if (handP.hasOnePair) {
            if (!selP.hasOnePair) return false;
          }
        }
      } else if (M === 6 && leadPattern.type === 'BULLDOZER') {
        const handPriority = getPriorityForBulldozer6(handMatching, trumpSuit, level);
        const selectedPriority = getPriorityForBulldozer6(selectedMatching, trumpSuit, level);
        if (selectedPriority > handPriority) return false;
      } else if (M > 4 && (
          leadPattern.type === 'PAIR' || leadPattern.type === 'TRACTOR' || 
          leadPattern.type === 'TRIPLE' || leadPattern.type === 'BULLDOZER' || 
          leadPattern.type === 'QUAD' || leadPattern.type === 'PLANE')) {
        
        const componentSize = (leadPattern.type === 'PAIR' || leadPattern.type === 'TRACTOR') ? 2 : 
                              (leadPattern.type === 'TRIPLE' || leadPattern.type === 'BULLDOZER') ? 3 : 4;
        
        const handGroups: Record<number, number> = {};
        handMatching.forEach(c => {
          const w = this.getCardWeight(c, trumpSuit, level);
          handGroups[w] = (handGroups[w] || 0) + 1;
        });
        
        const targetComponents = Math.floor(leadPattern.count / componentSize);
        const handComponents = Object.values(handGroups).filter(count => count >= componentSize).length;
        
        const selGroups: Record<number, number> = {};
        selectedMatching.forEach(c => {
          const w = this.getCardWeight(c, trumpSuit, level);
          selGroups[w] = (selGroups[w] || 0) + 1;
        });
        const selectedComponents = Object.values(selGroups).filter(count => count >= componentSize).length;

        // Must match number of pairs/triples if you have them in the same suit
        if (selectedComponents < Math.min(targetComponents, handComponents)) return false;
      }
    }

    return true;
  },

  getWinner(trick: Trick, trumpSuit: Suit | null, level: Rank): PlayerPosition {
    const leader = trick.leader;
    const leadCards = trick.cards[leader];
    const leadPattern = this.getPattern(leadCards, trumpSuit, level);
    let winner = leader;
    const leadIsTrump = this.isTrump(leadCards?.[0], trumpSuit, level);
    const leadSuitLabel = leadIsTrump ? 'trump' : (leadCards?.[0]?.suit || 'spade');

    if (!leadCards || leadCards.length === 0) return winner;

    let bestWeight = leadPattern.primaryValue;
    let winnerIsTrump = leadIsTrump;

    // Chronologically evaluate players: from leader + 1, leader + 2, leader + 3.
    // Since we only override on STRICTLY GREATER weight, same cards will prioritize the earlier player.
    const playersInOrder = [
      ((leader + 1) % 4) as PlayerPosition,
      ((leader + 2) % 4) as PlayerPosition,
      ((leader + 3) % 4) as PlayerPosition
    ];

    playersInOrder.forEach(p => {
      const playerCards = trick.cards[p];
      if (!playerCards || playerCards.length !== leadCards.length) return;

      const pPattern = this.getPattern(playerCards, trumpSuit, level);
      const pIsTrump = this.isTrump(playerCards?.[0], trumpSuit, level);
      const pSuitLabel = pIsTrump ? 'trump' : (playerCards?.[0]?.suit || 'spade');

      // Rule: Mixed cards (NONE pattern) cannot win vs a valid pattern
      if (pPattern.type === 'NONE') return;

      // Rule: Must be same pattern type and length to compete
      const matchesPattern = pPattern.type === leadPattern.type && pPattern.length === leadPattern.length;
      if (!matchesPattern) return;

      if (pSuitLabel === leadSuitLabel) {
         if (pPattern.primaryValue > bestWeight) {
           winner = p;
           bestWeight = pPattern.primaryValue;
         }
      } else if (pIsTrump) {
         if (!winnerIsTrump) {
           winner = p;
           bestWeight = pPattern.primaryValue;
           winnerIsTrump = true;
         } else if (pPattern.primaryValue > bestWeight) {
           winner = p;
           bestWeight = pPattern.primaryValue;
         }
      }
    });

    return winner;
  },

  sortHand(hand: Card[], trumpSuit: Suit | null, level: Rank): Card[] {
    if (!hand) return [];
    return [...hand].sort((a, b) => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      
      const isATrump = this.isTrump(a, trumpSuit, level);
      const isBTrump = this.isTrump(b, trumpSuit, level);
      
      // 1. Both are trumps
      if (isATrump && isBTrump) {
        const wa = this.getCardWeight(a, trumpSuit, level);
        const wb = this.getCardWeight(b, trumpSuit, level);
        if (wa !== wb) return wb - wa;
        // Same weight trumps (e.g., same card from multiple decks), sort by suit for stability
        return (SUIT_VALUES[b.suit] || 0) - (SUIT_VALUES[a.suit] || 0);
      }
      
      // 2. One is trump, one isn't
      if (isATrump && !isBTrump) return -1;
      if (!isATrump && isBTrump) return 1;
      
      // 3. Both are non-trumps
      if (a.suit !== b.suit) {
        // Group by suit priority (Spade > Heart > Club > Diamond)
        return (SUIT_VALUES[b.suit] || 0) - (SUIT_VALUES[a.suit] || 0);
      }
      // Same suit, sort by rank weight
      const wa = this.getCardWeight(a, trumpSuit, level);
      const wb = this.getCardWeight(b, trumpSuit, level);
      return wb - wa;
    });
  }
};

// Internal helpers
export function areAdjacent(w1: number, w2: number, trumpSuit: Suit | null, level: Rank): boolean {
  const high = Math.max(w1, w2);
  const low = Math.min(w1, w2);

  // 1. Joker to Joker
  if (high === 1000 && low === 900) return true;
  // 3. Level Main to Level Sub
  if (high === 800 && low >= 785 && low <= 792) return true;
  // 4. Level Sub to Two Main
  if (high >= 785 && high <= 792 && low === 780) return true;
  // 5. Two Main to Two Sub
  if (high === 780 && low >= 765 && low <= 772) return true;

  // 6. Two Sub to Highest Standard Trump Card (A or K depending on level)
  if (high >= 765 && high <= 772 && low >= 500 && low <= 515) {
    const highestStandardRank = level === 'A' ? 'K' : 'A';
    const lowRankValue = low - 500;
    const targetRankValue = RANK_VALUES[highestStandardRank];
    if (lowRankValue === targetRankValue) {
      return true;
    }
  }

  // 7. Between Standard Trump Cards themselves (500 tier)
  if (high >= 500 && high <= 515 && low >= 500 && low <= 515) {
    const vHigh = high - 500;
    const vLow = low - 500;
    const rLevel = RANK_VALUES[level];
    if (vHigh - vLow === 1) return true;
    if (vHigh - vLow === 2 && vHigh > rLevel && vLow < rLevel) return true;
    return false;
  }

  // 8. Between Standard Non-Trump Cards (under 500)
  if (high < 500 && low < 500) {
    if (high - low === 1) return true;
    return false;
  }

  return false;
}

export function areCardsCompatibleAndAdjacent(c1: Card, c2: Card, trumpSuit: Suit | null, level: Rank): boolean {
  const isJoker1 = c1.suit === 'joker' || c1.rank === 'BJ' || c1.rank === 'SJ';
  const isJoker2 = c2.suit === 'joker' || c2.rank === 'BJ' || c2.rank === 'SJ';

  const w1 = NanningRules.getCardWeight(c1, trumpSuit, level);
  const w2 = NanningRules.getCardWeight(c2, trumpSuit, level);

  if (isJoker1 || isJoker2) {
    if (!areAdjacent(w1, w2, trumpSuit, level)) return false;
    if (isJoker1 && isJoker2) return true;
    if (isJoker1 && !isJoker2) {
      return trumpSuit !== null && c2.suit === trumpSuit;
    }
    return trumpSuit !== null && c1.suit === trumpSuit;
  }

  // Same-suit natural cycle adjacency: 2 <-> 3 <-> 4 <-> ... <-> Q <-> K <-> A <-> 2
  if (c1.suit === c2.suit) {
    const isTrump1 = NanningRules.isTrump(c1, trumpSuit, level);
    const isTrump2 = NanningRules.isTrump(c2, trumpSuit, level);
    if (isTrump1 === isTrump2) {
      const cycle = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
      const idx1 = cycle.indexOf(c1.rank);
      const idx2 = cycle.indexOf(c2.rank);
      if (idx1 >= 0 && idx2 >= 0) {
        const diff = Math.abs(idx1 - idx2);
        if (diff === 1 || diff === 12) {
          return true;
        }
      }
    }
  }

  // Weight-based fallback (must be of same suit)
  if (!areAdjacent(w1, w2, trumpSuit, level)) return false;
  return c1.suit === c2.suit;
}

function areWeightsCompatible(w1: number, w2: number, cards: Card[], trumpSuit: Suit | null, level: Rank): boolean {
  const c1 = cards.find(c => NanningRules.getCardWeight(c, trumpSuit, level) === w1);
  const c2 = cards.find(c => NanningRules.getCardWeight(c, trumpSuit, level) === w2);

  if (!c1 || !c2) return false;

  return areCardsCompatibleAndAdjacent(c1, c2, trumpSuit, level);
}

function isConsecutive(
  weights: number[], 
  targetLen: number, 
  freq: number, 
  groups: Record<number, number>, 
  trumpSuit: Suit | null, 
  level: Rank,
  cards: Card[]
): boolean {
  const validWeights = weights.filter(w => (groups[w] || 0) >= freq);
  if (validWeights.length < targetLen) return false;
  
  if (targetLen === 2) {
    if (validWeights.includes(1000) && validWeights.includes(900)) {
       if ((groups[1000] || 0) >= freq && (groups[900] || 0) >= freq) {
         if (areWeightsCompatible(1000, 900, cards, trumpSuit, level)) return true;
       }
    }
  }

  let count = 1;
  for (let i = 0; i < validWeights.length - 1; i++) {
     if (areWeightsCompatible(validWeights[i], validWeights[i+1], cards, trumpSuit, level)) {
       count++;
       if (count === targetLen) return true;
     } else {
       count = 1;
     }
  }
  return false;
}

export function getPriorityForBulldozer6(
  cards: Card[], 
  trumpSuit: Suit | null, 
  level: Rank
): number {
  if (cards.length < 6) return 8;

  const groups: Record<number, Card[]> = {};
  cards.forEach(c => {
    if (!c) return;
    const w = NanningRules.getCardWeight(c, trumpSuit, level);
    if (!groups[w]) groups[w] = [];
    groups[w].push(c);
  });

  const freqs: Record<number, number> = {};
  for (const w in groups) {
    freqs[Number(w)] = groups[w].length;
  }

  const sortedWeights = Object.keys(groups).map(Number).sort((a, b) => b - a);

  // 1. Check BULLDOZER: 2 consecutive triples
  const triples = sortedWeights.filter(w => (freqs[w] || 0) >= 3);
  let hasBulldozer = false;
  for (let i = 0; i < triples.length - 1; i++) {
    const w1 = triples[i];
    const w2 = triples[i+1];
    const c1 = groups[w1]?.[0];
    const c2 = groups[w2]?.[0];
    if (c1 && c2 && areCardsCompatibleAndAdjacent(c1, c2, trumpSuit, level)) {
      hasBulldozer = true;
      break;
    }
  }
  if (hasBulldozer) return 1;

  // 2. Check TWO_TRIPLES: 2 triples (not necessarily consecutive)
  if (triples.length >= 2) return 2;

  // 3. Check TRIPLE_PAIR_SINGLE: 1 triple + 1 pair + 1 single
  let hasTriplePair = false;
  for (const wTriple of triples) {
    freqs[wTriple] -= 3;
    const hasPair = Object.keys(freqs).some(w => freqs[Number(w)] >= 2);
    freqs[wTriple] += 3; // backtrack
    if (hasPair) {
      hasTriplePair = true;
      break;
    }
  }
  if (hasTriplePair) return 3;

  // 4. Check TRACTOR_PAIR: 2 consecutive pairs + 1 independent pair
  const pairs = sortedWeights.filter(w => (freqs[w] || 0) >= 2);
  let hasTractorPair = false;
  for (let i = 0; i < pairs.length - 1; i++) {
    const w1 = pairs[i];
    const w2 = pairs[i+1];
    const c1 = groups[w1]?.[0];
    const c2 = groups[w2]?.[0];
    if (c1 && c2 && areCardsCompatibleAndAdjacent(c1, c2, trumpSuit, level)) {
      freqs[w1] -= 2;
      freqs[w2] -= 2;
      const someOtherPair = Object.keys(freqs).some(w => freqs[Number(w)] >= 2);
      freqs[w1] += 2;
      freqs[w2] += 2; // backtrack
      if (someOtherPair) {
        hasTractorPair = true;
        break;
      }
    }
  }
  if (hasTractorPair) return 4;

  const countTotalPairs = () => {
    let sum = 0;
    for (const w in freqs) {
      sum += Math.floor(freqs[Number(w)] / 2);
    }
    return sum;
  };
  const totalPairs = countTotalPairs();

  // 5. Check THREE_PAIRS: 3 independent pairs
  if (totalPairs >= 3) return 5;

  // 6. Check TWO_PAIRS_TWO_SINGLES: 2 independent pairs
  if (totalPairs >= 2) return 6;

  // 7. Check ONE_PAIR_FOUR_SINGLES: 1 pair
  if (totalPairs >= 1) return 7;

  // 8. SIX_SINGLES
  return 8;
}
