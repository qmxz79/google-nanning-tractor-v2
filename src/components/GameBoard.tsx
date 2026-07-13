import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card as CardType, GameState, PlayerPosition, Trick, Rank, TeamState } from '../types';
import { Hand } from './Hand';
import { PlayingCard } from './PlayingCard';
import { engine, playAICards, aiSelectBottomCards } from '../lib/gameLogic';
import { GamePhase } from '../types';
import { NanningRules } from '../rules/nanningRules';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { MultiplayerLobby } from './MultiplayerLobby';

const makeComboFriendlyDeck = (deck: CardType[], bottomCount: number) => {
  const playerCount = 4;
  const dealCount = deck.length - bottomCount;
  const target = Math.floor(dealCount / playerCount);
  const hands: CardType[][] = [[], [], [], []];
  const bottom = deck.slice(dealCount);
  const groups = new Map<string, CardType[]>();

  for (const card of deck.slice(0, dealCount)) {
    const key = `${card.suit}-${card.rank}`;
    groups.set(key, [...(groups.get(key) || []), card]);
  }

  const takePlayer = (size: number) => {
    const candidates = hands.map((h, i) => ({ i, room: target - h.length })).filter(x => x.room >= size);
    const pool = candidates.length ? candidates : hands.map((h, i) => ({ i, room: target - h.length }));
    pool.sort((a, b) => b.room - a.room || Math.random() - 0.5);
    return pool[0].i;
  };

  const addChunk = (cards: CardType[]) => {
    if (!cards.length) return;
    if (!hands.some(h => target - h.length >= cards.length) && cards.length > 1) {
      cards.forEach(card => addChunk([card]));
      return;
    }
    hands[takePlayer(cards.length)].push(...cards);
  };

  // ponytail: fair entertainment shuffle; bundles nearby duplicates so everyone gets more pairs/tractors.
  const ranks: CardType['rank'][] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  for (const suit of ['spade', 'heart', 'club', 'diamond'] as const) {
    for (let i = 0; i < ranks.length - 1; i += 2) {
      const a = groups.get(`${suit}-${ranks[i]}`) || [];
      const b = groups.get(`${suit}-${ranks[i + 1]}`) || [];
      if (a.length >= 2 && b.length >= 2 && Math.random() < 0.55) {
        addChunk([...a.splice(0, 2), ...b.splice(0, 2)]);
      }
    }
  }

  Array.from(groups.values()).sort(() => Math.random() - 0.5).forEach(group => {
    while (group.length) addChunk(group.splice(0, group.length >= 3 && Math.random() < 0.35 ? 3 : Math.min(2, group.length)));
  });

  const rebuilt: CardType[] = [];
  for (let i = 0; i < target; i++) {
    for (let p = 0; p < playerCount; p++) {
      const card = hands[p][i];
      if (card) rebuilt.push(card);
    }
  }
  return [...rebuilt, ...bottom];
};

