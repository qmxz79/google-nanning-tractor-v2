import { Card, Suit, Rank } from '../types';

const suits: Suit[] = ['spade', 'heart', 'club', 'diamond'];
const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/**
 * Generate decks of standard playing cards with Jokers.
 * For Nanning Tractor, numDecks is 4.
 */
export function generateDecks(numDecks: number = 4): Card[] {
  const deck: Card[] = [];
  const sessionPrefix = Math.random().toString(36).substring(2, 7);
  let idCounter = 0;
  for (let d = 0; d < numDecks; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ id: `card-${sessionPrefix}-${idCounter++}-${suit}-${rank}`, suit, rank });
      }
    }
    deck.push({ id: `card-${sessionPrefix}-${idCounter++}-joker-SJ`, suit: 'joker', rank: 'SJ' });
    deck.push({ id: `card-${sessionPrefix}-${idCounter++}-joker-BJ`, suit: 'joker', rank: 'BJ' });
  }
  return deck;
}

export function shuffle(deck: Card[]): Card[] {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
}

/**
 * Order of suits for standard sorting
 */
const SUIT_SORT_ORDER: Record<Suit, number> = {
  joker: 4,
  spade: 3,
  heart: 2,
  club: 1,
  diamond: 0,
};

/**
 * Order of ranks for standard sorting
 */
const RANK_SORT_ORDER: Record<Rank, number> = {
  'BJ': 15,
  'SJ': 14,
  'A': 13,
  'K': 12,
  'Q': 11,
  'J': 10,
  '10': 9,
  '9': 8,
  '8': 7,
  '7': 6,
  '6': 5,
  '5': 4,
  '4': 3,
  '3': 2,
  '2': 1,
};

/**
 * Basic hand sorting (Spade -> Heart -> Club -> Diamond -> Jokers)
 * In a real game, this needs to account for current level rank and current trump suit making them higher priority.
 */
export function sortHand(hand: Card[], currentLevelRank: Rank = '3', trumpSuit: Suit | null = null): Card[] {
  const filteredHand = (hand || []).filter(Boolean);
  return [...filteredHand].sort((a, b) => {
    if (!a || !b) return 0;
    // 1. Jokers are highest
    if (a.suit === 'joker' && b.suit !== 'joker') return 1;
    if (a.suit !== 'joker' && b.suit === 'joker') return -1;
    
    // Jokers compare to each other
    if (a.suit === 'joker' && b.suit === 'joker') {
       return RANK_SORT_ORDER[a.rank] - RANK_SORT_ORDER[b.rank];
    }
    
    // 2. Level Rank (正级牌)
    const aIsLevel = a.rank === currentLevelRank;
    const bIsLevel = b.rank === currentLevelRank;
    if (aIsLevel && !bIsLevel) return 1;
    if (!aIsLevel && bIsLevel) return -1;
    if (aIsLevel && bIsLevel) {
      // Both are level. Check if one is trump suit (正级牌), one is off-suit (副级牌)
      if (a.suit === trumpSuit && b.suit !== trumpSuit) return 1;
      if (a.suit !== trumpSuit && b.suit === trumpSuit) return -1;
      // If both same trump status, fall back to predefined suit order Spades>Hearts>Clubs>Diamonds
      return SUIT_SORT_ORDER[a.suit] - SUIT_SORT_ORDER[b.suit];
    }
    
    // 3. Rank 2 (正2/副2)
    const aIsTwo = a.rank === '2';
    const bIsTwo = b.rank === '2';
    if (aIsTwo && !bIsTwo) return 1;
    if (!aIsTwo && bIsTwo) return -1;
    if (aIsTwo && bIsTwo) {
       if (a.suit === trumpSuit && b.suit !== trumpSuit) return 1;
       if (a.suit !== trumpSuit && b.suit === trumpSuit) return -1;
       return SUIT_SORT_ORDER[a.suit] - SUIT_SORT_ORDER[b.suit];
    }

    // 4. Trump Suit cards (主花色)
    const aIsTrump = a.suit === trumpSuit;
    const bIsTrump = b.suit === trumpSuit;
    if (aIsTrump && !bIsTrump) return 1;
    if (!aIsTrump && bIsTrump) return -1;

    // 5. Normal suit grouping & rank within suit
    if (a.suit !== b.suit) {
      return SUIT_SORT_ORDER[a.suit] - SUIT_SORT_ORDER[b.suit];
    }
    return RANK_SORT_ORDER[a.rank] - RANK_SORT_ORDER[b.rank];
  });
}
