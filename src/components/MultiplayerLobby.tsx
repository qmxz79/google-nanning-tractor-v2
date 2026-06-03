import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { io, Socket } from 'socket.io-client';

interface PlayerInfo {
  socketId: string;
  position: number;
  name: string;
  isHost: boolean;
  isAI: boolean;
}

interface ChatMessage {
  id: string;
  senderName: string;
  message: string;
  timestamp: string;
}

interface MultiplayerLobbyProps {
  onJoinSuccess: (
    socket: Socket, 
    roomId: string, 
    position: number, 
    name: string, 
    isHost: boolean,
    initialPlayers?: PlayerInfo[],
    initialState?: any
  ) => void;
  onSelectOffline: () => void;
}

export const MultiplayerLobby: React.FC<MultiplayerLobbyProps> = ({ onJoinSuccess, onSelectOffline }) => {
  const [mode, setMode] = useState<'lobby_select' | 'lobby_room'>('lobby_select');
  const [roomId, setRoomId] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<number>(0);
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem('nn_player_name') || `玩家_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  });
  
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<PlayerInfo[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  // Sync state refs to prevent stale closures inside socket event handlers
  const roomPlayersRef = React.useRef<PlayerInfo[]>([]);
  const playerNameRef = React.useRef<string>(playerName);
  const selectedPositionRef = React.useRef<number>(selectedPosition);

  useEffect(() => {
    roomPlayersRef.current = roomPlayers;
  }, [roomPlayers]);

  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  useEffect(() => {
    selectedPositionRef.current = selectedPosition;
  }, [selectedPosition]);

  // Cleanup listeners on unmount (does not disconnect socket to preserve it for GameBoard)
  useEffect(() => {
    return () => {
      if (socket) {
        socket.off('room_players_updated');
        socket.off('receive_chat_message');
        socket.off('game_state_updated');
        socket.off('connect_error');
      }
    };
  }, [socket]);

  // Auto-fill roomId from URL if present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    if (code) {
      setRoomId(code.toUpperCase());
    }
  }, []);

  // Save name on edit
  useEffect(() => {
    localStorage.setItem('nn_player_name', playerName);
  }, [playerName]);

  // Handle room joining
  const handleConnect = (isCreate: boolean, chosenRoomId?: string) => {
    if (!playerName.trim()) {
      setErrorMessage("请先输入昵称");
      return;
    }
    
    let targetRoomId = (chosenRoomId || roomId).toUpperCase().trim();
    if (isCreate) {
      targetRoomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    }

    if (!targetRoomId) {
      setErrorMessage("请输入或创建房间代码");
      return;
    }

    setErrorMessage('');
    setIsConnecting(true);

    // Dynamic origin selection
    const socketUrl = window.location.origin;
    const socketInstance = io(socketUrl, {
      transports: ['websocket', 'polling']
    });

    socketInstance.on('connect', () => {
      setSocket(socketInstance);
      setIsConnecting(false);
      setMode('lobby_room');
      setRoomId(targetRoomId);

      // Join room emit
      socketInstance.emit('join_room', {
        roomId: targetRoomId,
        position: selectedPosition,
        name: playerName,
        isHost: isCreate
      });

      // Update room URL for easy sharing
      const newUrl = `${window.location.origin}${window.location.pathname}?room=${targetRoomId}`;
      window.history.replaceState({ path: newUrl }, '', newUrl);
    });

    socketInstance.on('room_players_updated', (players: PlayerInfo[]) => {
      setRoomPlayers(players);
      const myP = players.find(p => p.socketId === socketInstance.id);
      if (myP && myP.position !== selectedPositionRef.current) {
        setSelectedPosition(myP.position);
      }
    });

    socketInstance.on('game_state_updated', (incomingState: any) => {
      if (incomingState) {
        // Automatically transition guest to game board!
        const myP = roomPlayersRef.current.find(p => p.socketId === socketInstance.id);
        const myPos = myP ? myP.position : selectedPositionRef.current;
        onJoinSuccess(
          socketInstance, 
          targetRoomId, 
          myPos, 
          playerNameRef.current, 
          myP?.isHost || false, 
          roomPlayersRef.current, 
          incomingState
        );
      }
    });

    socketInstance.on('receive_chat_message', (msg: ChatMessage) => {
      setChatMessages(prev => [...prev.slice(-30), msg]); // Keep last 30 chats
    });

    socketInstance.on('connect_error', () => {
      setIsConnecting(false);
      setErrorMessage("连接服务器失败，请稍后重试");
    });
  };

  const handleSeatSelect = (pos: number) => {
    setSelectedPosition(pos);
    // If already in lobby, we want to rejoin at the new seat
    if (socket && mode === 'lobby_room') {
      socket.emit('join_room', {
        roomId,
        position: pos,
        name: playerName,
        isHost: roomPlayers.find(p => p.socketId === socket.id)?.isHost || false
      });
    }
  };

  // Add computer AI player to seat
  const handleAddAI = (pos: number) => {
    if (!socket || !isLocalHost) return;
    const aiNames = [
      ["南蛮王", "南家木兰"][pos % 2],
      ["东邪", "东方不败"][pos % 2],
      ["北丐", "北帝"][pos % 2],
      ["西毒", "西门吹雪"][pos % 2]
    ];
    socket.emit('add_ai_player', {
      roomId,
      position: pos,
      name: aiNames[pos] || `电脑机器人`
    });
  };

  // Remove AI player from seat
  const handleRemoveAI = (pos: number) => {
    if (!socket || !isLocalHost) return;
    socket.emit('remove_ai_player', {
      roomId,
      position: pos
    });
  };

  // Send chat message
  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !socket) return;
    socket.emit('send_chat_message', {
      roomId,
      senderName: playerName,
      message: chatInput
    });
    setChatInput('');
  };

  const localPlayerSocketId = socket?.id || '';
  const localPlayer = roomPlayers.find(p => p.socketId === localPlayerSocketId);
  const isLocalHost = localPlayer?.isHost || false;

  const positions = [
    { idx: 0, label: '南 (South)', color: 'border-red-500/40 text-red-400 bg-red-500/5' },
    { idx: 1, label: '东 (East)', color: 'border-blue-500/40 text-blue-400 bg-blue-500/5' },
    { idx: 2, label: '北 (North)', color: 'border-green-500/40 text-green-400 bg-green-500/5' },
    { idx: 3, label: '西 (West)', color: 'border-amber-500/40 text-amber-400 bg-amber-500/5' },
  ];

  const getOccupantAt = (pos: number) => {
    return roomPlayers.find(p => p.position === pos);
  };

  const handleStartGame = () => {
    if (!socket) return;
    
    // Auto populate empty seats with AI players to avoid game hanging
    const occupiedSeats = roomPlayers.map(p => p.position);
    let addedCount = 0;
    for (let pos = 0; pos < 4; pos++) {
      if (!occupiedSeats.includes(pos)) {
        const aiNames = [
          ["南邪", "南蛮王"][pos % 2],
          ["东邪", "东方不败"][pos % 2],
          ["北丐", "北帝"][pos % 2],
          ["西毒", "西门吹雪"][pos % 2]
        ];
        socket.emit('add_ai_player', {
          roomId,
          position: pos,
          name: aiNames[pos] || `电脑 AI`
        });
        addedCount++;
      }
    }

    const myPosInLobby = localPlayer?.position ?? selectedPosition;
    if (addedCount > 0) {
      // Small timeout to allow socket events to hit server before transitioning
      setTimeout(() => {
        onJoinSuccess(socket, roomId, myPosInLobby, playerName, isLocalHost, roomPlayers);
      }, 100);
    } else {
      onJoinSuccess(socket, roomId, myPosInLobby, playerName, isLocalHost, roomPlayers);
    }
  };

  const handleBackToSelect = () => {
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }
    setMode('lobby_select');
    // Remove query string
    const newUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.replaceState({ path: newUrl }, '', newUrl);
  };

  return (
    <div className="absolute inset-0 bg-[#050c08] flex items-center justify-center p-4 overflow-y-auto select-none overflow-x-hidden font-sans">
      {/* Background Star Ambient Effect */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#d4af37 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
      <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]" />
      
      <AnimatePresence mode="wait">
        {mode === 'lobby_select' ? (
          <motion.div 
            key="select_screen"
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-[500px] bg-gradient-to-b from-[#14231b] to-[#040c06] border border-[#d4af37]/40 rounded-[32px] p-6 sm:p-8 shadow-[0_20px_80px_rgba(0,0,0,0.85)] flex flex-col items-center relative overflow-hidden"
          >
            {/* Logo Emblem */}
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-[24px] border-2 border-gold/60 flex items-center justify-center text-gold bg-gold/10 font-bold text-3xl font-serif mb-4 shadow-[0_0_40px_rgba(212,175,55,0.15)] relative">
              南<span className="text-xs absolute bottom-1 right-1 opacity-50 font-sans">Nanning</span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-widest mb-1 text-center font-serif">南宁四副牌拖拉机</h2>
            <p className="text-xs text-gold/60 tracking-[0.2em] font-bold uppercase mb-6 text-center">Nanning Tractor Poker Lobby</p>

            {/* Error Message banner */}
            {errorMessage && (
              <div className="w-full bg-red-950/40 border border-red-500/30 rounded-xl px-4 py-2.5 text-red-400 text-xs text-center font-bold mb-4">
                ⚠️ {errorMessage}
              </div>
            )}

            {/* Name Input field */}
            <div className="w-full mb-5">
              <label className="block text-[10px] text-zinc-400 font-extrabold uppercase tracking-widest mb-1.5 pl-1.5">您的个性昵称</label>
              <input 
                type="text" 
                maxLength={10}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="起个威风响亮的名字..." 
                className="w-full bg-black/40 border border-[#d4af37]/35 focus:border-gold/80 rounded-2xl px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition-all text-center font-bold"
              />
            </div>

            {/* Join Room Section */}
            <div className="w-full bg-black/30 border border-white/5 rounded-2xl p-4 mb-5 flex flex-col gap-3">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  maxLength={6}
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  placeholder="输入4位/6位房间号" 
                  className="flex-1 bg-black/40 border border-white/10 focus:border-[#d4af37]/50 rounded-xl px-4 py-2.5 text-sm text-center text-gold font-bold tracking-widest placeholder-zinc-700 outline-none transition-all uppercase"
                />
                <button 
                  onClick={() => handleConnect(false)}
                  disabled={isConnecting}
                  className="px-5 py-2.5 bg-white/5 hover:bg-white/10 active:scale-95 text-white/90 font-bold text-xs rounded-xl border border-white/10 transition-all cursor-pointer flex items-center justify-center min-w-[70px]"
                >
                  {isConnecting ? "连接中..." : "加入房"}
                </button>
              </div>
              
              <div className="flex items-center gap-2 py-1 justify-center">
                <div className="h-px flex-1 bg-white/5" />
                <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">或者</span>
                <div className="h-px flex-1 bg-white/5" />
              </div>

              <button 
                onClick={() => handleConnect(true)}
                disabled={isConnecting}
                className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black font-black text-sm rounded-2xl tracking-widest shadow-[0_8px_30px_rgba(245,158,11,0.2)] active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-1 border border-amber-300"
              >
                🎮 创建联机新房间 (VPS)
              </button>
            </div>

            {/* Offline Solo Option */}
            <button 
              onClick={onSelectOffline}
              className="w-full py-3 bg-white/5 text-zinc-300 hover:text-white hover:bg-white/10 border border-white/5 hover:border-white/10 rounded-2xl text-xs font-black tracking-widest transition-all cursor-pointer mb-6"
            >
              🤖 本地打 bots 练习 (单人模式)
            </button>

            {/* Footer Rules */}
            <p className="text-[10px] text-zinc-500 text-center leading-relaxed">
              * 联机网络请求由 VPS 上的 WebSocket 服务直接驱动，支持 4 人实时围观或对决。
            </p>
          </motion.div>
        ) : (
          <motion.div 
            key="room_screen"
            initial={{ opacity: 0, scale: 0.95, y: -15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-[900px] bg-gradient-to-b from-[#101e16] to-[#040a06] border-2 border-[#d4af37]/40 rounded-[32px] p-5 sm:p-6 shadow-[0_20px_100px_rgba(0,0,0,0.9)] flex flex-col md:flex-row gap-5 items-stretch relative overflow-hidden"
          >
            {/* Left Area: Room & Seat coordination */}
            <div className="flex-1 flex flex-col gap-4">
              <div className="flex justify-between items-center bg-black/30 border border-white/5 p-4 rounded-2xl">
                <div>
                  <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest leading-none mb-1">正在等待好友联机入座</p>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-400 text-xs font-bold font-mono">房间代码:</span>
                    <span className="bg-gold/15 border border-gold/40 text-gold px-2.5 py-0.5 rounded-lg text-sm font-black tracking-widest">{roomId}</span>
                  </div>
                </div>
                
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?room=${roomId}`);
                    alert("房间卡链接已成功复制，发给牌友即可邀请加入！");
                  }}
                  className="px-3.5 py-1.5 bg-gold/10 hover:bg-gold/20 border border-gold/30 text-gold text-[10px] font-black rounded-lg transition-all cursor-pointer"
                >
                  🔗 复制邀请链接
                </button>
              </div>

              {/* Positions selection grid */}
              <div className="flex-1 flex flex-col gap-2.5">
                <p className="text-[10px] text-zinc-400 font-extrabold uppercase tracking-widest pl-1">请选择您的座位</p>
                <div className="grid grid-cols-2 gap-3 flex-1">
                  {positions.map((pos) => {
                    const occupant = getOccupantAt(pos.idx);
                    const isSelectedSeat = localPlayer?.position === pos.idx;
                    
                    return (
                      <div 
                        key={pos.idx}
                        className={cn(
                          "border rounded-2xl p-4 flex flex-col justify-between items-stretch transition-all relative",
                          pos.color,
                          isSelectedSeat ? "ring-2 ring-gold scale-102 bg-white/[0.02]" : "bg-black/20 hover:bg-black/30"
                        )}
                      >
                        <div className="flex justify-between items-start">
                          <span className="text-[11px] font-extrabold tracking-wide uppercase">{pos.label}</span>
                          <div className="flex gap-1.5 items-center">
                            {occupant?.isHost && (
                              <span className="text-[9px] bg-gold text-black font-black px-1.5 py-0.5 rounded leading-none">房主</span>
                            )}
                            {occupant?.isAI && (
                              <span className="text-[9px] bg-zinc-700 text-zinc-300 font-black px-1.5 py-0.5 rounded leading-none">电脑</span>
                            )}
                          </div>
                        </div>

                        <div className="my-3 min-h-[30px] flex items-center">
                          {occupant ? (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black text-white">{occupant.name}</span>
                              {occupant.socketId === localPlayerSocketId && <span className="text-[10px] bg-white/15 px-1 py-0.5 text-zinc-400 rounded">我</span>}
                            </div>
                          ) : (
                            <span className="text-xs text-zinc-600 italic">空位等候中...</span>
                          )}
                        </div>

                        <div className="flex gap-2">
                          {!occupant && (
                            <>
                              <button 
                                onClick={() => handleSeatSelect(pos.idx)}
                                className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 text-white text-xs font-bold rounded-lg border border-white/10 transition-all cursor-pointer"
                              >
                                入座此位
                              </button>
                              {isLocalHost && (
                                <button 
                                  onClick={() => handleAddAI(pos.idx)}
                                  className="py-1.5 px-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-lg border border-zinc-700 transition-all cursor-pointer"
                                  title="在空缺添加机器人"
                                >
                                  + AI
                                </button>
                              )}
                            </>
                          )}
                          {occupant && occupant.isAI && isLocalHost && (
                            <button 
                              onClick={() => handleRemoveAI(pos.idx)}
                              className="w-full py-1.5 bg-red-950/20 hover:bg-red-950/40 border border-red-500/20 text-red-400 text-xs font-bold rounded-lg transition-all cursor-pointer"
                            >
                              移去电脑
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Start game controls for the Host */}
              <div className="flex gap-3 mt-1.5">
                <button 
                  onClick={handleBackToSelect}
                  className="px-5 py-3.5 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white rounded-2xl text-xs font-black tracking-widest border border-white/5 hover:border-white/10 transition-all cursor-pointer"
                >
                  ↩ 退出房间
                </button>
                {isLocalHost ? (
                  <button 
                    onClick={handleStartGame}
                    className="flex-1 py-3.5 bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black font-black text-sm tracking-widest rounded-2xl shadow-[0_10px_35px_rgba(245,158,11,0.25)] transition-all cursor-pointer uppercase border border-amber-300 transform active:scale-98"
                  >
                    🚀 开启对局开始！ (庄家发牌)
                  </button>
                ) : (
                  <div className="flex-1 py-3.5 bg-zinc-900 border border-zinc-800 text-zinc-500 font-extrabold text-sm tracking-widest rounded-2xl flex items-center justify-center text-center animate-pulse">
                    ⏳ 等待房主开启对局...
                  </div>
                )}
              </div>
            </div>

            {/* Right Area: Room Real-time Chat Channel */}
            <div className="w-full md:w-[320px] border-t md:border-t-0 md:border-l border-white/15 pt-5 md:pt-0 md:pl-5 flex flex-col min-h-[300px]" style={{ maxHeight: '420px' }}>
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse border border-green-700" />
                  <span className="text-[10px] text-zinc-400 font-extrabold uppercase tracking-widest">房间实时茶馆聊天</span>
                </div>
                <span className="text-[10px] text-white/40 font-mono tabular-nums">{chatMessages.length}条信息</span>
              </div>

              {/* Chat log wrapper */}
              <div className="flex-1 bg-black/40 border border-white/5 rounded-2xl p-3 overflow-y-auto mb-3 flex flex-col gap-2 min-h-[180px] max-h-[300px]">
                {chatMessages.length === 0 ? (
                  <span className="text-[11px] text-zinc-600 font-bold italic text-center my-auto">
                    茶馆目前空无一人，在这儿打字可以和同房好友交流...
                  </span>
                ) : (
                  chatMessages.map(msg => (
                    <div key={msg.id} className="flex flex-col text-[11px] leading-relaxed">
                      <div className="flex justify-between items-center opacity-60 font-medium mb-0.5">
                        <span className="text-gold font-bold">{msg.senderName}</span>
                        <span className="text-[9px] scale-90 font-mono text-zinc-500">{msg.timestamp}</span>
                      </div>
                      <span className="text-zinc-200 bg-white/5 border border-white/5 rounded-xl px-2.5 py-1.5 break-words block">
                        {msg.message}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* In-game chat formulation */}
              <form onSubmit={handleSendChat} className="flex gap-2 shrink-0">
                <input 
                  type="text" 
                  maxLength={50}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="说点好听的交流下出牌策略..."
                  className="flex-1 bg-black/50 border border-white/10 focus:border-gold/40 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-700 outline-none transition-all"
                />
                <button 
                  type="submit"
                  className="px-3 py-2 bg-gold text-black rounded-xl font-bold text-xs hover:scale-103 active:scale-97 transition-all cursor-pointer"
                >
                  发送
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