export const GameBoard: React.FC = () => {
  // Online Multiplayer State
  const [multiplayerMode, setMultiplayerMode] = useState<'offline' | 'online' | null>(null);
  const [socket, setSocket] = useState<any>(null);
  const [roomId, setRoomId] = useState('');
  const [localPlayerIndex, setLocalPlayerIndex] = useState<PlayerPosition>(0);
  const [lobbyPlayers, setLobbyPlayers] = useState<any[]>([]);
  const [isHost, setIsHost] = useState(false);
  const isUpdatingFromNetwork = useRef(false);

  const [gameState, setGameState] = useState<GameState>(engine.initGameState(0, '3', '3'));
  const [isDealing, setIsDealing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [collectCountdown, setCollectCountdown] = useState<number | null>(null);
  const [autoCollect, setAutoCollect] = useState(true);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [isLastTrickModalOpen, setIsLastTrickModalOpen] = useState(false);

  // Wrapper helper to sync state changes to rooms
  const updateStateAndSync = useCallback((updater: any) => {
    setGameState(prev => {
      const nextState = typeof updater === 'function' ? updater(prev) : updater;
      if (multiplayerMode === 'online' && socket && !isUpdatingFromNetwork.current) {
        socket.emit("sync_game_state", { roomId, gameState: nextState });
      }
      return nextState;
    });
  }, [multiplayerMode, socket, roomId]);

  // Handle socket.io updates and reconnection listeners
  useEffect(() => {
    if (!socket || multiplayerMode !== 'online') return;

    socket.on('room_players_updated', (players: any[]) => {
      setLobbyPlayers(players);
      const myP = players.find(p => p.socketId === socket.id);
      if (myP) {
        setLocalPlayerIndex(myP.position as PlayerPosition);
        setIsHost(myP.isHost);
      }
    });

    socket.on('game_state_updated', (incomingState: any) => {
      isUpdatingFromNetwork.current = true;
      setGameState(incomingState);
      // Automatically reset if phase changed to DEALING or BOTTOM_REPLACEMENT etc.
      if (incomingState.phase === 'DEALING') {
        setIsDealing(true);
      } else {
        setIsDealing(false);
      }
      // Also sync settings views
      setShowSettings(false);
      // Reset the flag synchronously in microtask or after render
      setTimeout(() => {
        isUpdatingFromNetwork.current = false;
      }, 50);
    });

    socket.on('game_restarted', () => {
      isUpdatingFromNetwork.current = true;
      setGameState(engine.initGameState(0, '3', '3'));
      setIsDealing(false);
      setShowSettings(false);
      setTimeout(() => {
        isUpdatingFromNetwork.current = false;
      }, 50);
    });

    return () => {
      socket.off('room_players_updated');
      socket.off('game_state_updated');
      socket.off('game_restarted');
    };
  }, [socket, multiplayerMode]);

  const handleJoinMultiplayerSuccess = (
    socketInstance: any, 
    code: string, 
    position: number, 
    name: string, 
    creator: boolean,
    initialPlayers?: any[],
    initialState?: any
  ) => {
    setSocket(socketInstance);
    setRoomId(code);
    setLocalPlayerIndex(position as PlayerPosition);
    setIsHost(creator);
    setMultiplayerMode('online');
    
    if (initialPlayers) {
      setLobbyPlayers(initialPlayers);
    }
    
    if (initialState) {
      setGameState(initialState);
      if (initialState.phase === 'DEALING') {
        setIsDealing(true);
      } else {
        setIsDealing(false);
      }
    }
    
    // Auto sync initial settings if host
    if (creator) {
      const freshState = engine.initGameState(position as PlayerPosition, '3', '3');
      socketInstance.emit("sync_game_state", { roomId: code, gameState: freshState });
      setGameState(freshState);
    }
  };

  const getPlayerAtSeat = (seat: 'bottom' | 'right' | 'top' | 'left'): PlayerPosition => {
    const me = multiplayerMode === 'online' ? localPlayerIndex : 0;
    if (seat === 'bottom') return me;
    if (seat === 'right') return ((me + 1) % 4) as PlayerPosition;
    if (seat === 'top') return ((me + 2) % 4) as PlayerPosition;
    return ((me + 3) % 4) as PlayerPosition;
  };

  const getPlayerName = useCallback((pos: PlayerPosition): string => {
    if (multiplayerMode === 'online') {
      const p = lobbyPlayers.find(pl => pl.position === pos);
      if (p) return p.name;
    }
    return pos === 0 ? "我 (南家)" : pos === 1 ? "东家" : pos === 2 ? "北家" : "西家";
  }, [multiplayerMode, lobbyPlayers]);

  const startNewRound = useCallback((bankerPos: PlayerPosition, l0: Rank, l1: Rank) => {
    updateStateAndSync(prev => {
      const initialState = engine.initGameState(bankerPos, l0, l1, prev.nextBankerOfTeam, false);
      return initialState;
    });
    setShowSettings(false);
    setIsDealing(false);
  }, [updateStateAndSync]);

  const handleRestartEverything = useCallback(() => {
    if (multiplayerMode === 'online' && socket) {
      socket.emit("restart_game", { roomId });
    } else {
      updateStateAndSync(prev => {
        const initialState = engine.initGameState(0, '3', '3', undefined, true);
        return {
          ...initialState,
          settings: prev.settings
        };
      });
      setShowSettings(true);
      setIsDealing(false);
    }
  }, [updateStateAndSync, multiplayerMode, socket, roomId]);

  const startDeal = useCallback(() => {
    setIsDealing(true);
    setShowSettings(false);

    const currentBottomCardCount = gameState.settings.bottomCardCount;
    const fullDeck = makeComboFriendlyDeck(engine.createDeck(), currentBottomCardCount);
    const bottomCards = fullDeck.slice(fullDeck.length - currentBottomCardCount);

    updateStateAndSync(prev => ({ 
      ...prev, 
      phase: 'DEALING', 
      message: "正在发牌与叫牌...", 
      hands: { 0: [], 1: [], 2: [], 3: [] },
      dealingCount: 0,
      bottomCards: undefined
    }));

    let currentIndex = 0;
    const cardsToDealLimit = fullDeck.length - currentBottomCardCount;

    const intervalId = setInterval(() => {
      if (currentIndex >= cardsToDealLimit) {
        clearInterval(intervalId);
        setIsDealing(false);
        updateStateAndSync(prev => {
          const finalHands = { ...prev.hands };
          
          let nextPhase: GamePhase = 'BIDDING';
          let msg = "发牌结束，请叫牌";
          
          if (prev.trumpSuit) {
            if (prev.settings.bottomCardCount === 0) {
              nextPhase = 'PLAYING';
              msg = "叫牌结束，游戏开始！请出牌。";
            } else {
              nextPhase = 'BOTTOM_REPLACEMENT';
              const mePos = multiplayerMode === 'online' ? localPlayerIndex : 0;
              msg = prev.bankerPos === mePos 
                ? "叫牌结束，您是庄家，请选择8张弃置作为底牌" 
                : `${getPlayerName(prev.bankerPos)}是庄家，正在精选底牌...`;
              finalHands[prev.bankerPos] = [...finalHands[prev.bankerPos], ...bottomCards];
            }
          }
          
          for (let i = 0; i < 4; i++) {
            const p = i as PlayerPosition;
            finalHands[p] = NanningRules.sortHand(finalHands[p], prev.trumpSuit, prev.trumpLevel);
          }
          
          return { 
            ...prev, 
            phase: nextPhase, 
            hands: finalHands, 
            bottomCards: bottomCards,
            currentPlayer: prev.bankerPos,
            message: msg
          };
        });
        return;
      }

      const cardToDeal = fullDeck[currentIndex];
      const playerToReceive = (currentIndex % 4) as PlayerPosition;
      const nextDealingCount = currentIndex + 1;

      updateStateAndSync(prev => {
        const newHands = { ...prev.hands };
        newHands[playerToReceive] = [...(newHands[playerToReceive] || []), cardToDeal];
        return { 
          ...prev, 
          hands: newHands, 
          dealingCount: nextDealingCount 
        };
      });

      currentIndex++;
    }, 45);

    return () => clearInterval(intervalId);
  }, [gameState.settings.bottomCardCount, updateStateAndSync, multiplayerMode, localPlayerIndex]);

  useEffect(() => {
    // startNewRound(0, '3', '3'); // Initial call
  }, []);

  // AI Turn Handling
  useEffect(() => {
    if (isLastTrickModalOpen) return;
    if (gameState.phase === 'PLAYING') {
      const cp = gameState.currentPlayer;
      if (cp !== -1) {
        // Is cp an AI player in our room?
        const isCPAnAI = multiplayerMode === 'online' && lobbyPlayers.some(p => p.position === cp && p.isAI);
        const isOfflineAI = multiplayerMode === 'offline' && cp !== 0;

        if (isOfflineAI || (multiplayerMode === 'online' && isCPAnAI && isHost)) {
          const timer = setTimeout(() => {
            const plays = playAICards(cp, gameState);
            handlePlayInternal(cp, plays);
          }, 800);
          return () => clearTimeout(timer);
        }
      }
    }
  }, [gameState.phase, gameState.currentPlayer, isLastTrickModalOpen, isHost, lobbyPlayers, multiplayerMode, gameState]);

  // AI Bottom Card Replacement Handling
  useEffect(() => {
    if (isLastTrickModalOpen) return;
    if (gameState.phase === 'BOTTOM_REPLACEMENT') {
      const banker = gameState.bankerPos;
      const isBankerAnAI = multiplayerMode === 'online' && lobbyPlayers.some(p => p.position === banker && p.isAI);
      const isOfflineAI = multiplayerMode === 'offline' && banker !== 0;

      if (isOfflineAI || (multiplayerMode === 'online' && isBankerAnAI && isHost)) {
        const timer = setTimeout(() => {
          const currentHand = gameState.hands[banker] || [];
          
          // Select the 8 worst cards to bury
          const discarded = aiSelectBottomCards(currentHand, gameState.trumpSuit, gameState.trumpLevel, 8);
          const newHand = currentHand.filter(c => !discarded.some(dc => dc.id === c.id));
          
          updateStateAndSync(prev => ({
            ...prev,
            hands: {
              ...prev.hands,
              [banker]: NanningRules.sortHand(newHand, prev.trumpSuit, prev.trumpLevel)
            },
            bottomCards: discarded,
            phase: 'PLAYING',
            currentPlayer: banker,
            message: `${getPlayerName(banker)}已弃置8张底牌。游戏开始！`
          }));
        }, 1800);
        return () => clearTimeout(timer);
      }
    }
  }, [gameState.phase, gameState.bankerPos, isLastTrickModalOpen, isHost, lobbyPlayers, multiplayerMode, gameState, updateStateAndSync]);

  const handlePlayInternal = (player: PlayerPosition, cards: CardType[]) => {
    updateStateAndSync(prev => {
      const currentHand = prev.hands[player] || [];
      const newHand = currentHand.filter(c => !cards.some(pc => pc && c && pc.id === c.id));
      
      let newTrick = prev.currentTrick;
      if (!newTrick) {
        newTrick = { leader: player, cards: { 0:[], 1:[], 2:[], 3:[] }, points: 0 };
      }
      
      const updatedTrick = { 
        ...newTrick, 
        cards: { ...newTrick.cards, [player]: cards } 
      };
 
      // Count how many players have played in this trick
      const playersPlayed = (Object.values(updatedTrick.cards) as CardType[][]).filter(c => c && c.length > 0).length;
      
      if (playersPlayed < 4) {
        // Round not finished yet, just move to next player
        const nextPlayer = ((player + 1) % 4) as PlayerPosition;
        return {
          ...prev,
          hands: { ...prev.hands, [player]: newHand },
          currentTrick: updatedTrick,
          currentPlayer: nextPlayer
        };
      } else {
        // Trick finished! Determine winner but stay on current state so cards stay on table
        const winner = NanningRules.getWinner(updatedTrick, prev.trumpSuit, prev.trumpLevel);
        
        // Calculate points in this trick safely using centralized rules engine
        const allPlayedCards: CardType[] = [];
        (Object.values(updatedTrick.cards) as CardType[][]).forEach((pCards: CardType[]) => {
          if (pCards) {
            allPlayedCards.push(...pCards);
          }
        });
        const trickPoints = NanningRules.calculatePoints(allPlayedCards);
 
        const winnerName = getPlayerName(winner);
 
        return {
          ...prev,
          hands: { ...prev.hands, [player]: newHand },
          currentTrick: {
            ...updatedTrick,
            winner,
            points: trickPoints
          },
          currentPlayer: -1 as any as PlayerPosition, // Temporarily pause for players to see
          message: `本圈结束：${winnerName} 获胜！(得 ${trickPoints} 分)`
        };
      }
    });
  };

  const handleCollectTrick = useCallback(() => {
    updateStateAndSync(prev => {
      const trick = prev.currentTrick;
      if (!trick || trick.winner === undefined) return prev;
      
      const winner = trick.winner;
      const points = trick.points;

      // Team scoring
      const bankerTeamIdx = prev.bankerPos % 2;
      const winnerTeamIdx = winner % 2;
      const challengerTeamIdx = 1 - bankerTeamIdx;
      
      const newTeams: [TeamState, TeamState] = [
        { ...prev.teams[0] },
        { ...prev.teams[1] }
      ];
      const handsRemaining = (Object.values(prev.hands) as CardType[][]).some(h => h && h.length > 0);
      
      if (!handsRemaining) {
        // Last trick! Calculate final points with v2.0 kou pai/rewards rules.
        // Get the winner cards and pattern of the final trick
        const winnerCards = trick.cards[winner] || [];
        const winnerPattern = NanningRules.getPattern(winnerCards, prev.trumpSuit, prev.trumpLevel);
        
        let settlementMsg = "";
        
        // If the last trick card count is less than 2 (e.g. only 1 card)
        if (winnerCards.length < 2) {
          if (winnerTeamIdx === challengerTeamIdx) {
            newTeams[challengerTeamIdx].score = prev.teams[challengerTeamIdx].score + points;
            settlementMsg = `闲家赢得最后一圈（单张牌）！无反扣或加倍，获得本圈基础值 ${points} 分，折合闲家最终得分 ${newTeams[challengerTeamIdx].score} 分！`;
          } else {
            // Banker wins: Challenger gets 0, no reduction
            newTeams[challengerTeamIdx].score = prev.teams[challengerTeamIdx].score;
            settlementMsg = `庄家赢得最后一圈（单张牌）！无反扣或加倍，闲家未得分，折合闲家最终得分 ${newTeams[challengerTeamIdx].score} 分！`;
          }
        } else {
          let multiplier = 1;
          if (winnerPattern.type !== 'SINGLE' && winnerPattern.count > 0) {
            multiplier = winnerPattern.count;
          }
          
          const kouDiPoints = points * multiplier;
          
          // v2.0 key rule: kou pai fen replaces last trick conventional score
          if (winnerTeamIdx === challengerTeamIdx) {
            // Challenger wins final trick: Challenger total = preFinal + kouDiPoints
            newTeams[challengerTeamIdx].score = prev.teams[challengerTeamIdx].score + kouDiPoints;
            settlementMsg = `闲家赢得最后一圈！使用牌型 [${winnerPattern.type}] 结算 ${multiplier}倍扣牌（胜出牌型总张时），获得扣牌分 ${kouDiPoints} 分（本圈基础 ${points}分），折合闲家最终得分 ${newTeams[challengerTeamIdx].score} 分！`;
          } else {
            // Banker wins final trick: Challenger total = preFinal - kouDiPoints
            newTeams[challengerTeamIdx].score = prev.teams[challengerTeamIdx].score - kouDiPoints;
            settlementMsg = `庄家赢得最后一圈！使用牌型 [${winnerPattern.type}] 结算 ${multiplier}倍扣牌（胜出牌型总张时），扣除闲家 ${kouDiPoints} 分（本圈基础 ${points}分），折合闲家最终得分 ${newTeams[challengerTeamIdx].score} 分！`;
          }
        }

        const score = newTeams[challengerTeamIdx].score;
        let nextBankerTeamIdx = bankerTeamIdx;
        let levelInc = 0;

        if (score >= 160) {
          nextBankerTeamIdx = challengerTeamIdx;
          levelInc = engine.calculateChallengerLevelIncrease(score);
        } else {
          levelInc = engine.calculateLevelIncrease(score);
        }

        const nextLevel = (current: Rank, inc: number): Rank => {
          const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
          const curIdx = ranks.indexOf(current);
          const nextIdx = Math.min(ranks.length - 1, curIdx + inc);
          return ranks[nextIdx];
        };

        const updatedTeams = [
          { ...newTeams[0] },
          { ...newTeams[1] }
        ] as [TeamState, TeamState];

        const previousWinnerLevel = prev.teams[nextBankerTeamIdx].level;
        // Absolute victory condition: reaches 'A' and exceed 'A' by winning this round as banker playing 'A'
        const isAbsoluteWin = (previousWinnerLevel === 'A' && nextBankerTeamIdx === bankerTeamIdx);
        const gameWinner = isAbsoluteWin ? nextBankerTeamIdx : null;

        updatedTeams[nextBankerTeamIdx].level = nextLevel(updatedTeams[nextBankerTeamIdx].level, levelInc);
        updatedTeams[nextBankerTeamIdx].isBanker = true;
        updatedTeams[1 - nextBankerTeamIdx].isBanker = false;

        const nextBankerPos = prev.nextBankerOfTeam[nextBankerTeamIdx];
        const updatedNextBankerOfTeam = {
          ...prev.nextBankerOfTeam,
          [nextBankerTeamIdx]: ((nextBankerPos + 2) % 4) as PlayerPosition
        };

        return {
          ...prev,
          currentTrick: null,
          lastTrick: trick,
          teams: updatedTeams,
          phase: 'GAMEOVER',
          bankerPos: nextBankerPos,
          nextBankerOfTeam: updatedNextBankerOfTeam,
          gameWinner: gameWinner,
          message: isAbsoluteWin 
            ? `恭喜 ${nextBankerTeamIdx === 0 ? `${getPlayerName(0)}与${getPlayerName(2)}组合` : `${getPlayerName(1)}与${getPlayerName(3)}组合`} 成功打过 A 级，赢得终极胜利！`
            : `${settlementMsg} ${score >= 160 ? "闲家夺庄成功！" : "庄家成功保庄！"}`
        };
      }

      // If it is NOT the last trick, do conventional score update
      if (winnerTeamIdx === challengerTeamIdx) {
        newTeams[challengerTeamIdx].score += points;
      }

      return {
        ...prev,
        currentTrick: null,
        lastTrick: trick,
        teams: newTeams,
        currentPlayer: winner,
        message: `${getPlayerName(winner)} 获胜，请领牌`
      };
    });
  }, [updateStateAndSync, getPlayerName]);

  // Handle trick countdown activation
  useEffect(() => {
    if (autoCollect && gameState.currentPlayer === -1 && gameState.currentTrick) {
      setCollectCountdown(3);
    } else {
      setCollectCountdown(null);
    }
  }, [gameState.currentPlayer, gameState.currentTrick, autoCollect]);

  // Execute countdown ticking
  useEffect(() => {
    if (collectCountdown === null || isLastTrickModalOpen) return;
    
    if (collectCountdown === 0) {
      handleCollectTrick();
      return;
    }

    const timer = setTimeout(() => {
      setCollectCountdown(prev => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [collectCountdown, handleCollectTrick, isLastTrickModalOpen]);

  // Synchronize teams' isBanker status with bankerPos reactively
  useEffect(() => {
    setGameState(prev => {
      const bankerTeamIdx = prev.bankerPos % 2;
      if (prev.teams[bankerTeamIdx].isBanker && !prev.teams[1 - bankerTeamIdx].isBanker) {
        return prev;
      }
      
      const updatedTeams = prev.teams.map((t, idx) => ({
        ...t,
        isBanker: idx === bankerTeamIdx
      })) as [TeamState, TeamState];
      
      return {
        ...prev,
        teams: updatedTeams
      };
    });
  }, [gameState.bankerPos]);

  const handleBid = (suit: CardType['suit'], count: number) => {
    const suitName = suit === 'spade' ? '黑桃' : suit === 'heart' ? '红桃' : suit === 'club' ? '梅花' : suit === 'diamond' ? '方块' : '无主';
    const me = multiplayerMode === 'online' ? localPlayerIndex : 0;
    
    updateStateAndSync(prev => {
      // 1. Check if we can bid (priority and count)
      if (prev.currentBid && count <= prev.currentBid.count) {
        return prev;
      }

      // If it's first round, the bidder becomes the banker
      let newBanker = prev.bankerPos;
      if (prev.isFirstRound) {
        newBanker = me;
      }

      const displayMessage = prev.settings.isPublicBid 
        ? `${getPlayerName(me)} 叫牌: ${count}张${suitName}`
        : `${getPlayerName(me)} 叫牌: ${count}张 (内容隐藏)`;

      // Sync the teams isBanker status so that scoreboard is completely accurate
      const newTeams = prev.teams.map((t, idx) => ({
        ...t,
        isBanker: idx === (newBanker % 2)
      })) as [TeamState, TeamState];

      return {
        ...prev,
        currentBid: { player: me, suit, count },
        trumpSuit: suit,
        bankerPos: newBanker,
        teams: newTeams,
        message: displayMessage
      };
    });
  };

  const finishBidding = () => {
    updateStateAndSync(prev => {
      const trump = prev.trumpSuit || 'spade'; 
      const finalHands = { ...prev.hands };
      const currentBottom = prev.bottomCards || [];
      const banker = prev.bankerPos;
      
      const bankerTeamIdx = banker % 2;
      const nextTeams = prev.teams.map((t, idx) => ({
        ...t,
        isBanker: idx === bankerTeamIdx
      })) as [TeamState, TeamState];
      
      const trumpLevel = nextTeams[bankerTeamIdx].level;
      
      let nextPhase: GamePhase = 'BOTTOM_REPLACEMENT';
      let msg = "";
      
      if (prev.settings.bottomCardCount === 0) {
        nextPhase = 'PLAYING';
        msg = "叫牌结束，游戏开始！请出牌。";
      } else {
        // Banker gets 8 bottom cards
        finalHands[banker] = [...finalHands[banker], ...currentBottom];
        const me = multiplayerMode === 'online' ? localPlayerIndex : 0;
        msg = banker === me 
          ? "叫牌结束，您是庄家，请选择8张手牌放入底牌" 
          : `${getPlayerName(banker)}是庄家，正在替换底牌...`;
      }
      
      for (let i = 0; i < 4; i++) {
        const p = i as PlayerPosition;
        finalHands[p] = NanningRules.sortHand(finalHands[p], trump, trumpLevel);
      }
      
      return { 
        ...prev, 
        phase: nextPhase, 
        hands: finalHands, 
        trumpSuit: trump, 
        trumpLevel,
        teams: nextTeams,
        currentPlayer: banker, 
        message: msg 
      };
    });
  };

  const handleReplaceBottom = (selectedCards: CardType[]) => {
    if (selectedCards.length !== gameState.settings.bottomCardCount) return false;
    
    updateStateAndSync(prev => {
      const banker = prev.bankerPos;
      const bankerHand = prev.hands[banker] || [];
      const newHand = bankerHand.filter(c => !selectedCards.some(sc => sc.id === c.id));
      
      return {
        ...prev,
        hands: {
          ...prev.hands,
          [banker]: NanningRules.sortHand(newHand, prev.trumpSuit, prev.trumpLevel)
        },
        bottomCards: selectedCards,
        phase: 'PLAYING',
        currentPlayer: banker,
        message: "埋底完成，游戏开始！请出牌。"
      };
    });
    return true;
  };

  // Helper for rendering opponent hands - Optimized for ultra-clean, non-blocking inline layout without absolute positioning
  const OpponentHand = ({ count }: { count: number }) => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    // Tiny, beautiful non-obtrusive cards for layout decoration
    const maxStackedCards = isMobile ? Math.min(count, 1) : Math.min(count, 3);
    const cards = Array.from({ length: maxStackedCards });
    
    const cardW = isMobile ? 12 : 16;
    const cardH = isMobile ? 17 : 23;
    
    return (
      <div className="flex pointer-events-none items-center justify-center gap-1.5 mt-0.5 shrink-0 select-none">
        {cards.length > 0 && (
          <div className="flex flex-row items-center">
            {cards.map((_, i) => (
              <div 
                key={i} 
                className="transition-all duration-300"
                style={{ 
                  marginLeft: i > 0 ? -(cardW * 0.55) : 0,
                  zIndex: i 
                }}
              >
                <div 
                  style={{ width: cardW, height: cardH }} 
                  className="rounded-[3px] bg-gradient-to-br from-[#8a1c1c] to-[#400d0d] border border-red-500/30 shadow-sm flex items-center justify-center relative overflow-hidden"
                >
                  <div className="absolute inset-0.5 border border-red-400/20 rounded-[2px] opacity-50" />
                </div>
              </div>
            ))}
          </div>
        )}
        <span className="bg-black/80 border border-gold/30 text-gold text-[8px] sm:text-[9px] font-black px-1.5 py-0.5 rounded-full shadow-md shrink-0">
          {count}张
        </span>
      </div>
    );
  };

  // AI Bidding Simulation during DEALING
  useEffect(() => {
    if (gameState.phase === 'DEALING') {
      const shouldRunAIBid = multiplayerMode === 'offline' || (multiplayerMode === 'online' && isHost);
      if (!shouldRunAIBid) return;

      const timer = setTimeout(() => {
        const aiPositions: PlayerPosition[] = [];
        if (multiplayerMode === 'offline') {
          aiPositions.push(1, 2, 3);
        } else {
          lobbyPlayers.forEach(p => {
            if (p.isAI) aiPositions.push(p.position as PlayerPosition);
          });
        }

        if (aiPositions.length === 0) return;
        const aiPos = aiPositions[Math.floor(Math.random() * aiPositions.length)];
        const hand = gameState.hands[aiPos];
        if (!hand) return;
        const suits: CardType['suit'][] = ['spade', 'heart', 'club', 'diamond'];
        
        for (const suit of suits) {
           const countInHand = hand.filter(c => c && c.suit === suit && c.rank === gameState.trumpLevel).length;
           if (countInHand >= 1) {
             for (let cCount = countInHand; cCount >= 1; cCount--) {
               if (!gameState.currentBid || cCount > gameState.currentBid.count) {
                 const suitName = suit === 'spade' ? '黑桃' : suit === 'heart' ? '红桃' : suit === 'club' ? '梅花' : '方块';
                 
                 updateStateAndSync(prev => ({
                   ...prev,
                   currentBid: { player: aiPos, suit, count: cCount },
                   trumpSuit: suit,
                   bankerPos: prev.isFirstRound ? aiPos : prev.bankerPos,
                   message: prev.settings.isPublicBid 
                     ? `${getPlayerName(aiPos)} 叫牌: ${cCount}张${suitName}`
                     : `${getPlayerName(aiPos)} 叫牌: ${cCount}张`
                 }));
                 return;
               }
             }
           }
        }
      }, 500 + Math.random() * 1500);
      return () => clearTimeout(timer);
    }
  }, [gameState.phase, gameState.dealingCount, gameState.currentBid, multiplayerMode, isHost, lobbyPlayers, updateStateAndSync, getPlayerName]);

  const handlePlay = (cards: CardType[]) => {
    const me = multiplayerMode === 'online' ? localPlayerIndex : 0;
    if (gameState.phase !== 'PLAYING' || gameState.currentPlayer !== me) return false;
    
    // Check if player is leading a new trick:
    if (!gameState.currentTrick && cards.length > 1) {
      const isFirstTrump = NanningRules.isTrump(cards[0], gameState.trumpSuit, gameState.trumpLevel);
      const firstSuit = isFirstTrump ? 'trump' : cards[0]?.suit;
      const allSame = cards.every(c => {
        const isT = NanningRules.isTrump(c, gameState.trumpSuit, gameState.trumpLevel);
        return isT ? (firstSuit === 'trump') : (firstSuit !== 'trump' && c.suit === firstSuit);
      });
      if (!allSame) {
        updateStateAndSync(prev => ({ ...prev, message: "首家出牌必须为同一花色的牌或同为主牌/副牌！" }));
        return false;
      }
    }
    
    const leadPattern = gameState.currentTrick 
      ? NanningRules.getPattern(gameState.currentTrick.cards[gameState.currentTrick.leader] || [], gameState.trumpSuit, gameState.trumpLevel)
      : NanningRules.getPattern(cards || [], gameState.trumpSuit, gameState.trumpLevel);

    const leadSuit = gameState.currentTrick
      ? (NanningRules.isTrump(gameState.currentTrick.cards[gameState.currentTrick.leader]?.[0], gameState.trumpSuit, gameState.trumpLevel) ? 'trump' : gameState.currentTrick.cards[gameState.currentTrick.leader]?.[0]?.suit)
      : (NanningRules.isTrump(cards?.[0], gameState.trumpSuit, gameState.trumpLevel) ? 'trump' : cards?.[0]?.suit);

    if (!NanningRules.isLegalPlay(cards, gameState.hands[me], leadPattern, leadSuit as any, gameState.trumpSuit, gameState.trumpLevel)) {
       updateStateAndSync(prev => ({ ...prev, message: "不符合跟牌或出牌规则！" }));
       return false;
    }

    handlePlayInternal(me, cards);
    return true;
  };

  const me = multiplayerMode === 'online' ? localPlayerIndex : 0;
  const rightSeat = ((me + 1) % 4) as PlayerPosition;
  const topSeat = ((me + 2) % 4) as PlayerPosition;
  const leftSeat = ((me + 3) % 4) as PlayerPosition;

  const bankerTeamIdx = gameState.teams[0].isBanker ? 0 : 1;
  const challengerTeamIdx = 1 - bankerTeamIdx;

  if (multiplayerMode === null) {
    return (
      <MultiplayerLobby 
        onJoinSuccess={handleJoinMultiplayerSuccess}
        onSelectOffline={() => {
          setMultiplayerMode('offline');
          setShowSettings(true);
        }}
      />
    );
  }

  return (
    <div className="game-rotate-container flex flex-col h-[100dvh] w-full bg-[#050a07] text-[#e0d8cc] font-sans overflow-hidden relative select-none">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#d4af37 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
      <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]" />

      {/* Top Bar Navigation - More Compact */}
      <header className="relative z-50 flex justify-between items-center px-4 py-1.5 border-b border-[#d4af3720] bg-black/60 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 sm:w-10 sm:h-10 border border-gold/40 rounded-lg flex items-center justify-center text-gold font-bold text-lg bg-gold/10">南</div>
          <div>
            <h1 className="text-xs sm:text-sm font-black tracking-widest text-gold/90">南宁拖拉机</h1>
          </div>
        </div>

        <div className="flex gap-2 sm:gap-6 items-center">
           {gameState.message && (
             <div className="bg-gold/10 px-2 sm:px-3 py-0.5 rounded text-gold text-[9px] sm:text-[10px] font-bold animate-pulse border border-gold/20 max-w-[120px] xs:max-w-[200px] sm:max-w-none truncate">
               {gameState.message}
             </div>
           )}
           
           <div className="flex items-center gap-2 sm:gap-5">
              <div className="flex flex-col items-center">
                 <p className="text-[8px] uppercase opacity-40 leading-tight">级牌</p>
                 <div className="text-sm font-black text-gold tabular-nums">{gameState.trumpLevel}</div>
              </div>
              
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/40 border border-gold/20">
                 <span className={cn(
                   "text-xl leading-none",
                   gameState.trumpSuit === 'spade' && "text-blue-400",
                   gameState.trumpSuit === 'heart' && "text-red-500",
                   gameState.trumpSuit === 'club' && "text-green-500",
                   gameState.trumpSuit === 'diamond' && "text-orange-400"
                 )}>
                   {!gameState.trumpSuit ? '?' : (gameState.trumpSuit === 'spade' ? '♠' : gameState.trumpSuit === 'heart' ? '♥' : gameState.trumpSuit === 'club' ? '♣' : '♦')}
                 </span>
                 <p className="text-[10px] font-bold hidden sm:block opacity-70">
                   {gameState.trumpSuit === 'spade' ? '黑桃' : gameState.trumpSuit === 'heart' ? '红桃' : gameState.trumpSuit === 'club' ? '梅花' : gameState.trumpSuit === 'diamond' ? '方块' : '待定'}
                 </p>
              </div>

              <div className="flex flex-col items-center">
                 <p className="text-[8px] uppercase opacity-40 leading-none mb-1">庄家</p>
                 <div className="px-2 py-0.5 bg-white/5 border border-white/10 rounded text-[10px] font-bold text-white/80">
                   {gameState.bankerPos === 0 ? "南" : gameState.bankerPos === 1 ? "东" : gameState.bankerPos === 2 ? "北" : "西"}
                 </div>
              </div>

              <div className="flex flex-col items-center border-l border-white/10 pl-2 sm:pl-5">
                 <p className="text-[8px] uppercase opacity-40 leading-tight">得分</p>
                 <div className="text-sm font-black text-gold tabular-nums">{gameState.teams[challengerTeamIdx].score}</div>
              </div>

              <div className="flex flex-col items-center border-l border-white/10 pl-2 sm:pl-4">
                <button
                  onClick={() => setShowRulesModal(true)}
                  className="h-7 px-2.5 bg-gold/10 hover:bg-gold/25 border border-gold/40 text-gold rounded-md text-[10px] sm:text-xs font-black tracking-wider transition-all uppercase flex items-center justify-center gap-1 cursor-pointer"
                >
                  规则/计分
                </button>
              </div>

              {gameState.lastTrick && (
                <div className="flex flex-col items-center border-l border-white/10 pl-2 sm:pl-4">
                  <button
                    onClick={() => setIsLastTrickModalOpen(true)}
                    className="h-7 px-2.5 bg-gradient-to-r from-amber-500/15 to-yellow-500/15 hover:from-amber-500/30 hover:to-yellow-500/30 border border-amber-500/40 text-amber-300 rounded-md text-[10px] sm:text-xs font-black tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer animate-pulse"
                  >
                    上一圈出牌
                  </button>
                </div>
              )}
           </div>
        </div>
      </header>

      {/* Slim HUD warning bar for bottom replacement, preventing center table blockage */}
      {gameState.phase === 'BOTTOM_REPLACEMENT' && (
        <div className="relative z-45 bg-[#d4af37]/15 border-b border-[#d4af37]/35 px-4 py-2 text-center flex items-center justify-center gap-2 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-[#d4af37] animate-ping shrink-0" />
          <p className="text-xs font-black text-amber-200 leading-none">
            {gameState.bankerPos === 0 ? (
              <span>【埋底牌阶段】您是本局庄家。底牌已加入手牌，请选择 <strong className="text-gold font-extrabold px-0.5 bg-gold/15 rounded">8张底牌</strong> 放入底，再点击右下角 <strong className="text-gold font-extrabold px-0.5 bg-gold/15 rounded">【确认入底牌】</strong> 提交。</span>
            ) : (
              <span>【埋底牌阶段】庄家正在精心挑选组合并替换 8 张底牌...</span>
            )}
          </p>
        </div>
      )}

      {/* Main Table Area - Removing large spacing to let the table grow to maximum physical size */}
      <main className="flex-1 relative flex items-center justify-center overflow-hidden">
        {/* Emerald Green Felt Table Setup - Covers 100% of available space with no margins/caps to maximize playing field */}
        <div 
          onClick={gameState.currentPlayer === -1 ? handleCollectTrick : undefined}
          className={cn(
            "w-full h-full bg-gradient-to-b from-[#0e5d32] via-[#084321] to-[#052d15] shadow-[inset_0_0_85px_rgba(0,0,0,0.60)] relative flex items-center justify-center overflow-hidden shrink",
            gameState.currentPlayer === -1 && "cursor-pointer"
          )}
        >
            
            {/* Elegant physical-looking internal dashed boundary line for a premium card table layout */}
            <div className="absolute inset-2 sm:inset-4 rounded-[16px] sm:rounded-[32px] border-2 border-dashed border-[#1b8c4d]/20 pointer-events-none" />
            
            {/* Player Seat Badges - Unifying clean horizontal pill styling aligned with compass directions */}
            
            {/* Player 3 (北家 / Top, pos 2) */}
            <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center">
              <div className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 bg-[#1f2736]/90 border border-slate-700/50 shadow-md transition-all duration-300",
                gameState.currentPlayer === topSeat && "border-gold ring-2 ring-gold/40 scale-102 bg-[#2d3852]"
              )}>
                 <span className="bg-slate-800 text-slate-300 text-[9px] font-bold px-1 rounded-sm">
                   {topSeat === 0 ? '南' : topSeat === 1 ? '东' : topSeat === 2 ? '北' : '西'}
                 </span>
                 <span className="text-[10px] sm:text-xs font-black tracking-wide text-white/95">
                   {getPlayerName(topSeat)}
                 </span>
                 {gameState.bankerPos === topSeat && <span className="bg-gold text-black text-[9px] font-black px-1 rounded-sm">庄</span>}
                 {gameState.currentPlayer === topSeat && <span className="w-1.5 h-1.5 rounded-full bg-gold animate-ping" />}
              </div>
              <OpponentHand count={(gameState.hands[topSeat] || []).length} />
            </div>

            {/* Player 4 (西家 / Left, pos 3) */}
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center">
              <div className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 bg-[#1f2736]/90 border border-slate-700/50 shadow-md transition-all duration-300",
                gameState.currentPlayer === leftSeat && "border-gold ring-2 ring-gold/40 scale-102 bg-[#2d3852]"
              )}>
                 <span className="bg-slate-800 text-slate-300 text-[9px] font-bold px-1 rounded-sm">
                   {leftSeat === 0 ? '南' : leftSeat === 1 ? '东' : leftSeat === 2 ? '北' : '西'}
                 </span>
                 <span className="text-[10px] sm:text-xs font-black tracking-wide text-white/95">
                   {getPlayerName(leftSeat)}
                 </span>
                 {gameState.bankerPos === leftSeat && <span className="bg-gold text-black text-[9px] font-black px-1 rounded-sm">庄</span>}
                 {gameState.currentPlayer === leftSeat && <span className="w-1.5 h-1.5 rounded-full bg-gold animate-ping" />}
              </div>
              <OpponentHand count={(gameState.hands[leftSeat] || []).length} />
            </div>

            {/* Player 2 (东家 / Right, pos 1) */}
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center">
              <div className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 bg-[#1f2736]/90 border border-slate-700/50 shadow-md transition-all duration-300",
                gameState.currentPlayer === rightSeat && "border-gold ring-2 ring-gold/40 scale-102 bg-[#2d3852]"
              )}>
                 <span className="bg-slate-800 text-slate-300 text-[9px] font-bold px-1 rounded-sm">
                   {rightSeat === 0 ? '南' : rightSeat === 1 ? '东' : rightSeat === 2 ? '北' : '西'}
                 </span>
                 <span className="text-[10px] sm:text-xs font-black tracking-wide text-white/95">
                   {getPlayerName(rightSeat)}
                 </span>
                 {gameState.bankerPos === rightSeat && <span className="bg-gold text-black text-[9px] font-black px-1 rounded-sm">庄</span>}
                 {gameState.currentPlayer === rightSeat && <span className="w-1.5 h-1.5 rounded-full bg-gold animate-ping" />}
              </div>
              <OpponentHand count={(gameState.hands[rightSeat] || []).length} />
            </div>

            {/* Player 1 (你 / Bottom-Left, pos 0) */}
            <div className="absolute bottom-[24%] sm:bottom-[25%] left-4 sm:left-8 z-40 flex items-center gap-2">
              <div className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 bg-[#1f2736]/90 border border-slate-700/50 shadow-md transition-all duration-300",
                gameState.currentPlayer === me && "border-gold ring-2 ring-gold/40 scale-102 bg-[#2d3852]"
              )}>
                 <span className={cn(
                   "text-[9px] font-bold px-1 rounded-sm",
                   gameState.currentPlayer === me ? "bg-amber-500 text-black font-extrabold shadow-sm" : "bg-slate-800 text-slate-300"
                 )}>{me === 0 ? '南' : me === 1 ? '东' : me === 2 ? '北' : '西'}</span>
                 <span className="text-[10px] sm:text-xs font-black tracking-wide text-white/95">
                   {getPlayerName(me)} {multiplayerMode === 'online' && "(我)"}
                 </span>
                 {gameState.bankerPos === me && (
                   <span className="bg-gold text-black text-[9px] font-black px-1 rounded-sm">庄</span>
                 )}
                 {gameState.currentPlayer === me && <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-ping" />}
              </div>
              <span className={cn(
                "text-[8px] sm:text-[9px] px-2 py-0.5 rounded-full font-bold shadow-sm shrink-0",
                gameState.currentPlayer === me 
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" 
                  : "bg-black/80 text-[#d4af37] border border-[#d4af37]/20"
              )}>
                {(gameState.hands[me] || []).length}张牌
              </span>
            </div>

            {/* In-Game Bidding Overlay (HUD) - Ultra-compact elegant styling that stays completely clear and transparent */}
            {(gameState.phase === 'DEALING' || gameState.phase === 'BIDDING') && (
              <div className="absolute right-4 sm:right-8 bottom-[24%] sm:bottom-[25%] z-50 flex flex-col items-end gap-2 pointer-events-none">
                 <div className="flex flex-wrap justify-end gap-1.5 pointer-events-auto max-w-xs sm:max-w-md bg-black/75 border border-white/5 p-2 rounded-2xl shadow-xl backdrop-blur-md">
                    {/* Standard Suits Bidding options */}
                    {(['spade', 'heart', 'club', 'diamond'] as const).map(suit => {
                      const countInHand = (gameState.hands[me] || []).filter(c => c && c.suit === suit && c.rank === gameState.trumpLevel).length;
                      if (countInHand === 0) return null;
                      
                      const maxPossible = Math.min(4, countInHand);
                      const bids = Array.from({ length: maxPossible }, (_, i) => i + 1);

                      return bids.map(count => {
                        const isHigher = !gameState.currentBid || count > gameState.currentBid.count;
                        if (!isHigher) return null;

                        return (
                          <motion.button
                            initial={{ scale: 0, rotate: -15 }}
                            animate={{ scale: 1, rotate: 0 }}
                            key={`${suit}-${count}`}
                            onClick={() => handleBid(suit, count)}
                            className="bg-[#111622]/95 border border-[#d4af37]/45 hover:border-[#d4af37] text-amber-200 px-2.5 py-1.5 rounded-lg text-[10px] font-black flex items-center gap-1.5 hover:bg-[#d4af37] hover:text-black transition-all shadow-md active:scale-95 cursor-pointer"
                          >
                            <span className={cn(
                               "text-xs",
                               suit === 'spade' && "text-blue-400",
                               suit === 'heart' && "text-red-500",
                               suit === 'club' && "text-green-500",
                               suit === 'diamond' && "text-orange-400"
                            )}>
                              {suit === 'spade' ? '♠' : suit === 'heart' ? '♥' : suit === 'club' ? '♣' : '♦'}
                            </span>
                            <span>{count}张叫</span>
                          </motion.button>
                        );
                      });
                    })}

                    {/* Finish Bidding manually during BIDDING phase - Sleek non-obtrusive button */}
                    {gameState.phase === 'BIDDING' && (multiplayerMode === 'offline' || isHost) && (
                      <button
                        onClick={finishBidding}
                        className="bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black font-extrabold px-3.5 py-1.5 rounded-lg text-xs tracking-wide hover:scale-102 active:scale-98 transition-all shadow-md pointer-events-auto cursor-pointer"
                      >
                        确认叫牌，进入埋底
                      </button>
                    )}
                 </div>

                 {gameState.currentBid && (
                   <motion.div 
                     initial={{ y: 20, opacity: 0 }} 
                     animate={{ y: 0, opacity: 1 }}
                     className="bg-black/85 border border-gold/20 px-3.5 py-1 rounded-full text-gold text-[10px] sm:text-xs font-bold inline-flex items-center gap-2 shadow-lg backdrop-blur-md mb-1"
                   >
                     <span>当前竞标:</span>
                     <div className="flex items-center gap-1">
                        <span className="bg-gold text-black px-1.5 rounded leading-none py-0.5 uppercase">
                          {gameState.currentBid.player === me ? "我" : getPlayerName(gameState.currentBid.player)}
                         </span>
                         <span>{gameState.currentBid.count}张</span>
                         {gameState.settings.isPublicBid && (
                           <span className={cn(
                             "text-xs",
                             gameState.currentBid.suit === 'spade' && "text-blue-400",
                             gameState.currentBid.suit === 'heart' && "text-red-500",
                             gameState.currentBid.suit === 'club' && "text-green-500",
                             gameState.currentBid.suit === 'diamond' && "text-orange-400",
                             gameState.currentBid.suit === 'joker' && "text-red-500"
                           )}>
                              {gameState.currentBid.suit === 'spade' ? '♠' : gameState.currentBid.suit === 'heart' ? '♥' : gameState.currentBid.suit === 'club' ? '♣' : gameState.currentBid.suit === 'diamond' ? '♦' : '无主 🃏'}
                           </span>
                         )}
                         {!gameState.settings.isPublicBid && <span className="opacity-40">[内容隐藏]</span>}
                      </div>
                    </motion.div>
                  )}
               </div>
             )}

            {/* Game Over Screen */}
            {gameState.phase === 'GAMEOVER' && (
              <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center flex-col gap-6 backdrop-blur-md">
                {gameState.gameWinner !== undefined && gameState.gameWinner !== null ? (
                  /* Spectacular Ultimate Victory Screener */
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center p-8 sm:p-12 max-w-lg w-full mx-4 bg-gradient-to-b from-[#14231b] to-[#040c06] border-2 border-gold rounded-[40px] shadow-[0_0_100px_rgba(212,175,55,0.3)] flex flex-col items-center relative overflow-hidden"
                  >
                    {/* Confetti / Particle Glow */}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-yellow-500/10 via-transparent to-transparent pointer-events-none"></div>
                    <div className="absolute -top-12 -left-12 w-40 h-40 bg-gold/10 rounded-full blur-3xl pointer-events-none"></div>
                    <div className="absolute -bottom-12 -right-12 w-40 h-40 bg-gold/10 rounded-full blur-3xl pointer-events-none"></div>
                    
                    <motion.div 
                      animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
                      transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                      className="text-6xl sm:text-7xl mb-6 select-none"
                    >
                      🏆
                    </motion.div>
                    
                    <p className="text-xs font-black text-gold/80 tracking-[0.3em] uppercase mb-3 text-center">
                      ⭐ ULTIMATE VICTORY ⭐
                    </p>
                    
                    <h2 className="text-3xl sm:text-4xl font-black text-white tracking-widest text-center mb-6 leading-relaxed">
                      恭喜<span className="text-gold bg-gold/10 border border-gold/30 px-3 py-1 rounded-2xl mx-1">{gameState.gameWinner === 0 ? "南北组合" : "东西组合"}</span>获胜！
                    </h2>
                    
                    <div className="w-full bg-white/5 border border-white/5 rounded-2xl p-5 mb-8 text-center">
                      <p className="text-xs text-zinc-400 font-bold mb-1">胜利规则依据</p>
                      <p className="text-[13px] text-[#d4af37] font-semibold leading-relaxed">
                        成功打到级别 A 并在本局战胜对手！<br />
                        超越 A 级限制，夺得本场南宁拖拉机的全盘总冠军！
                      </p>
                    </div>

                    <button 
                      onClick={handleRestartEverything}
                      className="w-full max-w-sm py-4 bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black font-black text-sm rounded-2xl tracking-widest shadow-[0_12px_40px_rgba(245,158,11,0.35)] transition-all cursor-pointer border border-amber-300 transform active:scale-98"
                    >
                      🔄 重新开始新游戏
                    </button>
                  </motion.div>
                ) : (
                  <>
                    <div className="text-center">
                      <h2 className="text-4xl font-black text-[#d4af37] tracking-tighter mb-2">本局结束</h2>
                      <p className="text-sm font-bold opacity-60 tracking-widest uppercase">结算详单</p>
                    </div>
                    
                    <div className="flex gap-8 items-center py-6 border-y border-white/10 w-full max-w-md justify-center">
                      <div className="text-center">
                        <p className="text-[10px] opacity-40 uppercase mb-1">
                          庄家方 ({bankerTeamIdx === 0 ? "南/北" : "东/西"})
                        </p>
                        <p className="text-2xl font-bold">{gameState.teams[bankerTeamIdx].score}</p>
                        <p className="text-xs text-[#d4af37]">级牌: {gameState.teams[bankerTeamIdx].level}</p>
                      </div>
                      <div className="w-px h-12 bg-white/10" />
                      <div className="text-center">
                        <p className="text-[10px] opacity-40 uppercase mb-1">
                          闲家方 ({bankerTeamIdx === 0 ? "东/西" : "南/北"})
                        </p>
                        <p className="text-2xl font-bold text-[#d4af37]">{gameState.teams[challengerTeamIdx].score}</p>
                        <p className="text-xs text-[#d4af37]">级牌: {gameState.teams[challengerTeamIdx].level}</p>
                      </div>
                    </div>

                    <div className="text-center text-sm px-6 font-bold text-[#d4af37] italic max-w-md leading-relaxed">
                      {gameState.message}
                    </div>

                    {/* Show Bottom Cards inside the GameOver overlay */}
                    {gameState.bottomCards && gameState.bottomCards.length > 0 && (
                      <div className="flex flex-col items-center gap-2 max-w-lg">
                        <p className="text-[10px] uppercase opacity-40 font-bold tracking-widest text-[#d4af37]">庄家扣置的 {gameState.bottomCards.length} 张底牌</p>
                        <div className="flex gap-1 justify-center flex-wrap max-h-[140px] overflow-y-auto p-1 border border-white/5 bg-black/40 rounded-xl">
                          {gameState.bottomCards.map((c, i) => (
                            <div key={i} className="scale-75 origin-center">
                              <PlayingCard card={c} isTrump={NanningRules.isTrump(c, gameState.trumpSuit, gameState.trumpLevel)} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button 
                      onClick={() => startNewRound(gameState.bankerPos, gameState.teams[0].level, gameState.teams[1].level)}
                      className="px-8 py-3 bg-[#d4af37] text-black font-black rounded-full hover:scale-105 active:scale-95 transition-all shadow-lg mt-2 cursor-pointer"
                    >
                      继续下一局
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="absolute inset-0 opacity-20" style={{ background: 'radial-gradient(circle at center, #2d5a3f 0%, transparent 70%)' }}></div>
            
            {/* Center Decal */}
            <div className="border border-[#1b8c4d]/30 w-48 h-48 rounded-full flex items-center justify-center opacity-25 pointer-events-none">
               <div className="border border-[#1b8c4d]/10 w-40 h-40 rounded-full flex items-center justify-center">
                 <span className="text-4xl text-gold font-serif italic">NN</span>
               </div>
            </div>

            {/* Played Cards Area */}
            <div className="absolute inset-0 z-[55] pointer-events-none flex flex-col items-center justify-center">
               {/* Central Bounded Table Container for Played Cards - expanded substantially to prevent any overlap/collision between players */}
               <div className="relative w-64 h-64 sm:w-[450px] sm:h-[260px] md:w-[520px] md:h-[280px] lg:w-[560px] lg:h-[310px] flex items-center justify-center pointer-events-none">
                 {/* "本圈出牌" Header exactly like in user's layout - repositioned non-blockingly */}
                 {gameState.currentTrick && Object.values(gameState.currentTrick.cards).some((cards: any) => cards && cards.length > 0) && (
                   <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[5] flex flex-col items-center pointer-events-none bg-[#052d15]/90 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-[#1b8c4d]/40 shadow-xl">
                     <span className="text-[#86e2a9] text-[9.5px] font-black tracking-[0.18em] uppercase">
                       本圈出牌
                     </span>
                   </div>
                 )}

                 <AnimatePresence>
                   {gameState.currentTrick && (
                     Object.keys(gameState.currentTrick.cards).map(posStr => {
                       const pos = parseInt(posStr) as PlayerPosition;
                       const cards = gameState.currentTrick!.cards[pos];
                       if (!cards || cards.length === 0) return null;

                       const visualPos = pos === me ? 0 : pos === rightSeat ? 1 : pos === topSeat ? 2 : 3;

                       const posConfig: Record<number, { container: string, animate: any }> = {
                         0: { container: "absolute bottom-0 sm:bottom-1 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-10", animate: { y: 0, opacity: 1, scale: 1 } },
                         1: { container: "absolute right-0 sm:right-1 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-10", animate: { x: 0, opacity: 1, scale: 1 } },
                         2: { container: "absolute top-0 sm:top-1 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-10", animate: { y: 0, opacity: 1, scale: 1 } },
                         3: { container: "absolute left-0 sm:left-1 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-10", animate: { x: 0, opacity: 1, scale: 1 } }
                       };

                       const label = getPlayerName(pos);
                       const isLeader = gameState.currentTrick?.leader === pos;

                       return (
                         <motion.div 
                           key={`trick-${pos}`}
                           initial={{ 
                             opacity: 0, 
                             scale: 0.8, 
                             y: visualPos === 0 ? 50 : visualPos === 2 ? -50 : 0, 
                             x: visualPos === 1 ? 50 : visualPos === 3 ? -50 : 0 
                           }}
                           animate={posConfig[visualPos].animate}
                           exit={{ opacity: 0, scale: 1.1, filter: "brightness(2)" }}
                           className={cn("absolute flex flex-col items-center gap-1.5 p-1.5 bg-black/75 rounded-2xl border border-white/10 backdrop-blur-md pointer-events-auto shadow-2xl z-20", posConfig[visualPos].container)}
                         >
                           <div className="flex items-center gap-0.5 bg-black/85 px-2 py-0.5 rounded text-[8px] sm:text-[9px] font-black border border-white/10 uppercase">
                             <span className={isLeader ? "text-gold" : "text-white/60"}>
                               {label} {isLeader && "★"}
                             </span>
                           </div>
                           <div className={cn(
                              "flex items-center justify-center",
                              cards.length > 4 
                                ? "flex-row" 
                                : "flex-wrap gap-x-1 sm:gap-x-1.5 gap-y-1 sm:gap-y-1.5 max-w-[160px] sm:max-w-[280px] md:max-w-[340px] lg:max-w-[400px]"
                            )}>
                             {cards.filter(Boolean).map((c, i) => (
                                <div 
                                  key={c?.id || `${pos}-${i}`} 
                                  style={{ 
                                    zIndex: i,
                                    marginLeft: cards.length > 4 && i > 0 ? 'var(--trick-card-overlap-ml)' : undefined
                                  }}
                                  className="transition-all duration-150 transform hover:scale-105"
                                >
                                   <PlayingCard 
                                     card={c} 
                                     className="shadow-md border border-white/10 pointer-events-none transform-none" 
                                     style={{ 
                                       width: 'var(--trick-card-w)', 
                                       height: 'var(--trick-card-h)' 
                                     }} 
                                     isTrump={NanningRules.isTrump(c, gameState.trumpSuit, gameState.trumpLevel)} 
                                   />
                                 </div>
                             ))}
                           </div>
                         </motion.div>
                       );
                     })
                   )}
                 </AnimatePresence>
               </div>

              {/* Collect cards & proceed button - displayed compactly in the bottom-left corner above Player 0 to stay completely out of the way */}
              {gameState.currentTrick && gameState.currentPlayer === -1 && (
                <div className="absolute bottom-[30%] sm:bottom-[31%] left-4 sm:left-8 z-[60] flex flex-col items-start gap-2 pointer-events-auto">
                  <motion.button
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleCollectTrick}
                    className="bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-[10px] sm:text-xs font-black tracking-wide shadow-[0_4px_12px_rgba(212,175,55,0.4)] border border-amber-300 transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <span>收牌 & 进入下一圈 {collectCountdown !== null ? `(${collectCountdown}秒)` : ''}</span>
                    <span className="text-[9px] bg-black/15 px-1.5 py-0.5 rounded-md font-bold">
                       {gameState.currentTrick.winner === 0 ? "我" : gameState.currentTrick.winner === 1 ? "东" : gameState.currentTrick.winner === 2 ? "北" : "西"} 赢
                    </span>
                  </motion.button>
                  
                  <div className="flex items-center gap-2 bg-black/70 px-2 py-1.5 rounded-lg border border-white/10 text-[10px] text-white/80 backdrop-blur-sm shadow-md">
                    <input
                      type="checkbox"
                      id="auto-collect-chk"
                      checked={autoCollect}
                      onChange={(e) => setAutoCollect(e.target.checked)}
                      className="accent-amber-500 cursor-pointer w-3 h-3"
                    />
                    <label htmlFor="auto-collect-chk" className="cursor-pointer font-bold select-none text-gold/90">
                      自动收牌进入下一圈
                    </label>
                  </div>
                </div>
              )}

              {/* Floating "上一圈出牌" button on the left edge of the screen during playing phase */}
              {gameState.lastTrick && gameState.phase === 'PLAYING' && (
                <div className="absolute left-2 sm:left-4 top-[35%] sm:top-[38%] z-45 pointer-events-auto">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setIsLastTrickModalOpen(true)}
                    className="flex items-center gap-1.5 bg-black/80 hover:bg-black p-2 sm:p-2.5 rounded-lg sm:rounded-xl border border-amber-500/40 shadow-[0_8px_24px_rgba(0,0,0,0.5)] cursor-pointer text-amber-300 hover:text-amber-200 transition-all text-[10px] sm:text-xs font-black select-none tracking-wider uppercase backdrop-blur-md"
                  >
                    <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-amber-500 animate-ping shrink-0" />
                    <span>查看上一圈出牌</span>
                  </motion.button>
                </div>
              )}

              {/* Floating Hand Area - Positioned absolutely at the very bottom edge of the green table area */}
              <div className="absolute bottom-1 inset-x-2 z-40 pointer-events-none flex items-end justify-center">
                <div className="max-w-[1550px] w-full pointer-events-auto">
                  <Hand 
                    cards={gameState.hands[me] || []}
                    onPlay={gameState.phase === 'BOTTOM_REPLACEMENT' ? handleReplaceBottom : handlePlay}
                    isDealing={isDealing}
                    playDisabled={
                      isDealing || 
                      (gameState.phase === 'BOTTOM_REPLACEMENT' && gameState.bankerPos !== me) ||
                      (gameState.phase === 'PLAYING' && gameState.currentPlayer !== me) ||
                      (gameState.phase !== 'BOTTOM_REPLACEMENT' && gameState.phase !== 'PLAYING')
                    }
                    playActionLabel={gameState.phase === 'BOTTOM_REPLACEMENT' ? "确认入底牌" : "确认出牌"}
                    requiredSelectionCount={gameState.phase === 'BOTTOM_REPLACEMENT' ? gameState.settings.bottomCardCount : (gameState.currentTrick ? (gameState.currentTrick.cards[gameState.currentTrick.leader]?.length) : undefined)}
                    trumpSuit={gameState.trumpSuit}
                    trumpLevel={gameState.trumpLevel}
                    phase={gameState.phase}
                    onHint={() => playAICards(me, gameState)}
                  />
                </div>
              </div>
            </div>
        </div>
      </main>



      {/* Game End Overlay */}
      {gameState.phase === 'END' && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-2xl flex items-center justify-center p-8">
           <motion.div 
             initial={{ opacity: 0, scale: 0.9 }} 
             animate={{ opacity: 1, scale: 1 }} 
             className="bg-[#111] border border-gold/30 p-12 rounded-[40px] text-center max-w-lg w-full shadow-[0_0_100px_rgba(212,175,55,0.1)]"
           >
              <h2 className="text-4xl font-bold text-gold uppercase tracking-widest mb-6">本局结算</h2>
              <p className="text-white/60 mb-8">{gameState.message}</p>
              <div className="space-y-4 mb-10">
                 <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <span className="text-white/40">庄家方</span>
                    <span className="text-2xl font-bold text-white">
                      {gameState.teams[bankerTeamIdx].isBanker ? "保庄成功" : "丢庄"}
                    </span>
                 </div>
                 <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <span className="text-white/40">闲家最终得分</span>
                    <span className="text-2xl font-bold text-gold">{gameState.teams[challengerTeamIdx].score} 分</span>
                 </div>
                 <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <span className="text-white/40">下一局庄家等级</span>
                    <span className="text-2xl font-bold text-white">{gameState.teams[bankerTeamIdx].level}</span>
                 </div>
              </div>
              <button 
                onClick={() => startNewRound(gameState.bankerPos, gameState.teams[0].level, gameState.teams[1].level)} 
                className="w-full bg-gold text-black font-bold py-4 rounded-xl hover:bg-[#ffdf7e] transition-all transform hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
              >
                开始下一局
              </button>
           </motion.div>
        </div>
      )}

      {/* Pregame Lobby / Welcome Screen - Modern & Elegant Landing Page */}
      {gameState.phase === 'PREGAME' && !showSettings && (
        <div className="fixed inset-0 z-[100] bg-[#050a07] flex flex-col items-center justify-center p-4 overflow-y-auto">
          {/* Background Ambient Glows */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#d4af37 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
          <div className="absolute -top-[40%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[#d4af37]/5 rounded-full blur-[120px] pointer-events-none" />
          
          <motion.div 
            initial={{ opacity: 0, y: 30 }} 
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", duration: 0.8 }}
            className="w-full max-w-lg flex flex-col items-center relative z-10 px-4"
          >
            {/* Logo Token */}
            <div className="w-20 h-20 sm:w-24 sm:h-24 border-2 border-gold/40 rounded-full flex items-center justify-center text-gold font-black text-4xl sm:text-5xl bg-gold/10 shadow-[0_0_50px_rgba(212,175,55,0.15)] mb-6 tracking-wide animate-pulse">
              南
            </div>

            {/* Typography Title Pairings */}
            <h1 className="text-4xl sm:text-5xl font-black text-gold tracking-[0.25em] pl-[0.25em] text-center mb-2 drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
              南宁拖拉机
            </h1>
            <p className="text-sm font-medium text-[#d4af37]/80 tracking-widest uppercase mb-10 text-center">
              经典地方特色 · 四副牌扑克对决
            </p>

            {/* Config Snapshot Panel */}
            <div className="w-full bg-black/40 border border-gold/20 rounded-[28px] p-5 sm:p-6 mb-10 backdrop-blur-md">
              <h3 className="text-xs font-bold text-[#d4af37]/60 uppercase tracking-widest mb-4 border-b border-gold/5 pb-2">
                当前房间设定
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 border border-white/5 p-3 rounded-xl flex items-center gap-3">
                  <span className="text-lg">🃏</span>
                  <div>
                    <p className="text-[10px] text-white/40 leading-none mb-1">底牌模式</p>
                    <p className="text-xs font-bold text-white/90">
                      {gameState.settings.bottomCardCount > 0 ? `${gameState.settings.bottomCardCount}张底牌` : '不发底牌'}
                    </p>
                  </div>
                </div>
                <div className="bg-white/5 border border-white/5 p-3 rounded-xl flex items-center gap-3">
                  <span className="text-lg">📢</span>
                  <div>
                    <p className="text-[10px] text-white/40 leading-none mb-1">叫牌模式</p>
                    <p className="text-xs font-bold text-white/90">
                      {gameState.settings.isPublicBid ? '明叫 (公开)' : '暗叫 (隐藏)'}
                    </p>
                  </div>
                </div>
                <div className="bg-white/5 border border-white/5 p-3 rounded-xl flex items-center gap-3">
                  <span className="text-lg">🔄</span>
                  <div>
                    <p className="text-[10px] text-white/40 leading-none mb-1">反扣规则</p>
                    <p className="text-xs font-bold text-white/90">
                      {gameState.settings.allowCounterBid ? '已启用' : '已关闭'}
                    </p>
                  </div>
                </div>
                <div className="bg-white/5 border border-white/5 p-3 rounded-xl flex items-center gap-3">
                  <span className="text-lg">⚡</span>
                  <div>
                    <p className="text-[10px] text-white/40 leading-none mb-1">允许甩牌</p>
                    <p className="text-xs font-bold text-white/90">
                      {gameState.settings.allowShuaiPai ? '已启用' : '已关闭'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Action CTAs */}
            <div className="w-full flex flex-col gap-4">
              <motion.button
                whileHover={multiplayerMode === 'online' && !isHost ? {} : { scale: 1.01 }}
                whileTap={multiplayerMode === 'online' && !isHost ? {} : { scale: 0.99 }}
                onClick={multiplayerMode === 'online' && !isHost ? undefined : startDeal}
                disabled={multiplayerMode === 'online' && !isHost}
                className={cn(
                  "w-full py-4 font-black text-base rounded-2xl tracking-widest transition-all flex items-center justify-center gap-2 border",
                  multiplayerMode === 'online' && !isHost
                    ? "bg-zinc-800 text-zinc-500 border-zinc-700 cursor-not-allowed"
                    : "bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black border-amber-300 cursor-pointer shadow-[0_12px_40px_rgba(245,158,11,0.25)]"
                )}
              >
                <span>{multiplayerMode === 'online' && !isHost ? "⏳" : "⚔️"}</span>
                <span>{multiplayerMode === 'online' && !isHost ? "等待房主开始发牌..." : "立即进入游戏"}</span>
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => setShowSettings(true)}
                className="w-full py-3.5 bg-white/5 hover:bg-white/10 active:bg-white/15 text-[#d4af37] hover:text-amber-300 font-bold text-sm rounded-2xl border border-[#d4af37]/30 hover:border-amber-400/50 tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>⚙️</span>
                <span>房间规则设定</span>
              </motion.button>
            </div>

            <p className="mt-8 text-[11px] text-white/20 select-none">
              房主授权 · 点击上方设定修改当前房间规则
            </p>
          </motion.div>
        </div>
      )}

      {/* Pregame Settings Modal - Rendered globally to avoid green felt size limits */}
      {gameState.phase === 'PREGAME' && showSettings && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center backdrop-blur-3xl p-4 sm:p-8 overflow-y-auto w-full h-full">
           <motion.div 
             initial={{ opacity: 0, scale: 0.95, y: 15 }} 
             animate={{ opacity: 1, scale: 1, y: 0 }}
             className="bg-[#111] border border-gold/30 rounded-[32px] sm:rounded-[40px] p-6 sm:p-8 max-w-xl w-full my-auto shadow-2xl"
           >
              <h2 className="text-2xl sm:text-3xl font-black text-gold mb-6 uppercase tracking-widest text-center">房间规则设定</h2>
              
              <div className="space-y-4 sm:space-y-6 mb-8 sm:mb-10">
                <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                  <div>
                    <p className="font-bold text-sm sm:text-base">叫牌模式</p>
                    <p className="text-[10px] text-white/40">明叫（可见花色） vs 暗叫（隐藏花色）</p>
                  </div>
                  <div className="flex gap-2">
                     <button 
                       disabled={multiplayerMode === 'online' && !isHost}
                       onClick={() => updateStateAndSync(prev => ({ ...prev, settings: { ...prev.settings, isPublicBid: true }}))}
                       className={cn("px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs font-bold transition-all", gameState.settings.isPublicBid ? "bg-gold text-black font-black" : "bg-white/5 text-white/40", multiplayerMode === 'online' && !isHost ? "opacity-50 cursor-not-allowed" : "")}
                     >明叫</button>
                     <button 
                       disabled={multiplayerMode === 'online' && !isHost}
                       onClick={() => updateStateAndSync(prev => ({ ...prev, settings: { ...prev.settings, isPublicBid: false }}))}
                       className={cn("px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs font-bold transition-all", !gameState.settings.isPublicBid ? "bg-gold text-black font-black" : "bg-white/5 text-white/40", multiplayerMode === 'online' && !isHost ? "opacity-50 cursor-not-allowed" : "")}
                     >暗叫</button>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                  <div>
                    <p className="font-bold text-sm sm:text-base">底牌数量</p>
                    <p className="text-[10px] text-white/40">有底（8张，需埋底） vs 无底（0张，全部发完）</p>
                  </div>
                  <div className="flex gap-2">
                     <button 
                       disabled={multiplayerMode === 'online' && !isHost}
                       onClick={() => updateStateAndSync(prev => ({ ...prev, settings: { ...prev.settings, bottomCardCount: 8 }}))}
                       className={cn("px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs font-bold transition-all", gameState.settings.bottomCardCount === 8 ? "bg-gold text-black font-black" : "bg-white/5 text-white/40", multiplayerMode === 'online' && !isHost ? "opacity-50 cursor-not-allowed" : "")}
                     >8张</button>
                     <button 
                       disabled={multiplayerMode === 'online' && !isHost}
                       onClick={() => updateStateAndSync(prev => ({ ...prev, settings: { ...prev.settings, bottomCardCount: 0 }}))}
                       className={cn("px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs font-bold transition-all", gameState.settings.bottomCardCount === 0 ? "bg-gold text-black font-black" : "bg-white/5 text-white/40", multiplayerMode === 'online' && !isHost ? "opacity-50 cursor-not-allowed" : "")}
                     >0张</button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <button 
                     disabled={multiplayerMode === 'online' && !isHost}
                     onClick={() => updateStateAndSync(prev => ({ ...prev, settings: { ...prev.settings, allowCounterBid: !prev.settings.allowCounterBid }}))}
                     className={cn("p-4 rounded-2xl border transition-all text-left", gameState.settings.allowCounterBid ? "bg-gold/10 border-gold/40" : "bg-white/5 border-white/5", multiplayerMode === 'online' && !isHost ? "opacity-50 cursor-not-allowed" : "")}
                   >
                      <p className="text-xs sm:text-sm font-bold">反扣规则</p>
                      <p className="text-[10px] opacity-40">{gameState.settings.allowCounterBid ? "已开启" : "已关闭"}</p>
                   </button>
                   <button 
                     disabled={multiplayerMode === 'online' && !isHost}
                     onClick={() => updateStateAndSync(prev => ({ ...prev, settings: { ...prev.settings, allowShuaiPai: !prev.settings.allowShuaiPai }}))}
                     className={cn("p-4 rounded-2xl border transition-all text-left", gameState.settings.allowShuaiPai ? "bg-gold/10 border-gold/40" : "bg-white/5 border-white/5", multiplayerMode === 'online' && !isHost ? "opacity-50 cursor-not-allowed" : "")}
                   >
                      <p className="text-xs sm:text-sm font-bold">允许甩牌</p>
                      <p className="text-[10px] opacity-40">{gameState.settings.allowShuaiPai ? "已开启" : "已关闭"}</p>
                   </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <button 
                  onClick={() => setShowSettings(false)}
                  className="flex-1 bg-white/5 text-[#d4af37] border border-[#d4af37]/30 hover:bg-white/10 active:bg-white/15 font-bold py-3.5 rounded-2xl transition-all cursor-pointer text-sm"
                >
                  确定并返回
                </button>
                {(!multiplayerMode || multiplayerMode === 'offline' || isHost) && (
                  <button 
                    onClick={startDeal}
                    className="flex-1 bg-gold text-black font-black py-3.5 rounded-2xl hover:bg-[#ffdf7e] transition-all shadow-[0_10px_30px_rgba(212,175,55,0.3)] hover:scale-[1.01] active:scale-[0.99] cursor-pointer text-sm"
                  >
                    开始发牌
                  </button>
                )}
              </div>
              <p className="text-[10px] text-center text-white/20">
                房主：{multiplayerMode === 'online' ? getPlayerName(gameState.bankerPos) : "我"}
              </p>
           </motion.div>
        </div>
      )}

      {/* Previous Trick Overlay */}
      <AnimatePresence>
        {isLastTrickModalOpen && gameState.lastTrick && (
          <div className="fixed inset-0 z-[110] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-[#0b150e]/95 border-2 border-[#d4af37]/45 p-5 sm:p-8 rounded-[24px] max-w-2xl w-full shadow-[0_0_50px_rgba(212,175,55,0.15)] flex flex-col gap-5 sm:gap-6"
            >
              <div className="flex justify-between items-center border-b border-white/10 pb-4">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse border border-[#d4af37]" />
                  <h3 className="text-sm sm:text-base font-black tracking-widest text-[#d4af37]">上一圈出牌记录 (已暂停)</h3>
                </div>
                <div className="text-[10px] sm:text-xs text-[#d4af37] bg-white/5 px-2.5 py-1 rounded border border-[#d4af37]/10">
                  本圈得分: <strong className="text-gold font-bold">{gameState.lastTrick.points} 分</strong>
                </div>
              </div>

              {/* Grid of players and their cards */}
              <div className="grid grid-cols-2 gap-3 sm:gap-4 my-1">
                {[0, 1, 2, 3].map((posVal) => {
                  const pos = posVal as PlayerPosition;
                  const cards = gameState.lastTrick!.cards[pos] || [];
                  const name = pos === 0 ? "我 (南家)" : pos === 1 ? "一号玩家 (东家)" : pos === 2 ? "对家 (北家)" : "三号玩家 (西家)";
                  const isLeader = gameState.lastTrick!.leader === pos;
                  const isWinner = gameState.lastTrick!.winner === pos;

                  return (
                    <div 
                      key={`last-trick-pos-${pos}`} 
                      className={cn(
                        "flex flex-col items-stretch gap-2 p-3 rounded-xl border bg-black/30",
                        isWinner ? "border-amber-500/50 bg-amber-500/[0.04]" : "border-white/5"
                      )}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-black text-white/80 flex items-center gap-1">
                          {name}
                          {isLeader && <span className="text-gold text-[9px] font-bold bg-gold/15 px-1 rounded border border-gold/10">先</span>}
                          {isWinner && <span className="text-green-400 text-[9px] font-bold bg-green-400/15 px-1 rounded border border-green-400/10">胜 ★</span>}
                        </span>
                        <span className="text-[9px] text-white/40 tabular-nums">出牌 {cards.length} 张</span>
                      </div>
                      
                      <div className="flex items-center justify-center min-h-[72px] bg-black/40 px-2 py-3 rounded-lg border border-white/5">
                        {cards.length === 0 ? (
                          <span className="text-[10px] text-white/30 italic">未出牌</span>
                        ) : (
                          <div className="flex items-center justify-center">
                            {cards.map((c, i) => (
                              <div 
                                key={c?.id || `${pos}-${i}`} 
                                style={{ 
                                  marginLeft: i === 0 ? 0 : '-18px', 
                                  zIndex: i 
                                }}
                                className="transition-all duration-150 relative"
                              >
                                <PlayingCard 
                                  card={c} 
                                  className="shadow-md border border-white/10 pointer-events-none transform-none" 
                                  style={{ 
                                    width: '42px', 
                                    height: '58px' 
                                  }} 
                                  isTrump={NanningRules.isTrump(c, gameState.trumpSuit, gameState.trumpLevel)} 
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Confirm / Close Button */}
              <div className="flex justify-center border-t border-white/10 pt-4">
                <button
                  onClick={() => setIsLastTrickModalOpen(false)}
                  className="px-8 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black font-black text-xs tracking-wider rounded-xl shadow-lg shadow-amber-500/20 active:scale-95 transition-all uppercase cursor-pointer"
                >
                  确定并继续
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {showRulesModal && (
        <div className="fixed inset-0 z-[110] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#0b140e] border-2 border-[#d4af37]/40 rounded-[24px] max-w-lg w-full p-6 text-[#e0d8cc] shadow-[0_15px_50px_rgba(0,0,0,0.8)] relative"
          >
            <button
              onClick={() => setShowRulesModal(false)}
              className="absolute top-4 right-4 text-white/50 hover:text-white/90 text-sm font-black w-7 h-7 rounded-full bg-white/5 flex items-center justify-center border border-white/10 transition-all cursor-pointer animate-fade-in"
            >
              ✕
            </button>

            <div className="flex items-center gap-2 mb-4 border-b border-[#d4af37]/20 pb-3">
              <span className="text-xl">🏆</span>
              <h2 className="text-xl font-black text-gold tracking-wide">南宁拖拉机 · 计分与规则</h2>
            </div>

            <div className="space-y-4 text-xs max-h-[380px] overflow-y-auto pr-1">
              <div className="bg-[#14261a] p-3 rounded-xl border border-[#1b8c4d]/20">
                <h3 className="font-extrabold text-[#d4af37] mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37]" />
                  基本分值设定 (5、10、K)
                </h3>
                <p className="text-white/80 leading-relaxed text-[11px]">
                  整副牌中只有以下牌点含分，其余皆无得分：
                </p>
                <div className="grid grid-cols-3 gap-2 mt-1.5 font-mono text-center">
                  <div className="bg-black/30 p-1.5 rounded border border-white/5">
                    <span className="text-red-400 font-bold">5</span> = <strong className="text-gold font-black">5分</strong>
                  </div>
                  <div className="bg-black/30 p-1.5 rounded border border-white/5">
                    <span className="text-gold font-bold">10</span> = <strong className="text-gold font-black">10分</strong>
                  </div>
                  <div className="bg-black/30 p-1.5 rounded border border-white/5">
                    <span className="text-gold font-bold">K</span> = <strong className="text-gold font-black">10分</strong>
                  </div>
                </div>
                <p className="text-[10px] text-white/40 mt-1.5 leading-tight">
                  ※ 游戏共使用 <strong className="text-gold">4副牌</strong>，整局总分为 <strong className="text-gold">400分</strong>。
                </p>
              </div>

              <div className="bg-[#14261a] p-3 rounded-xl border border-[#1b8c4d]/20">
                <h3 className="font-extrabold text-[#d4af37] mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37]" />
                  阵营与算分模式
                </h3>
                <ul className="list-disc pl-4 space-y-1 text-[#e0d8cc]/90 text-[11px]">
                  <li>
                    <strong className="text-white">庄家方 (南北)</strong>: 负责防守。庄家拿到的分自动洗掉（不计入闲家总分）。
                  </li>
                  <li>
                    <strong className="text-white">闲家方 (东西)</strong>: 负责夺分。通过压主、打副、打对来抓分，目标是累积到 <strong className="text-gold">160分</strong>。
                  </li>
                </ul>
              </div>

              <div className="bg-[#14261a] p-3 rounded-xl border border-[#1b8c4d]/20">
                <h3 className="font-extrabold text-[#d4af37] mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37]" />
                  庄家变动 & 升级标准 (160分临界值)
                </h3>
                <table className="w-full text-left text-[11px] mt-1 border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#d4af37]/20 text-[#d4af37] font-bold">
                      <th className="py-1">闲家方累计得分</th>
                      <th className="py-1 text-right">本局结算结果</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-white/95 text-left">
                    <tr>
                      <td className="py-1 flex items-center gap-1"><span className="text-green-400 font-bold">●</span> 0分 (大光)</td>
                      <td className="py-1 text-right text-gold">庄家升 3 级</td>
                    </tr>
                    <tr>
                      <td className="py-1 flex items-center gap-1"><span className="text-green-500 font-bold">●</span> 5 ~ 75分 (小光)</td>
                      <td className="py-1 text-right text-gold">庄家升 2 级</td>
                    </tr>
                    <tr>
                      <td className="py-1 flex items-center gap-1"><span className="text-yellow-500 font-bold">—</span> 80 ~ 155分</td>
                      <td className="py-1 text-right text-gold">庄家升 1 级 (保庄)</td>
                    </tr>
                    <tr className="bg-[#d4af37]/10 font-bold">
                      <td className="py-1 text-gold flex items-center gap-1 flex-row">⚡ 160 ~ 235分</td>
                      <td className="py-1 text-right text-gold">闲家夺庄 (不升级)</td>
                    </tr>
                    <tr>
                      <td className="py-1 flex items-center gap-1"><span className="text-orange-400 font-bold">▲</span> 240 ~ 315分</td>
                      <td className="py-1 text-right text-gold">闲家夺庄，并升 1 级</td>
                    </tr>
                    <tr>
                      <td className="py-1 flex items-center gap-1"><span className="text-red-500 font-bold">▲▲</span> 320分以上</td>
                      <td className="py-1 text-right text-gold">闲家夺庄，并升 2 级 (+1/80分)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="bg-[#14261a] p-3 rounded-xl border border-[#1b8c4d]/20">
                <h3 className="font-extrabold text-[#d4af37] mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37]" />
                  末圈奖励与扣牌分替代规则 (v2.0)
                </h3>
                <p className="text-white/80 leading-relaxed text-[11px]">
                  最后一圈胜出牌型不是单张时，末圈牌型张数将作为结算底牌乘数：
                  <br />
                  <strong className="text-gold">扣牌分 = 末圈记分牌分值 × 胜出牌型总张数</strong>。
                </p>
                <div className="grid grid-cols-2 gap-2 mt-1.5 text-[11px] font-medium text-white/90">
                  <div className="bg-black/25 px-2 py-1 rounded">单张胜出：<strong className="text-gold">1倍 (常规)</strong></div>
                  <div className="bg-black/25 px-2 py-1 rounded">对子胜出：<strong className="text-gold">2倍</strong></div>
                  <div className="bg-black/25 px-2 py-1 rounded">4张拖拉机：<strong className="text-gold">4倍</strong></div>
                  <div className="bg-black/25 px-2 py-1 rounded">6张推土机：<strong className="text-gold">6倍</strong></div>
                  <div className="bg-black/25 px-2 py-1 rounded">8张飞机：<strong className="text-gold">8倍</strong></div>
                </div>
                <p className="text-[10px] text-[#d4af37] mt-2 leading-normal">
                  ⚖️ <strong className="text-white font-bold">最终常规分替代：</strong>
                  <br />
                  • 闲家赢最后一圈：总分 = 前圈得分 + 扣牌分（本圈分数不重复加）
                  <br />
                  • 庄家赢最后一圈：总分 = 前圈得分 - 扣牌分（允许得分扣成负数）
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowRulesModal(false)}
              className="w-full mt-4 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-400 font-extrabold text-[#050a07] rounded-xl text-center hover:scale-102 transition-all cursor-pointer"
            >
              我知道了
            </button>
          </motion.div>
        </div>
      )}
    </div>
  );
};
