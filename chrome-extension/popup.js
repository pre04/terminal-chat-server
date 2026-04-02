// ============================================================
// Minimal Socket.io v4 Client (Engine.io v4, WebSocket only)
// No external dependencies — speaks the wire protocol directly.
// ============================================================

class SocketIOClient {
  constructor() {
    this._handlers = {};
    this.ws = null;
    this._pingTimer = null;
    this.connected = false;
    this.id = null;
  }

  connect(serverUrl) {
    const base = serverUrl.replace(/\/$/, '');
    const wsBase = base.replace(/^http/, 'ws');
    const url = `${wsBase}/socket.io/?EIO=4&transport=websocket`;

    this.ws = new WebSocket(url);
    this.ws.onmessage = ({ data }) => this._onMessage(data);
    this.ws.onclose = () => {
      this.connected = false;
      this._clearPing();
      this._emit('disconnect');
    };
    this.ws.onerror = () => {
      this._emit('connect_error', new Error('WebSocket connection failed'));
    };
  }

  _onMessage(data) {
    const eioType = data[0];

    if (eioType === '0') {
      // Engine.io OPEN — parse ping interval then send Socket.io CONNECT
      const info = JSON.parse(data.slice(1));
      this._startPing(info.pingInterval || 25000);
      this.ws.send('40'); // Socket.io: connect to default namespace
      return;
    }

    if (eioType === '3') return; // Engine.io PONG — ignore

    if (eioType === '4') {
      const sioType = data[1];

      if (sioType === '0') {
        // Socket.io CONNECT — extract sid
        const rest = data.slice(2);
        if (rest) {
          try { this.id = JSON.parse(rest).sid; } catch (_) {}
        }
        this.connected = true;
        this._emit('connect');
        return;
      }

      if (sioType === '2') {
        // Socket.io EVENT
        const payload = JSON.parse(data.slice(2));
        const [event, ...args] = payload;
        this._emit(event, ...args);
        return;
      }

      if (sioType === '1') {
        // Socket.io DISCONNECT
        this.connected = false;
        this._emit('disconnect');
        return;
      }

      if (sioType === '4') {
        // Socket.io CONNECT_ERROR
        const rest = data.slice(2);
        let msg = 'Connection error';
        try { msg = JSON.parse(rest).message || msg; } catch (_) {}
        this._emit('connect_error', new Error(msg));
        return;
      }
    }
  }

  _startPing(ms) {
    this._clearPing();
    this._pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('2');
    }, ms);
  }

  _clearPing() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }

  emit(event, data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(`42${JSON.stringify([event, data])}`);
    }
  }

  on(event, handler) {
    (this._handlers[event] ??= []).push(handler);
    return this;
  }

  off(event, handler) {
    if (handler) {
      this._handlers[event] = (this._handlers[event] || []).filter(h => h !== handler);
    } else {
      delete this._handlers[event];
    }
  }

  _emit(event, ...args) {
    (this._handlers[event] || []).forEach(h => h(...args));
  }

  disconnect() {
    this._clearPing();
    this.ws?.close();
    this.connected = false;
    this.id = null;
  }
}

// ============================================================
// Helpers
// ============================================================

