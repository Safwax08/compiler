# GravityShare – P2P File Transfer & Clipboard

GravityShare is an ultra-fast **peer-to-peer file transfer and clipboard sharing** web app built using **WebRTC** and **Socket.IO**.

Files are transferred **directly between browsers** — the server is used only for signaling.

---

## ✨ Features

- ⚡ **P2P File Transfer** (WebRTC, no server storage)
- 📋 **Real-time Clipboard Sync**
- 🔐 **Secure Private Rooms**
- 🎨 **3D UI Animations** (Framer Motion)
- 📱 **Responsive Design**
- 🌍 **Works Across Devices**

---

## 🛠 Tech Stack

### Frontend
- React
- Vite
- Framer Motion
- socket.io-client
- simple-peer

### Backend
- Node.js
- Express
- Socket.IO

---

## 🧠 Architecture

- **Frontend**: Hosted on Vercel  
- **Backend (Signaling Server)**: Hosted on Railway  
- **File Transfer**: Browser ↔ Browser (WebRTC)

---

## 🚀 Deployment

### Frontend (Vercel)

1. Import the repository into Vercel
2. Set **Root Directory** to `client`
3. Add environment variable:

