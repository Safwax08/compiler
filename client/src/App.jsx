import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';
import { v4 as uuidv4 } from 'uuid'; // We might need to install uuid, or just use Math.random
import DropZone from './components/DropZone';
import TransferProgress from './components/TransferProgress';
import { Copy, Check, Share2, Download } from 'lucide-react';
import './App.css';

// Polyfill for process/buffer if needed explicitly, but plugin should handle it
import * as buffer from 'buffer';
window.Buffer = buffer.Buffer;

const getServerUrl = () => {
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
  if (window.location.hostname === 'localhost') return 'http://localhost:3000';
  // If in development but using IP (e.g. testing on mobile via local network)
  if (import.meta.env.DEV) {
    return `http://${window.location.hostname}:3000`;
  }
  // Production: Served by the same server
  return window.location.origin;
};

const socket = io(getServerUrl());

function App() {
  const [roomId, setRoomId] = useState('');
  const [inputRoomId, setInputRoomId] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [peers, setPeers] = useState([]); // Array of connected peers (for now assuming 1:1)
  const [connectionState, setConnectionState] = useState('disconnected'); // disconnected, connecting, connected, error
  const [networkPath, setNetworkPath] = useState(null); // null, 'Local (Wi-Fi)', 'Global (Internet)'
  const [roomMembers, setRoomMembers] = useState([]); // All users in the room
  const [selectedPeerId, setSelectedPeerId] = useState('all'); // 'all' or specific targetId
  const [roomState, setRoomState] = useState({ host: '', allowedSenders: [], isBusy: false });
  const [files, setFiles] = useState([]);
  const [transfers, setTransfers] = useState({}); // { fileName: { progress, speed, etc } }
  const [clipboardText, setClipboardText] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');

  const peerRef = useRef(null);
  const peersRef = useRef([]); // To keep track for cleanup

  // Receiver refs
  const incomingFileRef = useRef({
    name: '',
    size: 0,
    received: 0,
    chunks: [],
    startTime: 0
  });

  // Debug logs state
  const [logs, setLogs] = useState([]);
  const addLog = (msg) => setLogs(prev => [msg, ...prev].slice(0, 20));

  useEffect(() => {
    socket.on('message', (message) => {
      console.log(message);
    });

    socket.on('connect', () => addLog('Socket connected: ' + socket.id));
    socket.on('connect_error', (e) => addLog('Socket error: ' + e.message));

    socket.on('room-state-update', (state) => {
      setRoomState(state);
      if (state.isBusy) addLog('🔒 Room Busy: A transfer is in progress.');
      else addLog('🔓 Room Ready: Channel clear.');
    });

    socket.on('room-members', (users) => {
      // Filter out self
      const others = users.filter(u => u !== socket.id);
      setRoomMembers(others);
      addLog(`Room members: ${others.length} others online`);
    });

    socket.on('user-joined', (userId) => {
      addLog('User joined: ' + userId);
      setRoomMembers(prev => [...new Set([...prev, userId])]);
      // Auto-initiate connection for mesh
      createPeer(userId, socket.id, true);
    });

    socket.on('user-left', (userId) => {
      addLog('User left: ' + userId);
      setRoomMembers(prev => prev.filter(id => id !== userId));
      setPeers(prev => prev.filter(id => id !== userId));
      // Cleanup peer
      const item = peersRef.current.find(p => p.peerId === userId);
      if (item && item.peer) item.peer.destroy();
      peersRef.current = peersRef.current.filter(p => p.peerId !== userId);
    });

    socket.on('signal', ({ sender, signal }) => {
      addLog(`Signal received from: ${sender} (Type: ${signal.type || 'candidate'})`);
      const item = peersRef.current.find(p => p.peerId === sender);
      if (item) {
        if (item.peer) {
          item.peer.signal(signal);
        } else {
          // Queue signal if peer is still being constructed
          item.queue.push(signal);
        }
      } else {
        createPeer(sender, socket.id, false, signal);
      }
    });

    return () => {
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('room-members');
      socket.off('room-state-update');
      socket.off('signal');
      socket.off('connect');
      socket.off('connect_error');
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

  const copyRoomLink = () => {
    const url = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(url);
    addLog('Room link copied to clipboard!');
  };

  const retryConnection = () => {
    addLog('Retrying connection...');
    // Clean up existing peer if any
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    peersRef.current = [];
    setPeers([]);

    // Re-emit join room to trigger a new handshake sequence
    socket.emit('join-room', roomId);
    setConnectionState('connecting');
    setNetworkPath(null);
  };

  const createPeer = (targetId, myId, initiator, initialSignal = null) => {
    // Race Condition Fix: Register peer immediately to prevent duplicates
    if (peersRef.current.find(p => p.peerId === targetId)) {
      console.log('Peer already exists for target:', targetId);
      return;
    }

    addLog(`Initiating P2P Handshake (initiator: ${initiator})`);

    // Create a temporary placeholder with a signal queue
    const peerPlaceholder = { peerId: targetId, peer: null, queue: [] };
    peersRef.current.push(peerPlaceholder);

    const peer = new SimplePeer({
      initiator: initiator,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          { urls: 'stun:stun.services.mozilla.com' },
          { urls: 'stun:stun.ekiga.net' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ],
        iceCandidatePoolSize: 10
      }
    });

    // Update placeholder and flush queue
    peerPlaceholder.peer = peer;
    if (peerPlaceholder.queue.length > 0) {
      addLog(`Flushing ${peerPlaceholder.queue.length} signals from queue...`);
      peerPlaceholder.queue.forEach(sig => peer.signal(sig));
      peerPlaceholder.queue = [];
    }

    peer.on('signal', (signal) => {
      addLog(`Sending ${signal.type} to peer...`);
      socket.emit('signal', { target: targetId, signal });
    });

    peer.on('connect', () => {
      addLog('🚀 Connection established! Data channel open.');
      setConnectionState('connected');

      // Detect Network Path (Local vs Global)
      if (peer._pc) {
        setTimeout(async () => {
          try {
            const stats = await peer._pc.getStats();
            let type = 'Global (Internet)';
            stats.forEach(report => {
              if (report.type === 'remote-candidate' || report.type === 'local-candidate') {
                if (report.candidateType === 'host') {
                  // If we find a host candidate being used, it's likely local
                  // Note: This is a heuristic, a more robust way is to check the 'selected-candidate-pair'
                }
              }
              if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
                const local = stats.get(report.localCandidateId);
                const remote = stats.get(report.remoteCandidateId);
                if (local?.candidateType === 'host' && remote?.candidateType === 'host') {
                  type = 'Local (Wi-Fi)';
                }
              }
            });
            setNetworkPath(type);
            addLog(`Network Path Verified: ${type}`);
          } catch (e) {
            console.error('Stats error:', e);
          }
        }, 1000);
      }
    });

    // Diagnostic Logs
    if (peer._pc) {
      peer._pc.oniceconnectionstatechange = () => {
        const state = peer._pc.iceConnectionState;
        addLog(`ICE State: ${state}`);
        if (state === 'failed' || state === 'disconnected') {
          addLog('⚠️ Network Restriction Alert: Peer-to-peer path blocked by NAT/Firewall.');
          setConnectionState('error');
        }
      };
      peer._pc.onsignalingstatechange = () => {
        addLog(`Signaling State: ${peer._pc.signalingState}`);
      };
    }

    peer.on('data', handleData);

    peer.on('error', (err) => {
      addLog('Peer error: ' + err.message);
      if (err.code === 'ERR_ICE_CONNECTION_FAILURE') {
        setConnectionState('error');
      }
    });

    peer.on('close', () => {
      addLog('Peer connection closed.');
      if (connectionState !== 'error') setConnectionState('disconnected');

      // Cleanup
      peersRef.current = peersRef.current.filter(p => p.peerId !== targetId);
      if (peerRef.current === peer) peerRef.current = null;
      setPeers(prev => prev.filter(id => id !== targetId));
    });

    if (initialSignal) {
      addLog('Processing incoming signal...');
      peer.signal(initialSignal);
    }

    peerRef.current = peer;
    setPeers(prev => [...new Set([...prev, targetId])]);
  };

  const handleData = (data) => {
    // Protocol: strings are JSON metadata, Buffers are file content
    try {
      const text = data.toString();
      if (text.startsWith('{')) {
        const meta = JSON.parse(text);
        if (meta.type === 'meta') {
          addLog(`Receiving file: ${meta.name}`);
          incomingFileRef.current = {
            name: meta.name,
            size: meta.size,
            received: 0,
            chunks: [],
            startTime: Date.now()
          };
          setTransfers(prev => ({
            ...prev,
            [meta.name]: { progress: 0, speed: '0 MB/s', total: meta.size, current: 0 }
          }));
        } else if (meta.type === 'eof') {
          addLog(`File received: ${incomingFileRef.current.name}`);
          saveFile();
        } else if (meta.type === 'clipboard') {
          setClipboardText(meta.text);
        }
        return;
      }
    } catch (e) {
      // Not JSON, binary data
    }

    // Binary Block
    const file = incomingFileRef.current;
    if (!file.name) return; // Ignore stray data

    file.chunks.push(data);
    file.received += data.byteLength;

    // Update UI
    const percent = Math.min(100, (file.received / file.size) * 100);
    const elapsed = Math.max(0.1, (Date.now() - file.startTime) / 1000);
    const speed = ((file.received / 1024 / 1024) / elapsed).toFixed(2) + ' MB/s';

    setTransfers(prev => ({
      ...prev,
      [file.name]: {
        progress: percent,
        speed: speed,
        total: file.size,
        current: file.received
      }
    }));
  };

  const saveFile = () => {
    const file = incomingFileRef.current;
    const blob = new Blob(file.chunks);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);

    // Reset
    incomingFileRef.current = { name: '', size: 0, received: 0, chunks: [], startTime: 0 };
  };

  const sendFile = async (file) => {
    // Check Permissions
    const canSend = roomState.allowedSenders.includes(socket.id);
    if (!canSend) {
      addLog('❌ Error: You do not have permission to share in this room.');
      return;
    }

    if (roomState.isBusy) {
      addLog('⏳ Error: Another transfer is in progress. Please wait.');
      return;
    }

    let targets = [];
    if (selectedPeerId === 'all') {
      targets = peersRef.current.filter(p => p.peer && !p.peer.destroyed);
    } else {
      const target = peersRef.current.find(p => p.peerId === selectedPeerId && p.peer && !p.peer.destroyed);
      if (target) targets = [target];
    }

    if (targets.length === 0) {
      addLog('Error: No active connection to target.');
      return;
    }

    addLog(`Sending ${file.name} to ${selectedPeerId === 'all' ? 'everyone' : 'selected peer'}`);
    socket.emit('transfer-status', { roomId, isBusy: true });

    targets.forEach(t => {
      // Send Metadata
      t.peer.send(JSON.stringify({
        type: 'meta',
        name: file.name,
        size: file.size,
        mime: file.type
      }));
    });

    setTransfers(prev => ({
      ...prev,
      [file.name]: { progress: 0, speed: '0 MB/s', total: file.size, current: 0 }
    }));

    // For simplicity, we loop chunks once and parallel write to all targets
    // This isn't perfect for diverse speeds but works for P2P
    try {
      await loopChunks(file, targets.map(t => t.peer));
    } finally {
      socket.emit('transfer-status', { roomId, isBusy: false });
    }
  };

  const loopChunks = async (file, peers) => {
    const CHUNK_SIZE = 1024 * 1024;
    let offset = 0;
    const startTime = Date.now();
    let lastUpdate = 0;

    while (offset < file.size) {
      const activePeers = peers.filter(p => !p.destroyed);
      if (activePeers.length === 0) break;

      const chunk = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await chunk.arrayBuffer();
      const nodeBuffer = Buffer.from(buffer);

      activePeers.forEach(p => p.write(nodeBuffer));
      offset += chunk.size;

      const now = Date.now();
      if (now - lastUpdate > 150 || offset >= file.size) {
        const percent = Math.min(100, (offset / file.size) * 100);
        const elapsed = Math.max(0.1, (now - startTime) / 1000);
        const speed = ((offset / 1024 / 1024) / elapsed).toFixed(2) + ' MB/s';

        setTransfers(prev => ({
          ...prev,
          [file.name]: { progress: percent, speed: speed, total: file.size, current: offset }
        }));
        lastUpdate = now;
      }

      // Backpressure: Wait if ANY peer is saturated
      const needWait = activePeers.some(p => p._pc.sctp && p._pc.sctp.bufferedAmount > 4 * 1024 * 1024);
      if (needWait) {
        await new Promise(r => setTimeout(r, 50));
      }
    }
    peers.forEach(p => { if (!p.destroyed) p.send(JSON.stringify({ type: 'eof' })); });
  };

  const max = (a, b) => a > b ? a : b;

  const handleFilesSelected = (selectedFiles) => {
    // Accept FileList
    const list = Array.from(selectedFiles);
    setFiles(prev => [...prev, ...list]);

    // Auto send if connected
    if (connectionState === 'connected') {
      list.forEach(f => sendFile(f));
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(roomId);
    addLog('Room ID copied!');
  };

  const handleClipboardChange = (e) => {
    const text = e.target.value;
    setClipboardText(text);

    // Broadcast to selected peers
    let targets = [];
    if (selectedPeerId === 'all') {
      targets = peersRef.current.filter(p => p.peer && !p.peer.destroyed);
    } else {
      const target = peersRef.current.find(p => p.peerId === selectedPeerId && p.peer && !p.peer.destroyed);
      if (target) targets = [target];
    }

    targets.forEach(t => {
      t.peer.send(JSON.stringify({ type: 'clipboard', text }));
    });

    if (targets.length > 0) {
      setUploadStatus('Syncing...');
      setTimeout(() => setUploadStatus('Synced'), 500);
    }
  };

  return (
    <div className="App">
      <header>
        <h1>GravityShare</h1>
        <p>Ultra-fast P2P File Transfer & Clipboard</p>
      </header>

      {!isJoined ? (
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
                placeholder="Enter 7-digit Room ID"
                value={inputRoomId}
                onChange={(e) => setInputRoomId(e.target.value)}
                style={{ flex: 1 }}
              />
              <button onClick={joinRoom}>Join</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="room-view">
          <div className="room-info glass">
            <div className="room-id-box" onClick={copyToClipboard} style={{ cursor: 'pointer' }}>
              <span>Room: <strong>{roomId}</strong></span>
              <Copy size={16} />
            </div>
            <button className="small-btn glass" onClick={copyRoomLink} title="Copy Share Link">
              <Share2 size={16} /> Link
            </button>
            <span className={`status-badge ${connectionState}`}>
              {connectionState === 'connected' ? 'Connected' :
                connectionState === 'error' ? 'Failed' : 'Waiting...'}
            </span>
            <div className="peer-selector glass">
              <span className={`role-badge ${roomState.host === socket.id ? 'host' : 'guest'}`}>
                {roomState.host === socket.id ? 'Host' : 'Member'}
              </span>
              <span>Send to:</span>
              <select value={selectedPeerId} onChange={(e) => setSelectedPeerId(e.target.value)}>
                <option value="all">Everyone ({peers.length})</option>
                {peers.map(id => (
                  <option key={id} value={id}>{id.substring(0, 6)}... (Peer)</option>
                ))}
              </select>
            </div>
          </div>

          {roomState.host === socket.id && roomMembers.length > 0 && (
            <div className="admin-panel glass">
              <h4>Manage Sharing Permissions</h4>
              <div className="member-list">
                {roomMembers.map(id => (
                  <div key={id} className="member-item">
                    <span>{id.substring(0, 8)}...</span>
                    <button
                      className={`toggle-btn ${roomState.allowedSenders.includes(id) ? 'on' : 'off'}`}
                      onClick={() => socket.emit('set-permission', {
                        roomId,
                        userId: id,
                        allowed: !roomState.allowedSenders.includes(id)
                      })}
                    >
                      {roomState.allowedSenders.includes(id) ? 'Revoke Share' : 'Allow Share'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {roomState.isBusy && (
            <div className="busy-overlay glass">
              <div className="slow-loader"></div>
              <p>A global transfer is in progress. Please wait...</p>
            </div>
          )}

          {connectionState === 'connected' && (
            <div className="split-view">
              <div className="panel glass">
                <div className="panel-header">
                  <h3><Copy size={20} color="#646cff" /> Clipboard</h3>
                  <button className="small-btn glass" onClick={() => navigator.clipboard.writeText(clipboardText)}>Copy</button>
                </div>
                <textarea
                  placeholder="Share text or code instantly..."
                  value={clipboardText}
                  onChange={handleClipboardChange}
                ></textarea>
                <div className="clipboard-status">{uploadStatus}</div>
              </div>

              <div className="panel glass">
                <div className="panel-header">
                  <h3><Download size={20} color="#646cff" /> Files</h3>
                </div>
                <DropZone onFilesSelected={handleFilesSelected} />

                <div className="file-list">
                  {Object.entries(transfers).map(([name, stats]) => (
                    <TransferProgress
                      key={name}
                      fileName={name}
                      progress={stats.progress}
                      speed={stats.speed}
                      totalSize={(stats.total / 1024 / 1024).toFixed(1) + ' MB'}
                      transferredSize={(stats.current / 1024 / 1024).toFixed(1) + ' MB'}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {connectionState !== 'connected' && (
            <div className="waiting-message">
              {connectionState === 'error' ? (
                <div className="error-card glass" style={{ padding: '30px', textAlign: 'center' }}>
                  <h3 style={{ color: '#f87171' }}>Connection Blocked</h3>
                  <p>A direct P2P path could not be found due to network restrictions.</p>
                  <button onClick={retryConnection}>Attempt Reconnect</button>
                </div>
              ) : (
                <>
                  <p>Share the Room ID or Link with your peer.</p>
                  <div className="loader"></div>
                </>
              )}

              <div className="help-section">
                <h3>Connection Troubleshooting</h3>
                <div className="help-grid">
                  <div className="help-item">
                    <h4>Check Network</h4>
                    <p>Try matching Wi-Fi networks (best results).</p>
                  </div>
                  <div className="help-item">
                    <h4>Public Wi-Fi</h4>
                    <p>Hotels/Cafes often block P2P. Use a mobile hotspot.</p>
                  </div>
                  <div className="help-item">
                    <h4>VPN/Firewall</h4>
                    <p>Disable VPNs or Corporate Firewalls if active.</p>
                  </div>
                  <div className="help-item">
                    <h4>Mobile Data</h4>
                    <p>Switch to 4G/5G if Wi-Fi is failing.</p>
                  </div>
                </div>
              </div>

              <div className="log-panel">
                <strong>Connection Diagnostics:</strong>
                <div className="log-content" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                  {logs.length > 0 ? logs.map((log, i) => <div key={i}>{log}</div>) : <div>Awaiting signal...</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