const COLOR_MAP = {
  cyan:    '#00ffff',
  green:   '#00ff00',
  yellow:  '#ffff00',
  magenta: '#ff00ff',
  red:     '#ff3333',
  blue:    '#00bfff',
  orange:  '#ff8c00',
  purple:  '#bf00ff',
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function linkify(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

function formatTime(ts) {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function randomId(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ============================================================
// State
// ============================================================

let socket = null;
let state = {
  serverUrl: 'http://localhost:3000',
  roomId: '',
  username: 'anonymous',
  color: 'cyan',
  password: '',
  typingUsers: new Set(),
  typingTimer: null,
  isTyping: false,
  userPanelOpen: false,
};

// ============================================================
// DOM refs
// ============================================================

const $ = id => document.getElementById(id);

const connectScreen  = $('connect-screen');
const chatScreen     = $('chat-screen');
const serverUrlInput = $('server-url');
const roomIdInput    = $('room-id');
const usernameInput  = $('username');
const colorPicker    = $('color-picker');
const passwordInput  = $('room-password');
const connectError   = $('connect-error');
const connectBtn     = $('connect-btn');
const genRoomBtn     = $('gen-room-btn');
const openOptions    = $('open-options');

const statusDot      = $('status-dot');
const roomLabel      = $('room-label');
const userCountEl    = $('user-count');
const usersToggle    = $('users-toggle');
const disconnectBtn  = $('disconnect-btn');
const messagesEl     = $('messages');
const typingEl       = $('typing-indicator');
const userPanel      = $('user-panel');
const userList       = $('user-list');
const msgInput       = $('msg-input');
const sendBtn        = $('send-btn');

// ============================================================
// Persistence
// ============================================================

function savePrefs() {
  chrome.storage.local.set({
    serverUrl: state.serverUrl,
    username: state.username,
    color: state.color,
    roomId: state.roomId,
  });
}

function loadPrefs() {
  return new Promise(resolve => {
    chrome.storage.local.get(['serverUrl', 'username', 'color', 'roomId'], prefs => {
      if (prefs.serverUrl) state.serverUrl = prefs.serverUrl;
      if (prefs.username)  state.username  = prefs.username;
      if (prefs.color)     state.color     = prefs.color;
      if (prefs.roomId)    state.roomId    = prefs.roomId;
      resolve();
    });
  });
}

// ============================================================
// UI helpers
// ============================================================

function setStatus(mode) {
  statusDot.className = `status-dot ${mode}`;
}

function showError(msg) {
  connectError.textContent = msg;
  connectError.style.display = 'block';
}

function hideError() {
  connectError.style.display = 'none';
}

function setConnectBtnState(loading) {
  connectBtn.textContent = loading ? '[ CONNECTING... ]' : '[ CONNECT ]';
  connectBtn.disabled = loading;
}

function showChatScreen() {
  connectScreen.style.display = 'none';
  chatScreen.style.display    = 'flex';
  roomLabel.textContent = `ROOM: ${state.roomId.toUpperCase()}`;
  setStatus('connected');
  msgInput.focus();
}

function showConnectScreen() {
  chatScreen.style.display    = 'none';
  connectScreen.style.display = 'flex';
  setConnectBtnState(false);
}

function appendMessage(msg) {
  const isSystem = msg.type === 'system';
  const row = document.createElement('div');
  row.className = `msg-row${isSystem ? ' system-msg' : ''}`;

  if (!isSystem) {
    const color = COLOR_MAP[msg.color] || '#c8ffc8';
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.innerHTML = `<span class="msg-username" style="color:${color}">${escapeHtml(msg.user)}</span>` +
                     `<span class="msg-time">${formatTime(msg.time || Date.now())}</span>`;
    row.appendChild(meta);
  }

  const textEl = document.createElement('div');
  textEl.className = 'msg-text';
  textEl.innerHTML = linkify(msg.text || '');
  row.appendChild(textEl);

  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderUsers(users) {
  userCountEl.textContent = `${users.length} online`;
  userList.innerHTML = '';
  users.forEach(u => {
    const item = document.createElement('div');
    item.className = 'user-item';
    const color = COLOR_MAP[u.color] || '#c8ffc8';
    item.innerHTML = `<span class="user-dot" style="background:${color}"></span>` +
                     `<span class="user-name" style="color:${color}" title="${escapeHtml(u.username)}">${escapeHtml(u.username)}</span>`;
    userList.appendChild(item);
  });
}

function updateTypingIndicator() {
  const names = [...state.typingUsers];
  if (names.length === 0) {
    typingEl.style.display = 'none';
    typingEl.innerHTML = '';
    return;
  }
  const who = names.length === 1 ? names[0]
    : names.length === 2 ? `${names[0]} and ${names[1]}`
    : `${names[0]} and ${names.length - 1} others`;
  typingEl.style.display = 'block';
  typingEl.innerHTML = `<span class="typing-dots">${escapeHtml(who)} is typing</span>`;
}

// ============================================================
// Socket.io event handlers
// ============================================================

function bindSocketEvents(sock) {
  sock.on('connect', () => {
    setStatus('connected');
    sock.emit('join-room', {
      roomId: state.roomId,
      password: state.password,
      username: state.username,
      color: state.color,
    });
  });

  sock.on('connect_error', err => {
    setConnectBtnState(false);
    showError(`Connection failed: ${err.message}`);
    sock.disconnect();
    socket = null;
  });

  sock.on('disconnect', () => {
    if (chatScreen.style.display !== 'none') {
      appendMessage({ type: 'system', text: 'Disconnected from server.', time: Date.now() });
      setStatus('disconnected');
    }
  });

  sock.on('auth-success', () => {
    // Joined successfully — switch to chat view
    setConnectBtnState(false);
    savePrefs();
    showChatScreen();
  });

  sock.on('auth-failed', (reason) => {
    setConnectBtnState(false);
    showError(reason || 'Authentication failed');
    sock.disconnect();
    socket = null;
  });

  sock.on('load-messages', (messages) => {
    messagesEl.innerHTML = '';
    if (Array.isArray(messages)) {
      messages.forEach(appendMessage);
    }
  });

  sock.on('new-message', (msg) => {
    appendMessage(msg);
    // Clear sender from typing users
    if (msg.user) {
      state.typingUsers.delete(msg.user);
      updateTypingIndicator();
    }
  });

  sock.on('user-list', (users) => {
    renderUsers(Array.isArray(users) ? users : []);
  });

  sock.on('user-typing', ({ username }) => {
    if (username && username !== state.username) {
      state.typingUsers.add(username);
      updateTypingIndicator();
    }
  });

  sock.on('user-stopped-typing', ({ username }) => {
    state.typingUsers.delete(username);
    updateTypingIndicator();
  });

  sock.on('password-set', (msg) => {
    appendMessage({ type: 'system', text: msg, time: Date.now() });
  });

  sock.on('password-failed', (msg) => {
    appendMessage({ type: 'system', text: msg, time: Date.now() });
  });

  sock.on('chat-deleted', () => {
    messagesEl.innerHTML = '';
    appendMessage({ type: 'system', text: 'Chat history deleted.', time: Date.now() });
  });
}

// ============================================================
// Connect flow
// ============================================================

function doConnect() {
  hideError();

  const serverUrl = serverUrlInput.value.trim() || 'http://localhost:3000';
  const roomId    = roomIdInput.value.trim() || randomId();
  const username  = usernameInput.value.trim() || 'anonymous';
  const password  = passwordInput.value;

  if (!roomId) { showError('Room ID is required.'); return; }

  state.serverUrl = serverUrl;
  state.roomId    = roomId;
  state.username  = username;
  state.password  = password;

  // Handle commands
  if (username.startsWith('/')) { showError('Username cannot start with /'); return; }

  setConnectBtnState(true);
  setStatus('connecting');

  if (socket) { socket.disconnect(); socket = null; }

  socket = new SocketIOClient();
  bindSocketEvents(socket);
  socket.connect(serverUrl);
}

// ============================================================
// Send message
// ============================================================

function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !socket?.connected) return;

  // Handle slash commands locally
  if (text === '/clear') {
    messagesEl.innerHTML = '';
    msgInput.value = '';
    stopTyping();
    return;
  }

  if (text === '/room') {
    appendMessage({ type: 'system', text: `Room: ${state.roomId} | Server: ${state.serverUrl}`, time: Date.now() });
    msgInput.value = '';
    stopTyping();
    return;
  }

  if (text.startsWith('/nick ')) {
    const newName = text.slice(6).trim();
    if (newName) {
      state.username = newName;
      socket.emit('update-user', { username: newName, color: state.color });
      savePrefs();
    }
    msgInput.value = '';
    stopTyping();
    return;
  }

  socket.emit('send-message', {
    roomId:  state.roomId,
    user:    state.username,
    text,
    type:    'user',
    color:   state.color,
    image:   null,
    voice:   null,
    video:   null,
    replyTo: null,
  });

  msgInput.value = '';
  stopTyping();
}

// ============================================================
// Typing notifications
// ============================================================

function startTyping() {
  if (!state.isTyping && socket?.connected) {
    state.isTyping = true;
    socket.emit('typing-start', { roomId: state.roomId, username: state.username });
  }
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(stopTyping, 3000);
}

function stopTyping() {
  clearTimeout(state.typingTimer);
  if (state.isTyping && socket?.connected) {
    state.isTyping = false;
    socket.emit('typing-stop', { roomId: state.roomId, username: state.username });
  }
}

// ============================================================
// Event listeners
// ============================================================

// Color picker
colorPicker.addEventListener('click', e => {
  const swatch = e.target.closest('.color-swatch');
  if (!swatch) return;
  colorPicker.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  swatch.classList.add('active');
  state.color = swatch.dataset.color;
});

// Generate room ID
genRoomBtn.addEventListener('click', () => {
  roomIdInput.value = randomId();
});

// Connect button
connectBtn.addEventListener('click', doConnect);

// Enter key on connect form inputs
[serverUrlInput, roomIdInput, usernameInput, passwordInput].forEach(el => {
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') doConnect();
  });
});

// Open options page
openOptions.addEventListener('click', e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Send message
sendBtn.addEventListener('click', sendMessage);

msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

msgInput.addEventListener('input', () => {
  if (msgInput.value.trim()) {
    startTyping();
  } else {
    stopTyping();
  }
});

// Disconnect
disconnectBtn.addEventListener('click', () => {
  if (socket) { socket.disconnect(); socket = null; }
  state.typingUsers.clear();
  showConnectScreen();
});

// User panel toggle
usersToggle.addEventListener('click', () => {
  state.userPanelOpen = !state.userPanelOpen;
  userPanel.style.display = state.userPanelOpen ? 'flex' : 'none';
});

// ============================================================
// Init
// ============================================================

async function init() {
  await loadPrefs();

  // Populate form fields
  serverUrlInput.value = state.serverUrl;
  roomIdInput.value    = state.roomId;
  usernameInput.value  = state.username !== 'anonymous' ? state.username : '';

  // Highlight saved color
  colorPicker.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === state.color);
  });
}

init();
