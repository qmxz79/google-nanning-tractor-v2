import { Card, GameState, PlayerPosition, Bid, Suit, Rank, CardPattern } from '../types';
import { GeneralGameEngine } from '../engine/gameEngine';
import { NanningRules, areAdjacent, areCardsCompatibleAndAdjacent } from '../rules/nanningRules';

export const engine = new GeneralGameEngine(NanningRules);

function selectAIBulldozer6Cards(
  sameSuitCards: Card[],
  trumpSuit: Suit | null,
  level: Rank
): Card[] {
  const groups: Record<number, Card[]> = {};
  sameSuitCards.forEach(c => {
    const w = NanningRules.getCardWeight(c, trumpSuit, level);
    if (!groups[w]) groups[w] = [];
    groups[w].push(c);
  });

  const freqs: Record<number, number> = {};
  for (const w in groups) {
    freqs[Number(w)] = groups[w].length;
  }

  const sortedWeights = Object.keys(groups).map(Number).sort((a, b) => a - b); // Ascending order: play smaller cards first!

  const selectSingles = (count: number, exclude: Card[]): Card[] => {
    const remaining = sameSuitCards.filter(c => !exclude.includes(c));
    const sorted = remaining.sort((a, b) => NanningRules.getCardWeight(a, trumpSuit, level) - NanningRules.getCardWeight(b, trumpSuit, level));
    return sorted.slice(0, count);
  };

  // 1. Priority 1: BULLDOZER
  const triples = sortedWeights.filter(w => (freqs[w] || 0) >= 3);
  for (let i = 0; i < triples.length - 1; i++) {
    const w1 = triples[i];
    const w2 = triples[i+1];
    const c1 = groups[w1]?.[0];
    const c2 = groups[w2]?.[0];
    if (c1 && c2 && areCardsCompatibleAndAdjacent(c1, c2, trumpSuit, level)) {
      return [...groups[w1].slice(0, 3), ...groups[w2].slice(0, 3)];
    }
  }

  // 2. Priority 2: TWO_TRIPLES
  if (triples.length >= 2) {
    return [...groups[triples[0]].slice(0, 3), ...groups[triples[1]].slice(0, 3)];
  }

  // 3. Priority 3: TRIPLE_PAIR_SINGLE
  for (const wTriple of triples) {
    freqs[wTriple] -= 3;
    const pairWeights = Object.keys(freqs).map(Number).filter(w => (freqs[w] || 0) >= 2).sort((a, b) => a - b);
    freqs[wTriple] += 3; // backtrack
    if (pairWeights.length > 0) {
      const wPair = pairWeights[0];
      const tripleCards = groups[wTriple].slice(0, 3);
      const pairCards = groups[wPair].slice(0, 2);
      const chosen = [...tripleCards, ...pairCards];
      return [...chosen, ...selectSingles(1, chosen)];
    }
  }

  // 4. Priority 4: TRACTOR_PAIR
  const pairs = sortedWeights.filter(w => (freqs[w] || 0) >= 2);
  for (let i = 0; i < pairs.length - 1; i++) {
    const w1 = pairs[i];
    const w2 = pairs[i+1];
    const c1 = groups[w1]?.[0];
    const c2 = groups[w2]?.[0];
    if (c1 && c2 && areCardsCompatibleAndAdjacent(c1, c2, trumpSuit, level)) {
      freqs[w1] -= 2;
      freqs[w2] -= 2;
      const otherPairWeights = Object.keys(freqs).map(Number).filter(w => (freqs[w] || 0) >= 2).sort((a, b) => a - b);
      freqs[w1] += 2;
      freqs[w2] += 2; // backtrack
      if (otherPairWeights.length > 0) {
        const wPair = otherPairWeights[0];
        const tractorCards = [...groups[w1].slice(0, 2), ...groups[w2].slice(0, 2)];
        const pairCards = groups[wPair].slice(0, 2);
        return [...tractorCards, ...pairCards];
      }
    }
  }

  // 5. Priority 5: THREE_PAIRS
  if (pairs.length >= 3) {
    return [...groups[pairs[0]].slice(0, 2), ...groups[pairs[1]].slice(0, 2), ...groups[pairs[2]].slice(0, 2)];
  }

  // 6. Priority 6: TWO_PAIRS_TWO_SINGLES
  if (pairs.length >= 2) {
    const chosen = [...groups[pairs[0]].slice(0, 2), ...groups[pairs[1]].slice(0, 2)];
    return [...chosen, ...selectSingles(2, chosen)];
  }

  // 7. Priority 7: ONE_PAIR_FOUR_SINGLES
  if (pairs.length >= 1) {
    const chosen = groups[pairs[0]].slice(0, 2);
    return [...chosen, ...selectSingles(4, chosen)];
  }

  // 8. Priority 8: SIX_SINGLES
  return selectSingles(6, []);
}

