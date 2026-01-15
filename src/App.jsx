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
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.2, transition: { duration: 0.8, ease: "easeInOut" } }}
            className="lobby-container"
          >
            <header>
              <h1>GravityShare</h1>
              <p>Ultra-fast P2P File Transfer & Clipboard</p>
            </header>
            <div className="card start-screen glass">
              <div className="option">
                <h2>Send Files</h2>
                <button onClick={generateRoom} style={{ width: '100%' }}>Create Secure Room</button>
              </div>
              <div className="divider">SECURE P2P TUNNEL</div>
              <div className="option">
                <h2>Receive Files</h2>
                <div className="join-input">
                  <input
                    type="text"
                    placeholder="Enter Room ID"
                    value={inputRoomId}
                    onChange={(e) => setInputRoomId(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button onClick={joinRoom}>Join</button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <div key="room-transition" className="room-outer-wrapper">
            {/* The 3D Double Doors */}
            <motion.div 
              className="door left-door"
              initial={{ rotateY: 0 }}
              animate={{ rotateY: -110 }}
              transition={{ duration: 1.2, delay: 0.2, ease: "easeInOut" }}
            />
            <motion.div 
              className="door right-door"
              initial={{ rotateY: 0 }}
              animate={{ rotateY: 110 }}
              transition={{ duration: 1.2, delay: 0.2, ease: "easeInOut" }}
            />

            {/* The Room Content appearing from "inside" */}
            <motion.div 
              className="room-view"
              initial={{ opacity: 0, scale: 0.8, z: -500 }}
              animate={{ opacity: 1, scale: 1, z: 0 }}
              transition={{ duration: 1, delay: 0.5, ease: "easeOut" }}
            >
              <div className="room-info glass">
                <div className="room-id-box" onClick={() => navigator.clipboard.writeText(roomId)}>
                  <span>Room: <strong>{roomId}</strong></span>
                  <Copy size={16} />
                </div>
                <span className={`status-badge ${connectionState}`}>{connectionState}</span>
              </div>

              <div className="split-view">
                <div className="panel glass">
                  <h3>Clipboard</h3>
                  <textarea value={clipboardText} onChange={handleClipboardChange} placeholder="Type here..." />
                </div>
                <div className="panel glass">
                  <h3>Files</h3>
                  <DropZone onFilesSelected={handleFilesSelected} />
                  <div className="file-list">
                    {Object.entries(transfers).map(([name, stats]) => (
                      <TransferProgress key={name} fileName={name} progress={stats.progress} />
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;