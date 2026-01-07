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
  const [connectionState, setConnectionState] = useState('disconnected'); // disconnected, connecting, connected

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

  useEffect(() => {
    socket.on('message', (message) => {
      console.log(message);
    });

    socket.on('user-joined', (userId) => {
      console.log('User joined, initiating connection:', userId);
      // We are the initiator (existing user in room)
      createPeer(userId, socket.id, true);
    });

    socket.on('signal', ({ sender, signal }) => {
      // Find existing peer or create new one
      const item = peersRef.current.find(p => p.peerId === sender);
      if (item) {
        item.peer.signal(signal);
      } else {
        createPeer(sender, socket.id, false, signal);
      }
    });

    return () => {
      socket.off('user-joined');
      socket.off('signal');
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
    const peer = new SimplePeer({
      initiator: initiator,
      trickle: false,
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });

    peer.on('signal', (signal) => {
      socket.emit('signal', { target: targetId, signal });
    });

    peer.on('connect', () => {
      console.log('Peer connected!');
      setConnectionState('connected');
    });

    peer.on('data', handleData);

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      setConnectionState('error');
    });

    peer.on('close', () => {
      setConnectionState('disconnected');
    });

    if (initialSignal) {
      peer.signal(initialSignal);
    }

    peerRef.current = peer; // Keep reference to 1:1 peer for simplicity
    peersRef.current.push({ peerId: targetId, peer });
    setPeers(prev => [...prev, targetId]);
  };

  const handleData = (data) => {
    // Protocol: strings are JSON metadata, Buffers are file content
    try {
      const text = data.toString();
      if (text.startsWith('{')) {
        const meta = JSON.parse(text);
        if (meta.type === 'meta') {
          console.log('Starting receiving file:', meta.name);
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
          console.log('File finished');
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
    const elapsed = (Date.now() - file.startTime) / 1000;
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
    if (!peerRef.current) return;
    const peer = peerRef.current;

    // Send Metadata
    peer.send(JSON.stringify({
      type: 'meta',
      name: file.name,
      size: file.size,
      mime: file.type
    }));

    const CHUNK_SIZE = 64 * 1024; // 64KB
    let offset = 0;
    const startTime = Date.now();

    setTransfers(prev => ({
      ...prev,
      [file.name]: { progress: 0, speed: '0 MB/s', total: file.size, current: 0 }
    }));

    // Function to process chunks with backpressure
    const readNextChunk = () => {
      if (offset >= file.size) {
        peer.send(JSON.stringify({ type: 'eof' }));
        console.log('File sent complete');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = Buffer.from(e.target.result); // use Buffer from polyfill

        const header = peer.write(buffer);

        offset += buffer.length;

        // Update UI
        const percent = Math.min(100, (offset / file.size) * 100);
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = ((offset / 1024 / 1024) / elapsed).toFixed(2) + ' MB/s';

        setTransfers(prev => ({
          ...prev,
          [file.name]: {
            progress: percent,
            speed: speed,
            total: file.size,
            current: offset
          }
        }));

        if (!header) {
          // Backpressure: wait for drain
          // but simple-peer doesn't always emit drain reliably on DataChannels?
          // Actually it does.
        } else {
          // continue immediately if possible, or use timeout to yield
          setTimeout(readNextChunk, 0);
        }
      };
      reader.readAsArrayBuffer(file.slice(offset, offset + CHUNK_SIZE));
    };

    // Handle backpressure
    // WARNING: simple-peer 'drain' might not fire if we flood it too fast?
    // With FileReader async locally, it might be fine.
    // A better way is to loop.

    // Let's use a loop structure with await.

    loopChunks(file, peer);
  };

  const loopChunks = async (file, peer) => {
    const CHUNK_SIZE = 256 * 1024; // 256KB
    let offset = 0;
    const startTime = Date.now();

    while (offset < file.size) {
      const chunk = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await chunk.arrayBuffer();
      const nodeBuffer = Buffer.from(buffer); // Convert to Node Buffer for simple-peer

      if (peer.destroyed) break;

      const canWrite = peer.write(nodeBuffer);
      offset += chunk.size;

      // Update UI
      const percent = Math.min(100, (offset / file.size) * 100);
      const elapsed = (max(0.1, Date.now() - startTime)) / 1000;
      const speed = ((offset / 1024 / 1024) / elapsed).toFixed(2) + ' MB/s';

      setTransfers(prev => ({
        ...prev,
        [file.name]: {
          progress: percent,
          speed: speed,
          total: file.size,
          current: offset
        }
      }));

      if (!canWrite) {
        await new Promise(resolve => {
          const onDrain = () => {
            peer.off('drain', onDrain);
            resolve();
          };
          peer.on('drain', onDrain);
        });
      }
    }

    peer.send(JSON.stringify({ type: 'eof' }));
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
  };

  const handleClipboardChange = (e) => {
    const text = e.target.value;
    setClipboardText(text);

    // Broadcast to peer
    if (peerRef.current) {
      peerRef.current.send(JSON.stringify({
        type: 'clipboard',
        text: text
      }));
      setUploadStatus('Syncing...');
      setTimeout(() => setUploadStatus('Synced'), 500);
    }
  };

  // Debug logs state
  const [logs, setLogs] = useState([]);
  const addLog = (msg) => setLogs(prev => [msg, ...prev].slice(0, 20));

  useEffect(() => {
    socket.on('connect', () => addLog('Socket connected: ' + socket.id));
    socket.on('connect_error', (e) => addLog('Socket error: ' + e.message));

    socket.on('message', (message) => {
      console.log(message);
    });

    socket.on('user-joined', (userId) => {
      addLog('User joined: ' + userId);
      console.log('User joined, initiating connection:', userId);
      // We are the initiator (existing user in room)
      createPeer(userId, socket.id, true);
    });

    socket.on('signal', ({ sender, signal }) => {
      addLog('Signal received from: ' + sender);
      // Find existing peer or create new one
      const item = peersRef.current.find(p => p.peerId === sender);
      if (item) {
        item.peer.signal(signal);
      } else {
        createPeer(sender, socket.id, false, signal);
      }
    });

    return () => {
      socket.off('user-joined');
      socket.off('signal');
      socket.off('connect');
      socket.off('connect_error');
    };
  }, []);

  // ... (inside createPeer)
  peer.on('signal', (signal) => {
    addLog('Sending signal to: ' + targetId);
    socket.emit('signal', { target: targetId, signal });
  });

  peer.on('connect', () => {
    addLog('Peer connected!');
    console.log('Peer connected!');
    setConnectionState('connected');
  });

  peer.on('error', (err) => {
    addLog('Peer error: ' + err.message);
    console.error('Peer error:', err);
    setConnectionState('error');
  });

  // ... (inside return JSX, append logs)
  {
    connectionState !== 'connected' && (
      <div className="waiting-message">
        <p>Share this Room ID with your peer.</p>
        <div className="loader"></div>
        <div style={{ marginTop: '20px', fontSize: '0.8rem', color: '#666', textAlign: 'left', background: '#111', padding: '10px', borderRadius: '5px' }}>
          <strong>Debug Logs:</strong>
          {logs.map((log, i) => <div key={i}>{log}</div>)}
        </div>
      </div>
    )
  }
}

export default App;