function selectAICardsOfSuit(
  sameSuitCards: Card[],
  targetCount: number,
  trumpSuit: Suit | null,
  level: Rank,
  leadPattern: CardPattern
): Card[] {
  const M = Math.min(targetCount, sameSuitCards.length);
  if (M === 0) return [];

  if (M === 6 && leadPattern.type === 'BULLDOZER') {
    return selectAIBulldozer6Cards(sameSuitCards, trumpSuit, level);
  }

  const groups: Record<number, Card[]> = {};
  sameSuitCards.forEach(c => {
    const w = NanningRules.getCardWeight(c, trumpSuit, level);
    if (!groups[w]) groups[w] = [];
    groups[w].push(c);
  });

  const sortedWeights = Object.keys(groups).map(Number).sort((a, b) => a - b); // ascending

  const selectSingles = (count: number, exclude: Card[]): Card[] => {
    const remaining = sameSuitCards.filter(c => !exclude.includes(c));
    const sorted = remaining.sort((a, b) => NanningRules.getCardWeight(a, trumpSuit, level) - NanningRules.getCardWeight(b, trumpSuit, level));
    return sorted.slice(0, count);
  };

  if (M === 2) {
    // Priority 1: A pair
    for (const w of sortedWeights) {
      if (groups[w].length >= 2) {
        return groups[w].slice(0, 2);
      }
    }
    return selectSingles(2, []);
  }

  if (M === 3) {
    // Priority 1: A triple
    for (const w of sortedWeights) {
      if (groups[w].length >= 3) {
        return groups[w].slice(0, 3);
      }
    }
    // Priority 2: A pair + 1 single
    for (const w of sortedWeights) {
      if (groups[w].length >= 2) {
        const pair = groups[w].slice(0, 2);
        return [...pair, ...selectSingles(1, pair)];
      }
    }
    return selectSingles(3, []);
  }

  if (M === 4) {
    if (leadPattern.type === 'TRACTOR') {
      // 1. Tractor
      const pairs = sortedWeights.filter(w => groups[w].length >= 2);
      for (let i = 0; i < pairs.length - 1; i++) {
        const c1 = groups[pairs[i]]?.[0];
        const c2 = groups[pairs[i+1]]?.[0];
        if (c1 && c2 && areCardsCompatibleAndAdjacent(c1, c2, trumpSuit, level)) {
          return [...groups[pairs[i]].slice(0, 2), ...groups[pairs[i+1]].slice(0, 2)];
        }
      }
      // 2. Two pairs
      if (pairs.length >= 2) {
        return [...groups[pairs[0]].slice(0, 2), ...groups[pairs[1]].slice(0, 2)];
      }
      // 3. One pair + 2 singles
      if (pairs.length >= 1) {
        const pair = groups[pairs[0]].slice(0, 2);
        return [...pair, ...selectSingles(2, pair)];
      }
      // 4. Four singles
      return selectSingles(4, []);
    } else {
      // 1. Quad
      for (const w of sortedWeights) {
        if (groups[w].length >= 4) {
          return groups[w].slice(0, 4);
        }
      }
      // 2. Triple + 1 single
      for (const w of sortedWeights) {
        if (groups[w].length >= 3) {
          const triple = groups[w].slice(0, 3);
          return [...triple, ...selectSingles(1, triple)];
        }
      }
      // 3. Tractor (Consecutive pairs)
      const pairs = sortedWeights.filter(w => groups[w].length >= 2);
      for (let i = 0; i < pairs.length - 1; i++) {
        const c1 = groups[pairs[i]]?.[0];
        const c2 = groups[pairs[i+1]]?.[0];
        if (c1 && c2 && areCardsCompatibleAndAdjacent(c1, c2, trumpSuit, level)) {
          return [...groups[pairs[i]].slice(0, 2), ...groups[pairs[i+1]].slice(0, 2)];
        }
      }
      // 4. Two pairs
      if (pairs.length >= 2) {
        return [...groups[pairs[0]].slice(0, 2), ...groups[pairs[1]].slice(0, 2)];
      }
      // 5. One pair + 2 singles
      if (pairs.length >= 1) {
        const pair = groups[pairs[0]].slice(0, 2);
        return [...pair, ...selectSingles(2, pair)];
      }
      // 6. Four singles
      return selectSingles(4, []);
    }
  }

  // Fallback for M > 4: try to play as many high-frequency components as possible
  let componentSize = 1;
  if (leadPattern.type === 'TRACTOR' || leadPattern.type === 'PAIR') componentSize = 2;
  else if (leadPattern.type === 'BULLDOZER' || leadPattern.type === 'TRIPLE') componentSize = 3;
  else if (leadPattern.type === 'PLANE' || leadPattern.type === 'QUAD') componentSize = 4;

  if (componentSize > 1) {
    const components: Card[] = [];
    const validGroupWeights = sortedWeights.filter(w => groups[w].length >= componentSize);
    for (const w of validGroupWeights) {
      if (components.length + componentSize <= M) {
        components.push(...groups[w].slice(0, componentSize));
      }
    }
    if (components.length < M) {
      components.push(...selectSingles(M - components.length, components));
    }
    return components;
  }

  return selectSingles(M, []);
}

