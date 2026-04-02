/**
 * ChatCore — shared socket protocol layer.
 *
 * Wraps any socket-like object that implements:
 *   socket.on(event, handler)
 *   socket.emit(event, data)
 *   socket.connected  (boolean)
 *   socket.id         (string, optional)
 *
 * Compatible with:
 *   - socket.io client (web app: window.io())
 *   - SocketIOClient   (Chrome extension custom WebSocket client)
 *
 * Dispatches CustomEvents for all incoming server events so consumers
 * can use addEventListener() without touching the socket directly.
 */
export class ChatCore extends EventTarget {
    constructor(socket) {
        super();
        this._socket = socket;
        this._roomId = null;
        this._username = null;
        this._color = null;
        this._isTyping = false;
        this._typingTimer = null;
        this._bindSocketEvents();
    }

    // ── Getters ──────────────────────────────────────────────────────────────

    get connected() { return this._socket.connected; }
    get roomId()    { return this._roomId; }
    get username()  { return this._username; }
    get color()     { return this._color; }
    get socketId()  { return this._socket.id ?? null; }

    // ── Room / auth ───────────────────────────────────────────────────────────

    join({ roomId, username, color, password = '' }) {
        this._roomId   = roomId;
        this._username = username;
        this._color    = color;
        this._socket.emit('join-room', { roomId, password, username, color });
    }

    setPassword(password) {
        this._socket.emit('set-password', { roomId: this._roomId, password });
    }

    deleteChat() {
        this._socket.emit('delete-chat', { roomId: this._roomId });
    }

    updateUser(username, color) {
        this._username = username;
        this._color    = color;
        this._socket.emit('update-user', { username, color });
    }

    // ── Messaging ─────────────────────────────────────────────────────────────

    /**
     * Send a message to the room.
     * @param {object} opts
     * @param {string}  opts.text
     * @param {string}  [opts.type='user']
     * @param {string}  [opts.user]      Override sender name (e.g. for system msgs)
     * @param {string}  [opts.image]
     * @param {string}  [opts.voice]
     * @param {string}  [opts.video]
     * @param {object}  [opts.replyTo]   { user, text, time }
     */
    send({ text, type = 'user', user = null, image = null, voice = null, video = null, replyTo = null } = {}) {
        this.stopTyping();
        this._socket.emit('send-message', {
            roomId:  this._roomId,
            user:    user ?? this._username,
            text,
            type,
            color:   type === 'user' ? this._color : null,
            image,
            voice,
            video,
            replyTo: replyTo ? { user: replyTo.user, text: replyTo.text, time: replyTo.time } : null,
        });
    }

    // ── Typing indicators ─────────────────────────────────────────────────────

    startTyping() {
        if (!this._isTyping) {
            this._isTyping = true;
            this._socket.emit('typing-start', { roomId: this._roomId, username: this._username });
        }
        clearTimeout(this._typingTimer);
        this._typingTimer = setTimeout(() => this.stopTyping(), 3000);
    }

    stopTyping() {
        clearTimeout(this._typingTimer);
        this._typingTimer = null;
        if (this._isTyping) {
            this._isTyping = false;
            this._socket.emit('typing-stop', { roomId: this._roomId, username: this._username });
        }
    }

    // ── Huddle (WebRTC signalling) ────────────────────────────────────────────

    startHuddle()  { this._socket.emit('huddle-start',  { roomId: this._roomId }); }
    joinHuddle()   { this._socket.emit('huddle-join',   { roomId: this._roomId }); }
    leaveHuddle()  { this._socket.emit('huddle-leave',  { roomId: this._roomId }); }
    endHuddle()    { this._socket.emit('huddle-end',    { roomId: this._roomId }); }

    sendHuddleSignal(toSocketId, signal) {
        this._socket.emit('huddle-signal', { toSocketId, signal });
    }

    // ── Internal: bind socket → CustomEvents ─────────────────────────────────

    _bindSocketEvents() {
        const s   = this._socket;
        const fwd = (event, payloadKey = 'detail') => {
            s.on(event, (data) => {
                this.dispatchEvent(new CustomEvent(event, { [payloadKey]: data }));
            });
        };

        // Connection lifecycle
        s.on('connect',    () => this.dispatchEvent(new Event('connect')));
        s.on('disconnect', () => this.dispatchEvent(new Event('disconnect')));

        // Auth
        fwd('auth-success');
        fwd('auth-failed');
        fwd('password-set');
        fwd('password-failed');

        // Messages
        fwd('load-messages');
        fwd('new-message');
        s.on('chat-deleted', () => this.dispatchEvent(new Event('chat-deleted')));

        // Users / typing
        fwd('user-list');
        fwd('user-typing');
        fwd('user-stopped-typing');

        // Huddle
        fwd('huddle-state');
        fwd('huddle-started');
        fwd('huddle-joined');
        fwd('huddle-user-joined');
        fwd('huddle-user-left');
        fwd('huddle-peer-left');
        s.on('huddle-ended', () => this.dispatchEvent(new Event('huddle-ended')));
        fwd('huddle-error');
        fwd('huddle-signal');
    }
}
