import { SocketIOClient } from './js/socket-io-client.js';
import { ChatCore } from './js/chat-core.js';

// ============================================================
// State
// ============================================================

let socket = null;
let core   = null;

let connState = {
  connected: false,
  serverUrl: null,
  roomId:    null,
  username:  null,
  color:     null,
};

let messages = []; // cached history (last 200)
let users    = [];

// Set of open popup ports
const activePorts = new Set();

let unreadCount = 0;

// Auto-reconnect state
let reconnectCredentials = null; // last successful credentials
let reconnectTimer       = null;
let reconnectDelay       = 2000; // ms, doubles on each failed attempt (cap 60s)
let intentionalDisconnect = false;

// ============================================================
// Helpers
// ============================================================

function broadcast(msg) {
  for (const port of activePorts) {
    try { port.postMessage(msg); } catch (_) {}
  }
}

function setBadge(count) {
  const text = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  chrome.action.setBadgeText({ text });
  if (count > 0) {
    chrome.action.setBadgeBackgroundColor({ color: '#00ff88' });
  }
}

function onNewMessage(msg) {
  messages.push(msg);
  if (messages.length > 200) messages.shift();
  broadcast({ type: 'new-message', payload: msg });

  // Increment badge when no popup is open and message is from someone else
  if (activePorts.size === 0 && msg.type !== 'system' && msg.user !== connState.username) {
    unreadCount++;
    setBadge(unreadCount);
  }
}

// ============================================================
// Auto-reconnect
// ============================================================

function scheduleReconnect() {
  if (intentionalDisconnect || reconnectTimer || !reconnectCredentials) return;

  broadcast({ type: 'reconnecting' });

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (intentionalDisconnect || !reconnectCredentials) return;
    doConnect(reconnectCredentials);
    // Increase delay for next attempt, cap at 60 s
    reconnectDelay = Math.min(reconnectDelay * 2, 60000);
  }, reconnectDelay);
}

function cancelReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

// ============================================================
// Connection management
// ============================================================

function doConnect({ serverUrl, roomId, username, color, password }) {
  if (socket) { socket.disconnect(); socket = null; core = null; }

  intentionalDisconnect = false;
  reconnectCredentials  = { serverUrl, roomId, username, color, password };
  connState = { connected: false, serverUrl, roomId, username, color };

  // Only clear history on a fresh user-initiated connect, not on auto-reconnect
  if (messages.length === 0) users = [];

  socket = new SocketIOClient();
  core   = new ChatCore(socket);

  // Socket-level error (ChatCore does not forward connect_error)
  socket.on('connect_error', (err) => {
    socket = null; core = null;
    connState.connected = false;
    // If this was the first-ever attempt (no prior session), report to popup
    if (!reconnectCredentials || reconnectDelay === 2000) {
      broadcast({ type: 'connect_error', payload: err?.message || 'Connection failed' });
    }
    scheduleReconnect();
  });

  core.addEventListener('disconnect', () => {
    connState.connected = false;
    broadcast({ type: 'disconnected' });
    scheduleReconnect();
  });

  core.addEventListener('connect', () => {
    core.join({ roomId, password, username, color });
  });

  core.addEventListener('auth-success', () => {
    connState.connected = true;
    reconnectDelay = 2000; // reset backoff on successful auth
    cancelReconnect();
    // Persist credentials for the browser session (including password)
    chrome.storage.session.set({ serverUrl, roomId, username, color, password });
    broadcast({ type: 'auth-success' });
  });

  core.addEventListener('auth-failed', (e) => {
    // Wrong password — don't retry automatically
    intentionalDisconnect = true;
    cancelReconnect();
    broadcast({ type: 'auth-failed', payload: e.detail });
    socket = null; core = null;
    connState.connected = false;
  });

  core.addEventListener('load-messages', (e) => {
    messages = Array.isArray(e.detail) ? e.detail.slice(-200) : [];
    broadcast({ type: 'load-messages', payload: messages });
  });

  core.addEventListener('new-message', (e) => {
    onNewMessage(e.detail);
  });

  core.addEventListener('user-list', (e) => {
    users = Array.isArray(e.detail) ? e.detail : [];
    broadcast({ type: 'user-list', payload: users });
  });

  core.addEventListener('user-typing', (e) => {
    broadcast({ type: 'user-typing', payload: e.detail });
  });

  core.addEventListener('user-stopped-typing', (e) => {
    broadcast({ type: 'user-stopped-typing', payload: e.detail });
  });

  core.addEventListener('password-set', (e) => {
    broadcast({ type: 'password-set', payload: e.detail });
  });

  core.addEventListener('password-failed', (e) => {
    broadcast({ type: 'password-failed', payload: e.detail });
  });

  core.addEventListener('chat-deleted', () => {
    messages = [];
    broadcast({ type: 'chat-deleted' });
  });

  socket.connect(serverUrl);
}

// ============================================================
// Popup port handling
// ============================================================

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'popup') return;

  activePorts.add(port);

  // Clear unread badge when popup opens
  unreadCount = 0;
  setBadge(0);

  port.onDisconnect.addListener(() => {
    activePorts.delete(port);
  });

  port.onMessage.addListener(msg => {
    switch (msg.type) {
      case 'get-state':
        port.postMessage({
          type:    'state',
          payload: {
            connected: connState.connected,
            serverUrl: connState.serverUrl,
            roomId:    connState.roomId,
            username:  connState.username,
            color:     connState.color,
            messages,
            users,
          },
        });
        break;

      case 'connect':
        doConnect(msg.payload);
        break;

      case 'disconnect':
        intentionalDisconnect = true;
        cancelReconnect();
        reconnectCredentials = null;
        reconnectDelay = 2000;
        if (socket) { socket.disconnect(); socket = null; core = null; }
        connState.connected = false;
        unreadCount = 0;
        setBadge(0);
        chrome.storage.session.remove(['serverUrl', 'roomId', 'username', 'color', 'password']);
        break;

      case 'send-message':
        if (core?.connected) core.send({ text: msg.payload.text });
        break;

      case 'start-typing':
        if (core?.connected) core.startTyping();
        break;

      case 'stop-typing':
        if (core?.connected) core.stopTyping();
        break;

      case 'update-user':
        if (core?.connected) {
          connState.username = msg.payload.username;
          connState.color    = msg.payload.color;
          core.updateUser(msg.payload.username, msg.payload.color);
          // Update session storage
          chrome.storage.session.set({
            username: msg.payload.username,
            color:    msg.payload.color,
          });
        }
        break;
    }
  });
});
