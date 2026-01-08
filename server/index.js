const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors({
  origin: (origin, callback) => callback(null, true), // Allow all origins with credentials
  credentials: true
}));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, true),
    methods: ["GET", "POST"],
    credentials: true
  }
});

const roomStates = new Map(); // roomId -> { host: id, allowedSenders: [], isBusy: false }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);

    // Manage Room State
    if (!roomStates.has(roomId)) {
      roomStates.set(roomId, { host: socket.id, allowedSenders: [socket.id], isBusy: false });
    }
    const state = roomStates.get(roomId);

    // Get all users in the room
    const clients = io.sockets.adapter.rooms.get(roomId);
    if (clients) {
      const users = Array.from(clients);
      socket.emit('room-members', users);
      socket.emit('room-state-update', state);
      socket.to(roomId).emit('user-joined', socket.id);
    }
  });

  socket.on('set-permission', ({ roomId, userId, allowed }) => {
    const state = roomStates.get(roomId);
    if (state && state.host === socket.id) {
      if (allowed) {
        if (!state.allowedSenders.includes(userId)) state.allowedSenders.push(userId);
      } else {
        state.allowedSenders = state.allowedSenders.filter(id => id !== userId);
      }
      io.to(roomId).emit('room-state-update', state);
    }
  });

  socket.on('transfer-status', ({ roomId, isBusy }) => {
    const state = roomStates.get(roomId);
    if (state) {
      state.isBusy = isBusy;
      io.to(roomId).emit('room-state-update', state);
    }
  });

  socket.on('signal', ({ target, signal }) => {
    io.to(target).emit('signal', { sender: socket.id, signal });
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room !== socket.id) {
        const state = roomStates.get(room);
        if (state) {
          if (state.host === socket.id) {
            // Pick a new host if possible
            const clients = io.sockets.adapter.rooms.get(room);
            const users = clients ? Array.from(clients).filter(id => id !== socket.id) : [];
            if (users.length > 0) {
              state.host = users[0];
              if (!state.allowedSenders.includes(state.host)) state.allowedSenders.push(state.host);
            } else {
              roomStates.delete(room);
            }
          }
          state.allowedSenders = state.allowedSenders.filter(id => id !== socket.id);
          socket.to(room).emit('room-state-update', state);
        }
        socket.to(room).emit('user-left', socket.id);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