export function playAICards(
  player: PlayerPosition, 
  state: GameState
): Card[] {
  const hand = state.hands[player];
  const trick = state.currentTrick;
  
  // 1. Leader Case
  if (!trick || !trick.cards[trick.leader] || trick.cards[trick.leader].length === 0) {
    if (hand.length === 0) return [];
    
    // AI Lead Strategy: Try to lead a pair first
    const groups: Record<string, Card[]> = {};
    hand.forEach(c => {
      const key = `${c.suit}-${c.rank}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });

    const pairs = Object.values(groups).filter(g => g.length >= 2);
    if (pairs.length > 0) {
      // Pick a pair (sort by weight to lead small pairs first or big ones? Usually small to draw out trumps)
      return pairs[0].slice(0, 2);
    }

    return [hand[0]]; 
  }

  // 2. Follower Case
  const leadCards = trick.cards[trick.leader];
  if (!leadCards || leadCards.length === 0 || !leadCards[0]) return hand.length > 0 ? [hand[0]] : [];

  const targetCount = leadCards.length;
  const leadIsTrump = NanningRules.isTrump(leadCards[0], state.trumpSuit, state.trumpLevel);
  const leadSuit = leadIsTrump ? 'trump' : (leadCards[0]?.suit || 'spade');
  const leadPattern = NanningRules.getPattern(leadCards, state.trumpSuit, state.trumpLevel);

  const sameSuitCards = hand.filter(c => {
    if (!c) return false;
    const isT = NanningRules.isTrump(c, state.trumpSuit, state.trumpLevel);
    const s = isT ? 'trump' : c.suit;
    return s === leadSuit;
  });

  const matchingCardsToPlay: Card[] = [];
  
  if (sameSuitCards.length > 0) {
    matchingCardsToPlay.push(...selectAICardsOfSuit(sameSuitCards, targetCount, state.trumpSuit, state.trumpLevel, leadPattern));
  }

  // Fill the rest with other cards if we couldn't play enough matching cards
  if (matchingCardsToPlay.length < targetCount) {
    const others = hand.filter(c => !matchingCardsToPlay.includes(c));
    const needed = targetCount - matchingCardsToPlay.length;
    // Just play smallest other cards to protect high cards
    const sortedOthers = others.sort((a, b) => NanningRules.getCardWeight(a, state.trumpSuit, state.trumpLevel) - NanningRules.getCardWeight(b, state.trumpSuit, state.trumpLevel));
    matchingCardsToPlay.push(...sortedOthers.slice(0, needed));
  }

  return matchingCardsToPlay;
}

export function getPossibleBids(hand: Card[], level: string): Bid[] {
  // Simplified bidding for now
  return [];
}

export function aiSelectBottomCards(
  hand: Card[],
  trumpSuit: Suit | null,
  level: Rank,
  count: number = 8
): Card[] {
  const isPoint = (c: Card) => c ? (c.rank === '5' || c.rank === '10' || c.rank === 'K') : false;
  const isTrump = (c: Card) => c ? NanningRules.isTrump(c, trumpSuit, level) : false;

  const categorized = hand.filter(Boolean).map(c => {
    const trump = isTrump(c);
    const pt = isPoint(c);
    const weight = NanningRules.getCardWeight(c, trumpSuit, level);

    // Discard Priority: lower score means we want to discard it.
    // Category 0: Non-trump, non-point (Score: weight)
    // Category 1: Non-trump, point (Score: 1000 + weight)
    // Category 2: Trump, non-point (Score: 2000 + weight)
    // Category 3: Trump, point (Score: 3000 + weight)
    let categoryScore = 0;
    if (trump && pt) {
      categoryScore = 3000 + weight;
    } else if (trump) {
      categoryScore = 2000 + weight;
    } else if (pt) {
      categoryScore = 1000 + weight;
    } else {
      categoryScore = weight;
    }

    return { card: c, score: categoryScore };
  });

  // Sort by score ascending (lowest score first, meaning most desirable to discard)
  categorized.sort((a, b) => a.score - b.score);

  return categorized.slice(0, count).map(x => x.card);
}
