# GravityShare - P2P File Transfer & Clipboard

Ultra-fast P2P File Transfer & Clipboard synchronization between devices.

## 🚀 Deployment to Vercel

### Client Deployment (Frontend)
The client is configured for Vercel deployment. To deploy:

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm install -g vercel
   ```

2. **Deploy to Vercel**:
   ```bash
   vercel --prod
   ```

3. **Set Environment Variables** in Vercel Dashboard:
   - Go to your project in Vercel Dashboard
   - Navigate to Settings > Environment Variables
   - Add: `VITE_SERVER_URL` with your server URL (see server deployment below)

### Server Deployment (Backend)
⚠️ **Important**: Socket.io WebSockets don't work well with Vercel's serverless functions. Deploy the server separately:

**Recommended Platforms:**
- **Railway** (recommended for WebSocket support)
- **Render**
- **Heroku**
- **DigitalOcean App Platform**

#### Deploy to Railway (Recommended):
1. Create a Railway account at [railway.app](https://railway.app)
2. Connect your GitHub repository
3. Railway will automatically detect and deploy your Node.js app
4. Copy the deployment URL

#### Alternative: Deploy to Render
1. Create a Render account at [render.com](https://render.com)
2. Create a new Web Service
3. Connect your repository
4. Set build command: `npm install`
5. Set start command: `npm start`
6. Copy the deployment URL

### Final Configuration
1. Update your Vercel environment variable `VITE_SERVER_URL` with your server URL
2. Redeploy the client: `vercel --prod`

## 🔧 Local Development

1. **Install dependencies**:
   ```bash
   npm run install-all
   ```

2. **Start the server**:
   ```bash
   cd server && npm run dev
   ```

3. **Start the client** (in another terminal):
   ```bash
   cd client && npm run dev
   ```

## 📋 Features

- **P2P File Transfer**: Direct peer-to-peer file sharing
- **Real-time Clipboard Sync**: Synchronize clipboard between devices
- **3D Animations**: Beautiful framer-motion animations
- **Responsive Design**: Works on desktop and mobile
- **Secure Rooms**: Private rooms for file transfer

## 🛠️ Tech Stack

- **Frontend**: React, Vite, Framer Motion, Socket.io-client
- **Backend**: Node.js, Express, Socket.io
- **P2P**: Simple-peer for WebRTC connections