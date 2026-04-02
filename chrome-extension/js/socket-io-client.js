// Minimal Socket.io v4 Client (Engine.io v4, WebSocket only)
// No external dependencies — speaks the wire protocol directly.

export class SocketIOClient {
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
