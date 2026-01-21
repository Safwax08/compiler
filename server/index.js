const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: "*", // lock later to Vercel domain
  credentials: true
}));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const roomStates = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);

    if (!roomStates.has(roomId)) {
      roomStates.set(roomId, {
        host: socket.id,
        allowedSenders: [socket.id],
        isBusy: false,
        globalSharing: false
      });
    }

    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    socket.emit('room-members', clients);
    io.to(roomId).emit('room-state-update', roomStates.get(roomId));
    socket.to(roomId).emit('user-joined', socket.id);
  });

  socket.on('signal', ({ target, signal }) => {
    io.to(target).emit('signal', { sender: socket.id, signal });
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room !== socket.id) {
        socket.to(room).emit('user-left', socket.id);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on port ${PORT}`);
});
