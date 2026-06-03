import React, { useState } from 'react';
import { Card as CardType, Bid, Suit, Rank, GamePhase } from '../types';
import { PlayingCard } from './PlayingCard';
import { NanningRules } from '../rules/nanningRules';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface HandProps {
  cards: CardType[];
  className?: string;
  onPlay?: (selectedCards: CardType[]) => void;
  isDealing?: boolean;
  possibleBids?: Bid[];
  onBid?: (bid: Bid) => void;
  playDisabled?: boolean;
  playActionLabel?: string;
  requiredSelectionCount?: number;
  trumpSuit: Suit | null;
  trumpLevel: Rank;
  phase?: GamePhase;
  onHint?: () => CardType[];
}

export const Hand: React.FC<HandProps> = ({ cards, className, onPlay, isDealing, possibleBids = [], onBid, playDisabled, playActionLabel = '出牌', requiredSelectionCount, trumpSuit, trumpLevel, phase, onHint }) => {
  // Deduplicate cards by ID to prevent key collisions
  const safeCards = React.useMemo(() => {
    const seen = new Set<string>();
    const filtered = (cards || []).filter(c => {
      if (!c || !c.id || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
    // Reverse so the "last" cards (usually higher) are in the front row or etc? 
    // Actually standard sorting is fine.
    return filtered;
  }, [cards]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  React.useEffect(() => {
    setSelectedIds(new Set());
  }, [cards.length, playDisabled]);

  const handleHintClick = () => {
    if (!onHint) return;
    const recommended = onHint();
    if (recommended && recommended.length > 0) {
      const next = new Set<string>();
      recommended.forEach(c => {
        if (c && c.id) {
          next.add(c.id);
        }
      });
      setSelectedIds(next);
    }
  };

  // Swipe-to-Select state tracking for mobile touch screens
  const touchStartRef = React.useRef<{
    isDragging: boolean;
    initialAction: 'select' | 'deselect' | null;
    draggedIds: Set<string>;
  }>({
    isDragging: false,
    initialAction: null,
    draggedIds: new Set(),
  });

  const toggleSelect = (id: string | undefined) => {
    if (!id) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleTouchStart = (e: React.TouchEvent, cardId: string) => {
    e.preventDefault(); // crucial to prevent simulated mouse click, tap lag, and page scrolling while dragging cards
    const isSelected = selectedIds.has(cardId);
    const originAction = isSelected ? 'deselect' : 'select';

    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });

    touchStartRef.current = {
      isDragging: true,
      initialAction: originAction,
      draggedIds: new Set([cardId]),
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current.isDragging) return;
    const touch = e.touches[0];
    if (!touch) return;

    // Retrieve the HTML element directly under the user's current finger position
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!element) return;

    // Search up the DOM tree for our card container with the associated card id
    const cardContainer = element.closest('[data-card-id]');
    if (cardContainer) {
      const cardId = cardContainer.getAttribute('data-card-id');
      if (cardId && !touchStartRef.current.draggedIds.has(cardId)) {
        touchStartRef.current.draggedIds.add(cardId);

        const targetAction = touchStartRef.current.initialAction;
        setSelectedIds(prev => {
          const next = new Set(prev);
          if (targetAction === 'select') {
            next.add(cardId);
          } else if (targetAction === 'deselect') {
            next.delete(cardId);
          }
          return next;
        });
      }
    }
  };

  const handleTouchEnd = () => {
    touchStartRef.current = {
      isDragging: false,
      initialAction: null,
      draggedIds: new Set(),
    };
  };

  const handlePlay = () => {
    if (playDisabled) return;
    if (onPlay && selectedIds.size > 0) {
      const selectedCards = safeCards.filter(c => selectedIds.has(c.id));
      onPlay(selectedCards);
      setSelectedIds(new Set()); // Reset after passing
    }
  };

  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    isMobile: typeof window !== 'undefined' ? window.innerWidth < 768 : false,
    isLandscape: typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : true,
  });

  React.useEffect(() => {
    const handleResize = () => {
      const isPhysicalPortrait = window.innerWidth < window.innerHeight;
      const isForcedLandscape = isPhysicalPortrait && window.innerWidth < 820;
      
      if (isForcedLandscape) {
        setDimensions({
          width: window.innerHeight,
          isMobile: true,
          isLandscape: true,
        });
      } else {
        setDimensions({
          width: window.innerWidth,
          isMobile: window.innerWidth < 768,
          isLandscape: window.innerWidth > window.innerHeight,
        });
      }
    };
    handleResize(); // initial check
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const cardsPerRow = dimensions.isLandscape ? 27 : 18;

  const rowCount = Math.max(1, Math.ceil(safeCards.length / cardsPerRow));
  const rows = Array.from({ length: rowCount }, (_, i) => {
    return safeCards.slice(i * cardsPerRow, (i + 1) * cardsPerRow);
  });

  const getCardWidth = () => {
    if (dimensions.isMobile) {
      if (dimensions.isLandscape) {
        return 42; // Perfect tiny size for rotated mobile viewports
      }
      return dimensions.width >= 400 ? 52 : 46; // Perfect layout sizing for portrait mobile
    }
    // For desktop:
    if (dimensions.width >= 1200) {
      return 66; // Compact desktop size to maximize table area
    }
    return 56; // Sub-desktop/medium window size
  };

  // Calculate bid options
  const normalBids = possibleBids.filter(b => b.suit !== 'joker');

  const isPlayButtonDisabled = playDisabled || (requiredSelectionCount !== undefined && selectedIds.size !== requiredSelectionCount) || selectedIds.size === 0;

  const cardWidth = getCardWidth();
  const cardHeight = cardWidth * 1.4;

  const showToolbar = !phase || phase === 'BOTTOM_REPLACEMENT' || phase === 'PLAYING';
  const isMyTurn = !playDisabled && phase === 'PLAYING';
  const showActionHub = showToolbar && (selectedIds.size > 0 || (isMyTurn && onHint));

  return (
    <div className={cn("relative w-full flex flex-col items-center pb-0 select-none touch-none", className)}>
      {/* Floating Compact Action Hub - Displayed only when cards are selected or on active turning to be completely non-blocking */}
      <AnimatePresence>
        {showActionHub && (
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className="absolute -top-14 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 bg-black/95 border border-[#d4af37]/45 px-4 py-2 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.85)] backdrop-blur-md pointer-events-auto ring-1 ring-white/5"
          >
            {isMyTurn && onHint && (
              <>
                <button
                  className="px-3 py-1 bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black rounded-lg font-black tracking-wide text-xs transition-all cursor-pointer whitespace-nowrap shadow-[0_0_8px_rgba(245,158,11,0.3)] active:scale-95"
                  onClick={handleHintClick}
                >
                  提示
                </button>
                <div className="w-[1px] h-3 bg-white/20" />
              </>
            )}

            {selectedIds.size > 0 ? (
              <>
                <button
                  className="px-2.5 py-1 bg-white/5 hover:bg-white/12 active:scale-95 text-white/95 rounded-lg font-medium tracking-wide text-xs transition-all cursor-pointer border border-white/5 whitespace-nowrap"
                  onClick={() => setSelectedIds(new Set())}
                >
                  重置
                </button>
                <div className="w-[1px] h-3 bg-white/20" />
                <span className="text-xs text-white/70 whitespace-nowrap font-medium select-none">
                  已选 <span className="text-amber-400 font-bold">{selectedIds.size}</span> 张 {requiredSelectionCount ? `/ 需 ${requiredSelectionCount} 张` : ''}
                </span>
                <div className="w-[1px] h-3 bg-white/20" />
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  className={cn(
                    "px-4 py-1 rounded-lg font-black tracking-wider text-xs transition-all flex items-center gap-1.5 cursor-pointer shadow-md",
                    isPlayButtonDisabled
                      ? "bg-stone-850 text-stone-550 border border-stone-800 cursor-not-allowed select-none opacity-50"
                      : "bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black shadow-[0_0_12px_rgba(212,175,55,0.4)] border border-amber-300"
                  )}
                  onClick={handlePlay}
                  disabled={isPlayButtonDisabled}
                >
                  <span>{playActionLabel}</span>
                  <span className="text-[10px] bg-black/10 px-1 rounded-md font-bold">
                    {selectedIds.size}
                  </span>
                </motion.button>
              </>
            ) : (
              <span className="text-xs text-amber-400/90 whitespace-nowrap font-bold select-none px-2 animate-pulse">
                轮到您出牌了
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col items-center w-full max-w-[100vw] px-1 sm:px-8">
        {rows.map((row, rowIndex) => {
          const isFirstRow = rowIndex === 0;
          const mtValue = isFirstRow ? '0px' : `-${Math.floor(cardHeight * 0.35)}px`;
          
          return (
            <div 
              key={rowIndex} 
              className={cn("flex justify-center w-full relative")} 
              style={{ zIndex: rowIndex + 1, marginTop: mtValue }} // Higher rowIndex (bottom row) has higher zIndex
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              {row.filter(Boolean).map((card, index) => {
                 const cardId = card?.id;
                 if (!cardId) return null;
                 const isSelected = selectedIds.has(cardId);
                 const isHovered = hoveredId === cardId;
                 const isTrump = NanningRules.isTrump(card, trumpSuit, trumpLevel);
                 
                 // Dynamic hand layout spacing calculation to prevent clumping
                 const availWidth = dimensions.width * (dimensions.isMobile ? 0.94 : 0.88);
                 const N = row.length;
                 
                 let visibleWidth = cardWidth;
                 if (N > 1) {
                   const calculatedVisibleWidth = (availWidth - cardWidth) / (N - 1);
                   const minVisible = cardWidth * 0.18; // Maintain readable minimum width
                   const maxVisible = cardWidth;        // No overlap needed if there is plenty of room
                   visibleWidth = Math.max(minVisible, Math.min(maxVisible, calculatedVisibleWidth));
                 }
                 const overlap = cardWidth - visibleWidth;
                 const marginValue = index === 0 ? 0 : `-${overlap}px`;

                 return (
                    <div 
                      key={cardId} 
                      data-card-id={cardId}
                      className={cn(
                        "relative shrink-0 transition-all duration-150 transform-gpu cursor-pointer",
                        isHovered && "scale-[1.03] z-[500]"
                      )}
                      style={{ 
                        zIndex: isHovered ? 500 : (isSelected ? 200 + index : index),
                        marginLeft: marginValue,
                        width: cardWidth,
                        height: cardHeight
                      }}
                      onMouseEnter={() => setHoveredId(cardId)}
                      onMouseLeave={() => setHoveredId(null)}
                      onTouchStart={(e) => handleTouchStart(e, cardId)}
                      onClick={() => toggleSelect(cardId)}
                   >
                     <PlayingCard 
                       card={card} 
                       className="origin-bottom shadow-xl pointer-events-none"
                       style={{ width: cardWidth, height: cardHeight }}
                       isSelected={isSelected}
                       isTrump={isTrump}
                     />
                   </div>
                 )
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
