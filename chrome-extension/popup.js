import { SocketIOClient } from './js/socket-io-client.js';
import { ChatCore } from './js/chat-core.js';
import { escapeHtml, linkify, formatTime, generateRoomId, COLOR_HEX } from './js/utils.js';

// Use the popup's original color values (sourced from COLOR_HEX but the popup
// had slightly different values: red=#ff3333, blue=#00bfff, orange=#ff8c00, purple=#bf00ff)
const COLOR_MAP = {
  cyan:    COLOR_HEX.cyan,
  green:   COLOR_HEX.green,
  yellow:  COLOR_HEX.yellow,
  magenta: COLOR_HEX.magenta,
  red:     '#ff3333',
  blue:    '#00bfff',
  orange:  '#ff8c00',
  purple:  '#bf00ff',
};

// ============================================================
// State
// ============================================================

let socket = null;
let core = null;
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
// Connect flow
// ============================================================

function doConnect() {
  hideError();

  const serverUrl = serverUrlInput.value.trim() || 'http://localhost:3000';
  const roomId    = roomIdInput.value.trim() || generateRoomId();
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

  if (socket) { socket.disconnect(); socket = null; core = null; }

  socket = new SocketIOClient();
  core = new ChatCore(socket);

  // Register events BEFORE connecting
  core.addEventListener('connect', () => {
    setStatus('connected');
    core.join({
      roomId: state.roomId,
      password: state.password,
      username: state.username,
      color: state.color,
    });
  });

  core.addEventListener('connect_error', (e) => {
    const err = e.detail;
    setConnectBtnState(false);
    showError(`Connection failed: ${err.message}`);
    socket.disconnect();
    socket = null;
    core = null;
  });

  core.addEventListener('disconnect', () => {
    if (chatScreen.style.display !== 'none') {
      appendMessage({ type: 'system', text: 'Disconnected from server.', time: Date.now() });
      setStatus('disconnected');
    }
  });

  core.addEventListener('auth-success', () => {
    setConnectBtnState(false);
    savePrefs();
    showChatScreen();
  });

  core.addEventListener('auth-failed', (e) => {
    const reason = e.detail;
    setConnectBtnState(false);
    showError(reason || 'Authentication failed');
    socket.disconnect();
    socket = null;
    core = null;
  });

  core.addEventListener('load-messages', (e) => {
    const messages = e.detail;
    messagesEl.innerHTML = '';
    if (Array.isArray(messages)) {
      messages.forEach(appendMessage);
    }
  });

  core.addEventListener('new-message', (e) => {
    const msg = e.detail;
    appendMessage(msg);
    // Clear sender from typing users
    if (msg.user) {
      state.typingUsers.delete(msg.user);
      updateTypingIndicator();
    }
  });

  core.addEventListener('user-list', (e) => {
    const users = e.detail;
    renderUsers(Array.isArray(users) ? users : []);
  });

  core.addEventListener('user-typing', (e) => {
    const { username } = e.detail;
    if (username && username !== state.username) {
      state.typingUsers.add(username);
      updateTypingIndicator();
    }
  });

  core.addEventListener('user-stopped-typing', (e) => {
    const { username } = e.detail;
    state.typingUsers.delete(username);
    updateTypingIndicator();
  });

  core.addEventListener('password-set', (e) => {
    const msg = e.detail;
    appendMessage({ type: 'system', text: msg, time: Date.now() });
  });

  core.addEventListener('password-failed', (e) => {
    const msg = e.detail;
    appendMessage({ type: 'system', text: msg, time: Date.now() });
  });

  core.addEventListener('chat-deleted', () => {
    messagesEl.innerHTML = '';
    appendMessage({ type: 'system', text: 'Chat history deleted.', time: Date.now() });
  });

  // Connect AFTER registering events
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
      core.updateUser(newName, state.color);
      savePrefs();
    }
    msgInput.value = '';
    stopTyping();
    return;
  }

  core.send({ text });

  msgInput.value = '';
  stopTyping();
}

// ============================================================
// Typing notifications
// ============================================================

function startTyping() {
  if (socket?.connected) {
    core.startTyping();
  }
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(stopTyping, 3000);
}

function stopTyping() {
  clearTimeout(state.typingTimer);
  if (socket?.connected) {
    core.stopTyping();
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
  if (socket) { socket.disconnect(); socket = null; core = null; }
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
