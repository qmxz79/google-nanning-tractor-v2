import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createServer as createHttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";

interface Player {
  socketId: string;
  position: number; // 0, 1, 2, 3
  name: string;
  isHost: boolean;
  isAI: boolean;
}

interface Room {
  roomId: string;
  players: Player[];
  gameState: any | null;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  const httpServer = createHttpServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Root-level rooms storage
  const rooms = new Map<string, Room>();

  // API Check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", rooms: rooms.size });
  });

  io.on("connection", (socket) => {
    let currentRoomId: string | null = null;
    let playerPosition: number | null = null;

    console.log(`Socket connected: ${socket.id}`);

    // Join room event
    socket.on("join_room", ({ roomId, position, name, isHost }) => {
      const normalizedRoomId = roomId.toUpperCase().trim();
      currentRoomId = normalizedRoomId;
      playerPosition = Number(position);

      socket.join(`room_${normalizedRoomId}`);

      let room = rooms.get(normalizedRoomId);
      if (!room) {
        room = {
          roomId: normalizedRoomId,
          players: [],
          gameState: null
        };
        rooms.set(normalizedRoomId, room);
      }

      // Check if position is occupied by active human player
      const activeOccupantIndex = room.players.findIndex(p => p.position === playerPosition && !p.isAI);
      if (activeOccupantIndex !== -1) {
        // Disconnect previous socket or replace
        room.players.splice(activeOccupantIndex, 1);
      }

      // Remove any AI occupying this seat
      const aiOccupantIndex = room.players.findIndex(p => p.position === playerPosition && p.isAI);
      if (aiOccupantIndex !== -1) {
        room.players.splice(aiOccupantIndex, 1);
      }

      // Check if host is already elected
      const hasHost = room.players.some(p => p.isHost && !p.isAI);

      const newPlayer: Player = {
        socketId: socket.id,
        position: playerPosition,
        name: name || `玩家 ${playerPosition === 0 ? '南' : playerPosition === 1 ? '东' : playerPosition === 2 ? '北' : '西'}`,
        isHost: isHost || !hasHost,
        isAI: false
      };

      room.players.push(newPlayer);

      // Keep only one host
      if (newPlayer.isHost) {
        room.players.forEach(p => {
          if (p.socketId !== socket.id) p.isHost = false;
        });
      }

      console.log(`Socket ${socket.id} joined room ${normalizedRoomId} at seat ${playerPosition}`);

      // Broadcast updated players list
      io.to(`room_${normalizedRoomId}`).emit("room_players_updated", room.players);

      // Send current game state if exists
      if (room.gameState) {
        socket.emit("game_state_updated", room.gameState);
      }
    });

    // Add computer AI player
    socket.on("add_ai_player", ({ roomId, position, name }) => {
      const normalizedRoomId = roomId.toUpperCase().trim();
      const room = rooms.get(normalizedRoomId);
      if (!room) return;

      const pos = Number(position);
      // Remove any player currently in that slot
      room.players = room.players.filter(p => p.position !== pos);

      room.players.push({
        socketId: "AI_BOT",
        position: pos,
        name: name || `电脑 AI (${pos === 0 ? '南' : pos === 1 ? '东' : pos === 2 ? '北' : '西'})`,
        isHost: false,
        isAI: true
      });

      io.to(`room_${normalizedRoomId}`).emit("room_players_updated", room.players);
    });

    // Remove AI player
    socket.on("remove_ai_player", ({ roomId, position }) => {
      const normalizedRoomId = roomId.toUpperCase().trim();
      const room = rooms.get(normalizedRoomId);
      if (!room) return;

      const pos = Number(position);
      room.players = room.players.filter(p => !(p.position === pos && p.isAI));

      io.to(`room_${normalizedRoomId}`).emit("room_players_updated", room.players);
    });

    // Sync state
    socket.on("sync_game_state", ({ roomId, gameState }) => {
      const normalizedRoomId = roomId.toUpperCase().trim();
      const room = rooms.get(normalizedRoomId);
      if (room) {
        room.gameState = gameState;
        // Broadcast to everyone else in room
        socket.to(`room_${normalizedRoomId}`).emit("game_state_updated", gameState);
      }
    });

    // Restart/Reset room game
    socket.on("restart_game", ({ roomId }) => {
      const normalizedRoomId = roomId.toUpperCase().trim();
      const room = rooms.get(normalizedRoomId);
      if (room) {
        room.gameState = null;
        io.to(`room_${normalizedRoomId}`).emit("game_restarted");
      }
    });

    // Send in-game chat message
    socket.on("send_chat_message", ({ roomId, senderName, message }) => {
      const normalizedRoomId = roomId.toUpperCase().trim();
      io.to(`room_${normalizedRoomId}`).emit("receive_chat_message", {
        id: Math.random().toString(36).substring(2, 9),
        senderName,
        message,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      });
    });

    // Disconnect
    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
      if (currentRoomId) {
        const room = rooms.get(currentRoomId);
        if (room) {
          // Remove active player
          const pIndex = room.players.findIndex(p => p.socketId === socket.id);
          if (pIndex !== -1) {
            const removedPlayer = room.players[pIndex];
            room.players.splice(pIndex, 1);

            // If room creator or host disconnected, pass inheritance to another real player
            if (removedPlayer.isHost && room.players.some(p => !p.isAI)) {
              const firstHuman = room.players.find(p => !p.isAI);
              if (firstHuman) firstHuman.isHost = true;
            }

            // Emit update list
            io.to(`room_${currentRoomId}`).emit("room_players_updated", room.players);
          }

          // If no human players left, clean up the room after 5 minutes
          const activeHumans = room.players.filter(p => !p.isAI).length;
          if (activeHumans === 0) {
            setTimeout(() => {
              const r = rooms.get(currentRoomId!);
              if (r && r.players.filter(p => !p.isAI).length === 0) {
                rooms.delete(currentRoomId!);
                console.log(`Cleaned up unused idle room: ${currentRoomId}`);
              }
            }, 300000); // 5 minutes
          }
        }
      }
    });
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(console.error);
