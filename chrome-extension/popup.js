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

let port = null; // port to background service worker

let state = {
  serverUrl:     'http://localhost:3000',
  roomId:        '',
  username:      'anonymous',
  color:         'cyan',
  password:      '',
  typingUsers:   new Set(),
  typingTimer:   null,
  isTyping:      false,
  userPanelOpen: false,
  connected:     false,
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
    username:  state.username,
    color:     state.color,
    roomId:    state.roomId,
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

// Load session credentials (includes password, cleared when browser closes)
function loadSessionPrefs() {
  return new Promise(resolve => {
    chrome.storage.session.get(
      ['serverUrl', 'roomId', 'username', 'color', 'password'],
      prefs => {
        if (prefs.serverUrl) state.serverUrl = prefs.serverUrl;
        if (prefs.roomId)    state.roomId    = prefs.roomId;
        if (prefs.username)  state.username  = prefs.username;
        if (prefs.color)     state.color     = prefs.color;
        if (prefs.password)  state.password  = prefs.password;
        resolve();
      }
    );
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
  state.connected = false;
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
// Background port
// ============================================================

function connectPort() {
  port = chrome.runtime.connect({ name: 'popup' });
  port.onMessage.addListener(handleBackgroundMessage);
  port.onDisconnect.addListener(() => {
    port = null;
    // Service worker was killed; retry after a short delay
    setTimeout(connectPort, 500);
  });
}

function handleBackgroundMessage(msg) {
  switch (msg.type) {

    case 'state': {
      const s = msg.payload;
      if (s.connected) {
        state.serverUrl = s.serverUrl;
        state.roomId    = s.roomId;
        state.username  = s.username;
        state.color     = s.color;
        state.connected = true;

        messagesEl.innerHTML = '';
        if (Array.isArray(s.messages)) s.messages.forEach(appendMessage);
        if (Array.isArray(s.users))    renderUsers(s.users);

        showChatScreen();
      }
      break;
    }

    case 'auth-success':
      setConnectBtnState(false);
      savePrefs();
      state.connected = true;
      showChatScreen();
      break;

    case 'auth-failed':
      setConnectBtnState(false);
      showError(msg.payload || 'Authentication failed');
      break;

    case 'connect_error':
      setConnectBtnState(false);
      showError(`Connection failed: ${msg.payload}`);
      break;

    case 'disconnected':
      state.connected = false;
      if (chatScreen.style.display !== 'none') {
        appendMessage({ type: 'system', text: 'Disconnected from server.', time: Date.now() });
        setStatus('disconnected');
      }
      break;

    case 'load-messages':
      messagesEl.innerHTML = '';
      if (Array.isArray(msg.payload)) msg.payload.forEach(appendMessage);
      break;

    case 'new-message': {
      const m = msg.payload;
      appendMessage(m);
      if (m.user) {
        state.typingUsers.delete(m.user);
        updateTypingIndicator();
      }
      break;
    }

    case 'user-list':
      renderUsers(Array.isArray(msg.payload) ? msg.payload : []);
      break;

    case 'user-typing': {
      const { username } = msg.payload;
      if (username && username !== state.username) {
        state.typingUsers.add(username);
        updateTypingIndicator();
      }
      break;
    }

    case 'user-stopped-typing': {
      const { username } = msg.payload;
      state.typingUsers.delete(username);
      updateTypingIndicator();
      break;
    }

    case 'password-set':
      appendMessage({ type: 'system', text: msg.payload, time: Date.now() });
      break;

    case 'password-failed':
      appendMessage({ type: 'system', text: msg.payload, time: Date.now() });
      break;

    case 'chat-deleted':
      messagesEl.innerHTML = '';
      appendMessage({ type: 'system', text: 'Chat history deleted.', time: Date.now() });
      break;
  }
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

  port?.postMessage({
    type:    'connect',
    payload: { serverUrl, roomId, username, color: state.color, password },
  });
}

// ============================================================
// Send message
// ============================================================

function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !state.connected) return;

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
      port?.postMessage({ type: 'update-user', payload: { username: newName, color: state.color } });
      savePrefs();
    }
    msgInput.value = '';
    stopTyping();
    return;
  }

  port?.postMessage({ type: 'send-message', payload: { text } });
  msgInput.value = '';
  stopTyping();
}

// ============================================================
// Typing notifications
// ============================================================

function startTyping() {
  port?.postMessage({ type: 'start-typing' });
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(stopTyping, 3000);
}

function stopTyping() {
  clearTimeout(state.typingTimer);
  port?.postMessage({ type: 'stop-typing' });
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
  roomIdInput.value = generateRoomId();
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
  port?.postMessage({ type: 'disconnect' });
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
  connectPort();

  await loadPrefs();
  await loadSessionPrefs(); // overwrites with more recent session values if present

  // Populate form fields
  serverUrlInput.value = state.serverUrl;
  roomIdInput.value    = state.roomId;
  usernameInput.value  = state.username !== 'anonymous' ? state.username : '';
  passwordInput.value  = state.password;

  // Highlight saved color
  colorPicker.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === state.color);
  });

  // Ask background if we are already connected — jump straight to chat if so
  port?.postMessage({ type: 'get-state' });
}

init();
