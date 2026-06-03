import React from 'react';
import { Card as CardType } from '../types';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';

interface PlayingCardProps {
  card?: CardType; // Make optional for purely hidden cards
  hidden?: boolean;
  isSelected?: boolean;
  isTrump?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

const suitSymbols: Record<CardType['suit'], string> = {
  spade: '♠',
  heart: '♥',
  club: '♣',
  diamond: '♦',
  joker: '',
};

const suitColors: Record<CardType['suit'], string> = {
  spade: 'text-[#0a0c0b]',
  heart: 'text-[#b91c1c]',
  club: 'text-[#0a0c0b]',
  diamond: 'text-[#b91c1c]',
  joker: '',
};

export const PlayingCard: React.FC<PlayingCardProps> = ({ card, hidden, isSelected, isTrump, onClick, className, style }) => {
  if (hidden) {
    return (
      <div
        className={cn(
          "relative w-12 h-18 sm:w-16 sm:h-24 md:w-20 md:h-28 landscape:w-10 landscape:h-14 sm:landscape:w-12 sm:landscape:h-16 md:landscape:w-14 md:landscape:h-20 font-sans",
          "bg-[#1a251e] border-2 border-[#d4af3740] rounded-lg shadow-xl overflow-hidden",
          className
        )}
        style={style}
      >
        <div className="absolute inset-1 border border-[#d4af3720] rounded-md flex items-center justify-center">
          <div className="w-full h-full opacity-10" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #d4af37 0, #d4af37 1px, transparent 0, transparent 50%)', backgroundSize: '10px 10px' }}></div>
          <div className="absolute inset-0 flex items-center justify-center opacity-30">
            <span className="text-gold text-2xl font-serif italic">NN</span>
          </div>
        </div>
      </div>
    );
  }

  if (!card) return null;
  const isJoker = card.suit === 'joker';
  const colorClass = isJoker 
    ? (card.rank === 'BJ' ? 'text-red-500' : 'text-neutral-600') 
    : suitColors[card.suit];
    
  const displayRank = isJoker ? (card.rank === 'BJ' ? 'JOKER' : 'joker') : card.rank;
  const displaySuit = suitSymbols[card.suit];

  return (
    <motion.div
      onClick={onClick}
      initial={{ y: 0 }}
      animate={{ y: isSelected ? -6 : 0 }}
      whileHover={{ y: isSelected ? -6 : -3 }}
      className={cn(
        "relative w-12 h-18 sm:w-16 sm:h-24 md:w-20 md:h-28 landscape:w-10 landscape:h-14 sm:landscape:w-12 sm:landscape:h-16 md:landscape:w-14 md:landscape:h-20 font-sans",
        "bg-[#e0d8cc] rounded-lg shadow-2xl flex flex-col select-none cursor-pointer transform-gpu transition-all",
        isSelected ? "ring-2 ring-[#d4af37] ring-offset-2 ring-offset-black/20" : "border border-[#00000020]",
        isTrump && !isSelected && "border-2 border-red-500/40",
        colorClass,
        className
      )}
      style={style}
    >
      <div className="absolute top-0.5 left-1 sm:top-1 sm:left-1.5 flex flex-col items-center leading-none">
        <span className={cn("font-extrabold tracking-tighter", isJoker ? "text-[10px] tracking-widest writing-vertical-lr rotate-180" : "text-[11px] sm:text-sm md:text-base")}>
          {displayRank}
        </span>
        {!isJoker && <span className="text-[12px] sm:text-base md:text-[18px] -mt-0.5 sm:-mt-1">{displaySuit}</span>}
      </div>
      
      {isTrump && (
        <div className="absolute top-1 right-1 px-1 bg-red-500 text-white rounded-[2px] scale-50 origin-top-right">
          <span className="text-[10px] font-black uppercase leading-none">主</span>
        </div>
      )}
      
      {!isJoker && (
        <div className="absolute bottom-1 right-1.5 flex flex-col items-center leading-none rotate-180">
          <span className="font-bold text-sm sm:text-base md:text-lg">{displayRank}</span>
          <span className="text-sm sm:text-base md:text-xl -mt-1">{displaySuit}</span>
        </div>
      )}
      
      {/* Center graphic could go here, omitting for simplicity/cleanliness */}
      <div className="flex-1 flex items-center justify-center pointer-events-none opacity-20">
         <span className={cn("text-3xl sm:text-4xl md:text-5xl", isJoker ? "writing-vertical-lr" : "")}>
           {isJoker ? (card.rank === 'BJ' ? '🃏' : '🃏') : displaySuit}
         </span>
      </div>
    </motion.div>
  );
};
