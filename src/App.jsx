import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';
import { v4 as uuidv4 } from 'uuid';
import DropZone from './components/DropZone';
import TransferProgress from './components/TransferProgress';
import { Copy, Check, Share2, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';

import * as buffer from 'buffer';
window.Buffer = buffer.Buffer;

const getServerUrl = () => {
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
  if (window.location.hostname === 'localhost') return 'http://localhost:3000';
  if (import.meta.env.DEV) return `http://${window.location.hostname}:3000`;
  return window.location.origin;
};

const socket = io(getServerUrl());

function App() {
  const [roomId, setRoomId] = useState('');
  const [inputRoomId, setInputRoomId] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [peers, setPeers] = useState([]);
  const [connectionState, setConnectionState] = useState('disconnected');
  const [networkPath, setNetworkPath] = useState(null);
  const [roomMembers, setRoomMembers] = useState([]);
  const [selectedPeerId, setSelectedPeerId] = useState('all');
  const [roomState, setRoomState] = useState({ host: '', allowedSenders: [], isBusy: false });
  const [files, setFiles] = useState([]);
  const [transfers, setTransfers] = useState({});
  const [clipboardText, setClipboardText] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [myId, setMyId] = useState('');

  const peerRef = useRef(null);
  const peersRef = useRef([]);

  const incomingFileRef = useRef({
    name: '', size: 0, received: 0, chunks: [], startTime: 0
  });

  const [logs, setLogs] = useState([]);
  const addLog = (msg) => setLogs(prev => [msg, ...prev].slice(0, 20));

  useEffect(() => {
    socket.on('connect', () => {
      setMyId(socket.id);
    });
    socket.on('room-state-update', (state) => setRoomState(state));
    socket.on('room-members', (users) => {
      const others = users.filter(u => u !== socket.id);
      setRoomMembers(others);
    });
    socket.on('user-joined', (userId) => {
      setRoomMembers(prev => [...new Set([...prev, userId])]);
      createPeer(userId, socket.id, true);
    });
    socket.on('user-left', (userId) => {
      setRoomMembers(prev => prev.filter(id => id !== userId));
      setPeers(prev => prev.filter(id => id !== userId));
    });
    socket.on('signal', ({ sender, signal }) => {
      const item = peersRef.current.find(p => p.peerId === sender);
      if (item) {
        if (item.peer) item.peer.signal(signal);
        else item.queue.push(signal);
      } else {
        createPeer(sender, socket.id, false, signal);
      }
    });

    return () => {
      socket.off('user-joined'); socket.off('user-left'); socket.off('room-members');
      socket.off('room-state-update'); socket.off('signal'); socket.off('connect');
    };
  }, []);

  const generateRoom = () => {
    const id = Math.random().toString(36).substring(2, 9);
    setRoomId(id);
    socket.emit('join-room', id);
    setIsJoined(true);
    setConnectionState('waiting');
  };

  const joinRoom = () => {
    if (!inputRoomId) return;
    setRoomId(inputRoomId);
    socket.emit('join-room', inputRoomId);
    setIsJoined(true);
    setConnectionState('connecting');
  };

  const createPeer = (targetId, myId, initiator, initialSignal = null) => {
    if (peersRef.current.find(p => p.peerId === targetId)) return;
    const peerPlaceholder = { peerId: targetId, peer: null, queue: [] };
    peersRef.current.push(peerPlaceholder);
    const peer = new SimplePeer({
      initiator: initiator,
      trickle: true,
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });
    peerPlaceholder.peer = peer;
    if (peerPlaceholder.queue.length > 0) {
      peerPlaceholder.queue.forEach(sig => peer.signal(sig));
      peerPlaceholder.queue = [];
    }
    peer.on('signal', (signal) => socket.emit('signal', { target: targetId, signal }));
    peer.on('connect', () => setConnectionState('connected'));
    peer.on('data', handleData);
    if (initialSignal) peer.signal(initialSignal);
    peerRef.current = peer;
    setPeers(prev => [...new Set([...prev, targetId])]);
  };

  const handleData = (data) => {
    try {
      const text = data.toString();
      if (text.startsWith('{')) {
        const meta = JSON.parse(text);
        if (meta.type === 'meta') {
          incomingFileRef.current = { name: meta.name, size: meta.size, received: 0, chunks: [], startTime: Date.now() };
          setTransfers(prev => ({ ...prev, [meta.name]: { progress: 0, speed: '0 MB/s', total: meta.size, current: 0 } }));
        } else if (meta.type === 'eof') saveFile();
        else if (meta.type === 'clipboard') setClipboardText(meta.text);
        return;
      }
    } catch (e) {}
  };

  const saveFile = () => {
    const file = incomingFileRef.current;
    const blob = new Blob(file.chunks);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = file.name; a.click();
    incomingFileRef.current = { name: '', size: 0, received: 0, chunks: [], startTime: 0 };
  };

  const handleFilesSelected = (selectedFiles) => {
    const list = Array.from(selectedFiles);
    if (connectionState === 'connected') list.forEach(f => sendFile(f));
  };

  const handleClipboardChange = (e) => {
    const text = e.target.value;
    setClipboardText(text);
    peersRef.current.forEach(t => {
      if (t.peer && !t.peer.destroyed) t.peer.send(JSON.stringify({ type: 'clipboard', text }));
    });
  };

  return (
    <div className="App">
      <AnimatePresence mode="wait">
        {!isJoined ? (
          <motion.div 
            key="lobby"
            initial={{ opacity: 1, rotateX: 0, z: 0 }}
            exit={{ opacity: 0, scale: 1.2, rotateZ: 10, transition: { duration: 0.8, ease: "easeInOut" } }}
            className="lobby-container"
            style={{ perspective: 1200 }}
          >
            <motion.div
              className="floating-bg"
              animate={{
                y: [0, -20, 0],
                rotateX: [0, 5, 0],
                rotateY: [0, -5, 0]
              }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: "easeInOut"
              }}
              style={{ perspective: 1200 }}
            >
              <header>
                <motion.h1
                  initial={{ opacity: 0, z: -100 }}
                  animate={{ opacity: 1, z: 0 }}
                  transition={{ duration: 0.8 }}
                >
                  GravityShare
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.2 }}
                >
                  Ultra-fast P2P File Transfer & Clipboard
                </motion.p>
              </header>
            </motion.div>

            <motion.div 
              className="card start-screen glass"
              initial={{ opacity: 0, rotateX: -20, y: 50 }}
              animate={{ opacity: 1, rotateX: 0, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              whileHover={{ 
                rotateX: 5, 
                rotateY: -5, 
                scale: 1.02,
                boxShadow: "0 20px 50px rgba(100, 200, 255, 0.5)"
              }}
              style={{ perspective: 1200 }}
            >
              <motion.div 
                className="option"
                whileHover={{ x: 10, rotateZ: 2 }}
              >
                <h2>Send Files</h2>
                <motion.button 
                  onClick={generateRoom} 
                  style={{ width: '100%' }}
                  whileHover={{ scale: 1.05, rotateZ: -1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Create Secure Room
                </motion.button>
              </motion.div>
              <div className="divider">SECURE P2P TUNNEL</div>
              <motion.div 
                className="option"
                whileHover={{ x: -10, rotateZ: -2 }}
              >
                <h2>Receive Files</h2>
                <div className="join-input">
                  <motion.input
                    type="text"
                    placeholder="Enter Room ID"
                    value={inputRoomId}
                    onChange={(e) => setInputRoomId(e.target.value)}
                    style={{ flex: 1 }}
                    whileFocus={{ scale: 1.05, rotateX: -5 }}
                  />
                  <motion.button 
                    onClick={joinRoom}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    Join
                  </motion.button>
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
        ) : (
          <div key="room-transition" className="room-outer-wrapper" style={{ perspective: 1500 }}>
            {/* 3D Animated Background Cubes */}
            <motion.div
              className="3d-bg-cubes"
              animate={{ rotateX: [0, 360], rotateY: [0, 360] }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            >
              <div className="cube"></div>
              <div className="cube"></div>
              <div className="cube"></div>
            </motion.div>

            {/* The 3D Double Doors with Enhanced Effects */}
            <motion.div 
              className="door left-door"
              initial={{ rotateY: 0, x: 0 }}
              animate={{ rotateY: -110, x: -50 }}
              transition={{ duration: 1.2, delay: 0.2, ease: "easeInOut" }}
              style={{ perspective: 1200 }}
            />
            <motion.div 
              className="door right-door"
              initial={{ rotateY: 0, x: 0 }}
              animate={{ rotateY: 110, x: 50 }}
              transition={{ duration: 1.2, delay: 0.2, ease: "easeInOut" }}
              style={{ perspective: 1200 }}
            />

            {/* The Room Content appearing from "inside" with 3D effect */}
            <motion.div 
              className="room-view"
              initial={{ opacity: 0, scale: 0.8, z: -500, rotateX: 20 }}
              animate={{ opacity: 1, scale: 1, z: 0, rotateX: 0 }}
              transition={{ duration: 1, delay: 0.5, ease: "easeOut" }}
              style={{ perspective: 1200 }}
            >
              <motion.div 
                className="room-info glass"
                whileHover={{ 
                  rotateX: -5, 
                  rotateY: 5, 
                  boxShadow: "0 30px 60px rgba(100, 200, 255, 0.4)"
                }}
              >
                <motion.div 
                  className="room-id-box" 
                  onTap={() => navigator.clipboard.writeText(roomId)}
                  style={{ perspective: 1000 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <span>Room: <strong>{roomId}</strong></span>
                  <Copy size={16} />
                </motion.div>
                <span className={`status-badge ${connectionState}`}>{connectionState}</span>
              </motion.div>

              <div className="split-view">
                <motion.div 
                  className="panel glass"
                  initial={{ opacity: 0, rotateX: -20, y: 50 }}
                  animate={{ opacity: 1, rotateX: 0, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.8 }}
                  whileHover={{ 
                    rotateX: 5, 
                    rotateY: -8,
                    boxShadow: "0 25px 50px rgba(100, 200, 255, 0.3)"
                  }}
                >
                  <h3>Clipboard</h3>
                  <textarea value={clipboardText} onChange={handleClipboardChange} placeholder="Type here..." />
                </motion.div>
                <motion.div 
                  className="panel glass"
                  initial={{ opacity: 0, rotateX: -20, y: 50 }}
                  animate={{ opacity: 1, rotateX: 0, y: 0 }}
                  transition={{ duration: 0.8, delay: 1 }}
                  whileHover={{ 
                    rotateX: 5, 
                    rotateY: 8,
                    boxShadow: "0 25px 50px rgba(100, 200, 255, 0.3)"
                  }}
                >
                  <h3>Files</h3>
                  <DropZone onFilesSelected={handleFilesSelected} />
                  <motion.div 
                    className="file-list"
                    layout
                  >
                    {Object.entries(transfers).map(([name, stats]) => (
                      <motion.div
                        key={name}
                        initial={{ opacity: 0, rotateX: -10, y: 20 }}
                        animate={{ opacity: 1, rotateX: 0, y: 0 }}
                        exit={{ opacity: 0, rotateX: 10, y: -20 }}
                        whileHover={{ x: 5, rotateZ: 1 }}
                      >
                        <TransferProgress fileName={name} progress={stats.progress} />
                      </motion.div>
                    ))}
                  </motion.div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;