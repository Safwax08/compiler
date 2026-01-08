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

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);

    // Get all users in the room
    const clients = io.sockets.adapter.rooms.get(roomId);
    if (clients) {
      const users = Array.from(clients);
      // Send the list of current members to the joining user
      socket.emit('room-members', users);
      // Notify others that someone new joined
      socket.to(roomId).emit('user-joined', socket.id);
    }
  });

  socket.on('signal', ({ target, signal }) => {
    io.to(target).emit('signal', { sender: socket.id, signal });
  });

  socket.on('disconnecting', () => {
    // Notify rooms the user is leaving
    for (const room of socket.rooms) {
      if (room !== socket.id) {
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
