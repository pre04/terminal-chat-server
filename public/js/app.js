import { ChatCore } from './chat-core.js';
import { escapeHtml, linkify, generateRoomId, USER_COLORS } from './utils.js';

const socket = window.io();
const core = new ChatCore(socket);
const messages = document.getElementById('messages');
const input = document.getElementById('input');
const prompt = document.getElementById('prompt');
const emojiPicker = document.getElementById('emoji-picker');
const attachBtn = document.getElementById('attach-btn');
const attachMenu = document.getElementById('attach-menu');
const imageBtn = document.getElementById('image-btn');
const imageInput = document.getElementById('image-input');
const galleryBtn = document.getElementById('gallery-btn');
const galleryInput = document.getElementById('gallery-input');
const imageModal = document.getElementById('image-modal');
const imageModalImg = document.getElementById('image-modal-img');
const imageModalClose = document.getElementById('image-modal-close');
const videoBtn = document.getElementById('video-btn');
const videoGalleryBtn = document.getElementById('video-gallery-btn');
const videoInput = document.getElementById('video-input');
const videoGalleryInput = document.getElementById('video-gallery-input');
const voiceBtn = document.getElementById('voice-btn');
const recordingIndicator = document.getElementById('recording-indicator');
const usersBtn = document.getElementById('users-btn');
const usersPanel = document.getElementById('users-panel');
const usersList = document.getElementById('users-list');
const usersCount = document.getElementById('users-count');
const gifBtn = document.getElementById('gif-btn');
const gifPicker = document.getElementById('gif-picker');
const gifSearchInput = document.getElementById('gif-search-input');
const gifResults = document.getElementById('gif-results');
const gifPickerClose = document.getElementById('gif-picker-close');

const typingIndicator = document.getElementById('typing-indicator');

let username = localStorage.getItem('chat_username') || 'guest';
let userColor = localStorage.getItem('chat_color') || 'cyan';
let roomId = new URLSearchParams(window.location.search).get('room') || (() => {
    const id = generateRoomId();
    window.history.replaceState({}, '', `?room=${id}`);
    return id;
})();
let connected = false;
let authenticated = false;
let pendingPassword = ''; // Track password being attempted
let isPageVisible = true;
let notificationsEnabled = false;
let messageReactions = JSON.parse(localStorage.getItem('reactions_' + roomId) || '{}');

// Typing indicator state
let isTyping = false;
let typingTimeout = null;
const typingUsers = new Set();

// Online users tracking
let onlineUsers = new Set();

// Voice recording state
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let gifSearchTimeout = null;

// Reply state
let replyingTo = null;
const replyIndicator = document.getElementById('reply-indicator');
const replyIndicatorAuthor = document.getElementById('reply-indicator-author');
const replyIndicatorText = document.getElementById('reply-indicator-text');
document.getElementById('reply-cancel').onclick = cancelReply;

function startReply(msgData) {
    replyingTo = msgData;
    const snippet = (msgData.text || '').substring(0, 60) + ((msgData.text || '').length > 60 ? '…' : '');
    replyIndicatorAuthor.textContent = msgData.user;
    replyIndicatorText.textContent = snippet || '[media]';
    replyIndicator.classList.add('active');
    input.focus();
}

function cancelReply() {
    replyingTo = null;
    replyIndicator.classList.remove('active');
}

const emojis = ['😀','😂','😍','🥺','😢','😡','👍','👎','❤️','🔥','🎉','💯','👀','🙏','💀','✨'];
emojiPicker.innerHTML = emojis.map(e => `<span>${e}</span>`).join('');
emojiPicker.onclick = (e) => {
    if (e.target.tagName === 'SPAN') {
        input.value += e.target.textContent;
        emojiPicker.style.display = 'none';
        input.focus();
    }
};

// Set initial username
prompt.textContent = `${username}@chat:~$`;


function addMessage(user, text, type = 'user', color = null, time = Date.now(), image = null, voice = null, video = null, replyTo = null) {
    const msg = document.createElement('div');
    msg.className = `message ${type}`;
    msg.dataset.time = time;
    msg.dataset.user = user;
    msg.dataset.text = text || '';

    if (type === 'user' && color) {
        msg.classList.add(`color-${color}`);
    }

    // HTML-escape text before linkification to prevent XSS
    const escapedText = escapeHtml(text);

    // Make URLs clickable (uses imported linkify which also escapes HTML)
    const linkifiedText = linkify(text);

    const msgId = 'msg_' + time;
    const reactions = messageReactions[msgId] || [];
    const reactionsHtml = reactions.length ? `<span class="reactions">${reactions.join('')}</span>` : '';

    // Build image HTML if present
    let imageHtml = '';
    if (image) {
        const isGif = image.endsWith('.gif') || image.includes('giphy.com') || image.includes('tenor.com') || image.includes('/media/');
        if (isGif) {
            imageHtml = `<img class="chat-gif" src="${image}" alt="GIF">`;
        } else {
            imageHtml = `<span class="image-toggle">[Show Image]</span><img class="chat-image" src="${image}" alt="Shared image">`;
        }
    }

    // Build voice HTML if present
    let voiceHtml = '';
    if (voice) {
        voiceHtml = `<span class="voice-toggle">[Play Voice Note]</span><audio class="chat-audio" src="${voice}" controls preload="metadata"></audio>`;
    }

    // Build video HTML if present
    let videoHtml = '';
    if (video) {
        videoHtml = `<span class="video-toggle">[Show Video]</span><video class="chat-video" src="${video}" controls preload="metadata"></video>`;
    }

    // Auto-detect GIF URLs in text and show them inline
    let autoGifHtml = '';
    const gifUrlMatch = text.match(/(https?:\/\/[^\s]+(\.gif|giphy\.com\/media|tenor\.com\/[^\s]+))/i);
    if (gifUrlMatch && !image) {
        autoGifHtml = `<img class="chat-gif" src="${gifUrlMatch[0]}" alt="GIF">`;
    }

    // Build reply quote if this message is a reply
    let replyQuoteHtml = '';
    if (replyTo && replyTo.user) {
        const snippet = escapeHtml((replyTo.text || '').substring(0, 80)) + ((replyTo.text || '').length > 80 ? '…' : '');
        replyQuoteHtml = `<span class="reply-quote" data-reply-time="${replyTo.time}"><span class="reply-author">↩ ${escapeHtml(replyTo.user)}:</span> ${snippet || '[media]'}</span>`;
    }

    const statusClass = (type === 'user') ? (onlineUsers.has(user) ? 'online' : 'offline') : '';
    const statusDotHtml = (type === 'user') ? `<span class="inline-status-dot ${statusClass}" data-username="${user}"></span>` : '';
    msg.innerHTML = `${replyQuoteHtml}<span style="color: #ff6b6b">[${new Date(time).toLocaleTimeString()}]</span> ${statusDotHtml}<span style="color: #4ecdc4">${escapeHtml(user)}:</span> ${linkifiedText}${reactionsHtml}${imageHtml}${voiceHtml}${videoHtml}${autoGifHtml}`;
    if (type === 'user') {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-msg-btn';
        copyBtn.textContent = '[Copy]';
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            const msgText = text || '';
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(msgText).then(() => {
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => { copyBtn.textContent = '[Copy]'; }, 1500);
                }).catch(() => {
                    fallbackCopy(msgText);
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => { copyBtn.textContent = '[Copy]'; }, 1500);
                });
            } else {
                fallbackCopy(msgText);
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = '[Copy]'; }, 1500);
            }
        };
        msg.appendChild(copyBtn);
    }
    msg.onclick = (e) => {
        // Allow text selection without triggering reactions
        const selection = window.getSelection();
        if (selection && selection.toString().trim().length > 0) {
            return;
        }
        if (e.target.classList.contains('image-toggle')) {
            const img = e.target.nextElementSibling;
            const isExpanded = img.classList.toggle('expanded');
            e.target.textContent = isExpanded ? '[Hide Image]' : '[Show Image]';
        } else if (e.target.classList.contains('voice-toggle')) {
            const audio = e.target.nextElementSibling;
            const isExpanded = audio.classList.toggle('expanded');
            e.target.textContent = isExpanded ? '[Hide Voice Note]' : '[Play Voice Note]';
            if (isExpanded) {
                audio.play();
            } else {
                audio.pause();
                audio.currentTime = 0;
            }
        } else if (e.target.classList.contains('video-toggle')) {
            const vid = e.target.nextElementSibling;
            const isExpanded = vid.classList.toggle('expanded');
            e.target.textContent = isExpanded ? '[Hide Video]' : '[Show Video]';
        } else if (e.target.tagName === 'IMG' && e.target.classList.contains('chat-gif')) {
            openImageModal(e.target.src);
        } else if (e.target.tagName === 'IMG' && e.target.classList.contains('chat-image')) {
            openImageModal(e.target.src);
        } else if (e.target.classList.contains('reply-quote') || e.target.classList.contains('reply-author')) {
            // Click on reply quote → scroll to original message
            const quoteEl = e.target.classList.contains('reply-quote') ? e.target : e.target.closest('.reply-quote');
            if (quoteEl) {
                const origTime = quoteEl.dataset.replyTime;
                const targetMsg = document.querySelector(`.message[data-time="${origTime}"]`);
                if (targetMsg) {
                    targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetMsg.classList.add('reply-highlight');
                    setTimeout(() => targetMsg.classList.remove('reply-highlight'), 1500);
                }
            }
        } else if (e.target.tagName !== 'IMG' && !e.target.classList.contains('image-toggle') && e.target.tagName !== 'AUDIO' && !e.target.classList.contains('voice-toggle') && e.target.tagName !== 'VIDEO' && !e.target.classList.contains('video-toggle')) {
            showReactionPicker(msgId, { user, text, time });
        }
    };
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
}

function openImageModal(src) {
    imageModalImg.src = src;
    imageModal.style.display = 'flex';
}

imageModalClose.onclick = () => {
    imageModal.style.display = 'none';
};

imageModal.onclick = (e) => {
    if (e.target === imageModal) {
        imageModal.style.display = 'none';
    }
};

function showReactionPicker(msgId, msgData) {
    const quickEmojis = ['👍','❤️','😂','😮','😢','🔥'];
    const existing = document.getElementById('reaction-picker');
    if (existing) existing.remove();

    const picker = document.createElement('div');
    picker.id = 'reaction-picker';
    picker.style.cssText = 'position:fixed;bottom:60px;left:10px;background:#111;border:1px solid #00ff00;padding:5px;z-index:100;';
    // Reply option at top, then emoji reactions
    const replyHtml = msgData && msgData.user
        ? `<div id="picker-reply-btn" style="cursor:pointer;padding:3px 8px;color:#00ff00;font-size:12px;border-bottom:1px solid #333;margin-bottom:4px;white-space:nowrap;">↩ Reply to ${msgData.user}</div>`
        : '';
    picker.innerHTML = replyHtml + `<span style="font-size:20px">` + quickEmojis.map(e => `<span style="cursor:pointer;margin:3px">${e}</span>`).join('') + `</span><span style="cursor:pointer;margin:3px;color:#ff6b6b;font-size:16px">✕</span>`;
    picker.onclick = (e) => {
        if (e.target.id === 'picker-reply-btn') {
            startReply(msgData);
        } else if (e.target.tagName === 'SPAN' && e.target.textContent !== '✕' && e.target.style.fontSize !== '20px') {
            addReaction(msgId, e.target.textContent);
        }
        picker.remove();
    };
    document.body.appendChild(picker);
}

function addReaction(msgId, emoji) {
    if (!messageReactions[msgId]) messageReactions[msgId] = [];
    messageReactions[msgId].push(emoji);
    localStorage.setItem('reactions_' + roomId, JSON.stringify(messageReactions));
    // Refresh display
    const msgEl = document.querySelector(`[data-time="${msgId.replace('msg_','')}"]`);
    if (msgEl) {
        let reactSpan = msgEl.querySelector('.reactions');
        if (!reactSpan) {
            reactSpan = document.createElement('span');
            reactSpan.className = 'reactions';
            msgEl.appendChild(reactSpan);
        }
        reactSpan.textContent = messageReactions[msgId].join('');
    }
}

function updateTypingIndicator() {
    if (typingUsers.size === 0) {
        typingIndicator.innerHTML = '';
        return;
    }
    const names = Array.from(typingUsers);
    let text;
    if (names.length === 1) {
        text = `${names[0]} is typing`;
    } else if (names.length === 2) {
        text = `${names[0]} and ${names[1]} are typing`;
    } else {
        const others = names.length - 1;
        text = `${names[0]} and ${others} other${others > 1 ? 's' : ''} are typing`;
    }
    typingIndicator.innerHTML = `<span>${text}</span><span class="typing-dot">.</span><span class="typing-dot">.</span><span class="typing-dot">.</span>`;
}

function emitTypingStart() {
    if (connected && authenticated) {
        core.startTyping();
    }
}

function emitTypingStop() {
    core.stopTyping();
    clearTimeout(typingTimeout);
    typingTimeout = null;
}

function sendMessage(user, text, type = 'user', image = null, voice = null, video = null) {
    emitTypingStop();
    if (connected && authenticated) {
        core.send({
            user,
            text,
            type,
            image: image,
            voice: voice,
            video: video,
            replyTo: replyingTo ? { user: replyingTo.user, text: replyingTo.text, time: replyingTo.time } : null
        });
        cancelReply();
    } else if (!authenticated) {
        addMessage('system', 'Please enter room password first', 'system');
    }
}

// Image upload handling
async function handleImageUpload(file, inputElement) {
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        addMessage('system', 'Only images are allowed (jpeg, png, gif, webp)', 'system');
        inputElement.value = '';
        return;
    }

    // Validate file size (50MB max)
    if (file.size > 50 * 1024 * 1024) {
        addMessage('system', 'Image too large. Maximum size is 50MB.', 'system');
        inputElement.value = '';
        return;
    }

    // Show uploading message
    addMessage('system', 'Uploading image...', 'system');

    try {
        // Upload via HTTP POST
        const formData = new FormData();
        formData.append('image', file);

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
        }

        const result = await response.json();
        // Send message with image URL
        sendMessage(username, '', 'user', result.url);
    } catch (error) {
        addMessage('system', `Failed to upload image: ${error.message}`, 'system');
    }

    // Reset file input
    inputElement.value = '';
}

// Video upload handling
async function handleVideoUpload(file, inputElement) {
    if (!file) return;

    // Validate file type
    const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp', 'video/x-matroska'];
    if (!allowedTypes.includes(file.type)) {
        addMessage('system', 'Only video files are allowed (mp4, webm, mov, 3gpp, mkv)', 'system');
        inputElement.value = '';
        return;
    }

    // Validate file size (100MB max)
    if (file.size > 100 * 1024 * 1024) {
        addMessage('system', 'Video too large. Maximum size is 100MB.', 'system');
        inputElement.value = '';
        return;
    }

    // Show uploading message
    addMessage('system', 'Uploading video...', 'system');

    try {
        const formData = new FormData();
        formData.append('video', file);

        const response = await fetch('/upload-video', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
        }

        const result = await response.json();
        sendMessage(username, '', 'user', null, null, result.url);
    } catch (error) {
        addMessage('system', `Failed to upload video: ${error.message}`, 'system');
    }

    inputElement.value = '';
}

// Users panel toggle
usersBtn.onclick = (e) => {
    e.stopPropagation();
    usersPanel.classList.toggle('open');
};

// Attachment menu toggle
attachBtn.onclick = (e) => {
    e.stopPropagation();
    attachMenu.classList.toggle('open');
};
document.addEventListener('click', (e) => {
    if (!e.target.closest('#attach-wrapper')) {
        attachMenu.classList.remove('open');
    }
    if (!e.target.closest('#users-panel') && !e.target.closest('#users-btn')) {
        usersPanel.classList.remove('open');
    }
    if (!e.target.closest('#gif-picker') && !e.target.closest('#gif-btn')) {
        gifPicker.classList.remove('open');
    }
});

imageBtn.onclick = () => { attachMenu.classList.remove('open'); imageInput.click(); };
galleryBtn.onclick = () => { attachMenu.classList.remove('open'); galleryInput.click(); };

imageInput.onchange = (e) => handleImageUpload(e.target.files[0], imageInput);
galleryInput.onchange = (e) => handleImageUpload(e.target.files[0], galleryInput);

videoBtn.onclick = () => { attachMenu.classList.remove('open'); videoInput.click(); };
videoGalleryBtn.onclick = () => { attachMenu.classList.remove('open'); videoGalleryInput.click(); };

videoInput.onchange = (e) => handleVideoUpload(e.target.files[0], videoInput);
videoGalleryInput.onchange = (e) => handleVideoUpload(e.target.files[0], videoGalleryInput);

// Voice recording handling
voiceBtn.onclick = async () => {
    attachMenu.classList.remove('open');
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
};

// GIF picker handling
gifBtn.onclick = () => {
    attachMenu.classList.remove('open');
    gifPicker.classList.toggle('open');
    if (gifPicker.classList.contains('open')) {
        gifSearchInput.value = '';
        gifSearchInput.focus();
        loadGifs('');
    }
};

gifPickerClose.onclick = () => {
    gifPicker.classList.remove('open');
};

gifSearchInput.addEventListener('input', () => {
    clearTimeout(gifSearchTimeout);
    gifSearchTimeout = setTimeout(() => {
        loadGifs(gifSearchInput.value.trim());
    }, 300);
});

async function loadGifs(query) {
    gifResults.innerHTML = '<div id="gif-loading">Searching...</div>';
    try {
        const endpoint = query 
            ? `/api/gifs?q=${encodeURIComponent(query)}&limit=20`
            : `/api/gifs/trending?limit=20`;
        const response = await fetch(endpoint);
        const data = await response.json();
        
        if (!data.gifs || data.gifs.length === 0) {
            gifResults.innerHTML = '<div id="gif-loading">No GIFs found</div>';
            return;
        }
        
        gifResults.innerHTML = '';
        data.gifs.forEach(gif => {
            const item = document.createElement('div');
            item.className = 'gif-result-item';
            item.innerHTML = `<img src="${gif.preview}" alt="${gif.title}" loading="lazy">`;
            item.onclick = () => {
                sendMessage(username, '', 'user', gif.url);
                gifPicker.classList.remove('open');
            };
            gifResults.appendChild(item);
        });
    } catch (error) {
        gifResults.innerHTML = '<div id="gif-loading">Failed to load GIFs</div>';
        console.error('GIF load error:', error);
    }
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Determine best supported format
        let mimeType = 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
            mimeType = 'audio/ogg';
        }

        mediaRecorder = new MediaRecorder(stream, { mimeType });
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                audioChunks.push(e.data);
            }
        };

        mediaRecorder.onstop = async () => {
            // Stop all tracks
            stream.getTracks().forEach(track => track.stop());

            if (audioChunks.length === 0) {
                addMessage('system', 'No audio recorded', 'system');
                return;
            }

            const audioBlob = new Blob(audioChunks, { type: mimeType });

            // Check size (20MB max)
            if (audioBlob.size > 20 * 1024 * 1024) {
                addMessage('system', 'Voice note too large. Maximum size is 20MB.', 'system');
                return;
            }

            // Upload the voice note
            addMessage('system', 'Uploading voice note...', 'system');

            try {
                const formData = new FormData();
                // Determine file extension from mime type
                let ext = '.webm';
                if (mimeType.includes('mp4') || mimeType.includes('m4a')) ext = '.m4a';
                else if (mimeType.includes('ogg')) ext = '.ogg';

                formData.append('voice', audioBlob, `voice${ext}`);

                const response = await fetch('/upload-voice', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Upload failed');
                }

                const result = await response.json();
                sendMessage(username, '', 'user', null, result.url);
            } catch (error) {
                addMessage('system', `Failed to upload voice note: ${error.message}`, 'system');
            }
        };

        mediaRecorder.start(100); // Collect data every 100ms
        isRecording = true;
        voiceBtn.classList.add('recording');
        recordingIndicator.classList.add('active');
        addMessage('system', 'Recording... Tap 🎤 again to stop', 'system');

    } catch (error) {
        console.error('Microphone access error:', error);
        if (error.name === 'NotAllowedError') {
            addMessage('system', 'Microphone access denied. Please allow microphone access in your browser settings.', 'system');
        } else if (error.name === 'NotFoundError') {
            addMessage('system', 'No microphone found. Please connect a microphone.', 'system');
        } else {
            addMessage('system', `Could not access microphone: ${error.message}`, 'system');
        }
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    isRecording = false;
    voiceBtn.classList.remove('recording');
    recordingIndicator.classList.remove('active');
}

function joinRoom(password = '') {
    if (connected) {
        pendingPassword = password;
        core.join({ roomId, password, username, color: userColor });
    }
}

// Socket events
core.addEventListener('connect', () => {
    connected = true;
    // Try stored password first, otherwise join without password
    const storedPassword = localStorage.getItem('chat_password_' + roomId) || '';
    joinRoom(storedPassword);
    addMessage('system', `Connecting to room: ${roomId}`, 'system');
});

core.addEventListener('auth-success', () => {
    authenticated = true;
    // Store successful password for auto-reconnect
    if (pendingPassword) {
        localStorage.setItem('chat_password_' + roomId, pendingPassword);
    }
    addMessage('system', `Connected to room: ${roomId}`, 'system');
    if (username !== 'guest') {
        addMessage('system', `Nickname restored: ${username}`, 'system');
    }
    addMessage('system', `Share URL: ${window.location.href}`, 'system');
});

core.addEventListener('auth-failed', (e) => {
    const message = e.detail;
    authenticated = false;
    // Clear stored password since it's wrong
    localStorage.removeItem('chat_password_' + roomId);
    addMessage('system', `Access denied: ${message}`, 'system');
    addMessage('system', 'Use /password <password> to enter room', 'system');
});

core.addEventListener('password-set', (e) => {
    const message = e.detail;
    addMessage('system', message, 'system');
});

core.addEventListener('password-failed', (e) => {
    const message = e.detail;
    addMessage('system', message, 'system');
});

core.addEventListener('disconnect', () => {
    connected = false;
    addMessage('system', 'Disconnected from server', 'status');
});

core.addEventListener('load-messages', (e) => {
    const roomMessages = e.detail;
    roomMessages.forEach(msg => {
        addMessage(msg.user, msg.text, msg.type, msg.color, msg.time, msg.image, msg.voice, msg.video, msg.replyTo);
    });
});

core.addEventListener('new-message', (e) => {
    const message = e.detail;
    addMessage(message.user, message.text, message.type, message.color, message.time, message.image, message.voice, message.video, message.replyTo);
    
    // Debug logging
    console.log('New message:', message.user, 'Current user:', username, 'Page visible:', isPageVisible, 'Notifications enabled:', notificationsEnabled);
    
    // Show notification if page is not visible and it's not from current user
    if (!isPageVisible && message.user !== username && message.type === 'user' && notificationsEnabled) {
        console.log('Showing notification for:', message.user, message.text);
        showNotification(message.user, message.text);
    }
});

core.addEventListener('chat-deleted', () => {
    messages.innerHTML = '';
    addMessage('system', 'Chat history deleted by user', 'system');
});

core.addEventListener('user-list', (e) => {
    const users = e.detail;
    usersCount.textContent = users.length;
    usersList.innerHTML = users.map(u =>
        `<div class="user-entry"><span class="status-dot online"></span><span class="color-${u.color || 'cyan'}">${u.username}</span></div>`
    ).join('');

    // Update online users set and refresh inline status dots
    onlineUsers = new Set(users.map(u => u.username));
    document.querySelectorAll('.inline-status-dot').forEach(dot => {
        const name = dot.dataset.username;
        dot.classList.toggle('online', onlineUsers.has(name));
        dot.classList.toggle('offline', !onlineUsers.has(name));
    });
});

core.addEventListener('user-typing', (e) => {
    const data = e.detail;
    typingUsers.add(data.username);
    updateTypingIndicator();
});

core.addEventListener('user-stopped-typing', (e) => {
    const data = e.detail;
    typingUsers.delete(data.username);
    updateTypingIndicator();
});

// Input handling with mobile support
input.addEventListener('focus', () => {
    setTimeout(() => {
        messages.scrollTop = messages.scrollHeight;
    }, 100);
});

// Handle mobile keyboard resize
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        document.getElementById('terminal').style.height = window.visualViewport.height + 'px';
        messages.scrollTop = messages.scrollHeight;
    });
}

input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (input.value.trim()) {
            handleMessage(input.value.trim());
            input.value = '';
            input.style.height = 'auto';
        }
    }
});

input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';

    // Typing indicator: emit start, then reset stop timer
    if (input.value.trim()) {
        emitTypingStart();
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(emitTypingStop, 3000);
    } else {
        emitTypingStop();
    }
});

// Add send button for mobile (invisible but functional)
const sendButton = document.createElement('button');
sendButton.style.display = 'none';
sendButton.onclick = () => {
    if (input.value.trim()) {
        handleMessage(input.value.trim());
        input.value = '';
    }
};
document.body.appendChild(sendButton);

// Handle form submission on mobile
input.addEventListener('blur', () => {
    // Small delay to allow for button clicks
    setTimeout(() => {
        if (!gifPicker.classList.contains('open') && document.activeElement !== gifSearchInput) {
            input.focus();
        }
    }, 100);
});

async function handleMessage(text) {
    if (text.startsWith('/nick ')) {
        const newNick = text.substring(6).trim();
        if (!newNick) {
            addMessage('system', 'Usage: /nick <name>', 'system');
            return;
        }
        username = newNick;
        localStorage.setItem('chat_username', username);
        prompt.textContent = `${username}@chat:~$`;
        core.updateUser(username, userColor);
        sendMessage('system', `${username} joined the chat`, 'system');
    } else if (text.startsWith('/color ')) {
        const newColor = text.substring(7).toLowerCase();
        // Use the shared USER_COLORS constant so the valid color list stays in sync
        // with utils.js instead of being hardcoded here
        if (USER_COLORS.includes(newColor)) {
            userColor = newColor;
            localStorage.setItem('chat_color', userColor);
            core.updateUser(username, userColor);
            addMessage('system', `Color changed to ${newColor}`, 'system');
        } else {
            addMessage('system', `Available colors: ${USER_COLORS.join(', ')}`, 'system');
        }
    } else if (text.startsWith('/password ')) {
        const password = text.substring(10);
        joinRoom(password);
    } else if (text.startsWith('/setpass ')) {
        const password = text.substring(9);
        if (connected) {
            core.setPassword(password);
        }
    } else if (text === '/clear') {
        messages.innerHTML = '';
    } else if (text === '/room') {
        addMessage('system', `Current room: ${roomId}`, 'system');
        addMessage('system', `Share URL: ${window.location.href}`, 'system');
        addMessage('system', `Authenticated: ${authenticated ? 'Yes' : 'No'}`, 'system');
    } else if (text === '/notify') {
        requestNotificationPermission();
    } else if (text === '/copy') {
        copyAllMessages();
    } else if (text === '/help') {
        addMessage('system', 'Commands:', 'system');
        addMessage('system', '/nick <name> - Change username', 'system');
        addMessage('system', '/color <color> - Change text color', 'system');
        addMessage('system', '/emoji - Toggle emoji picker', 'system');
        addMessage('system', '/gif <search> - Search and send animated GIF', 'system');
        addMessage('system', '/password <pass> - Enter room password', 'system');
        addMessage('system', '/setpass <pass> - Set room password (empty rooms only)', 'system');
        addMessage('system', '/notify - Enable desktop notifications', 'system');
        addMessage('system', '/copy - Copy all chat messages', 'system');
        addMessage('system', '/users - Toggle online users panel', 'system');
        addMessage('system', '/clear - Clear chat', 'system');
        addMessage('system', '/room - Show room info', 'system');
        addMessage('system', '/huddle - Start or join a video huddle', 'system');
        addMessage('system', '/leavehuddle - Leave the current huddle', 'system');
        addMessage('system', 'Tap any message to add reaction', 'system');
        addMessage('system', 'Select text + Ctrl+C/Cmd+C to copy, or hover messages for [Copy] button', 'system');
        // Dynamically list all available colors from USER_COLORS so help text stays in sync
        addMessage('system', 'Colors: ' + USER_COLORS.join(', '), 'system');
    } else if (text === '/users') {
        usersPanel.classList.toggle('open');
    } else if (text === '/emoji') {
        emojiPicker.style.display = emojiPicker.style.display === 'block' ? 'none' : 'block';
    } else if (text === '/huddle') {
        startOrJoinHuddle();
    } else if (text === '/leavehuddle') {
        leaveHuddle();
    } else if (text.startsWith('/gif ') || text === '/gif') {
        const query = text.substring(5).trim();
        if (!query) {
            // Open the GIF picker if no query
            gifPicker.classList.toggle('open');
            if (gifPicker.classList.contains('open')) {
                gifSearchInput.value = '';
                gifSearchInput.focus();
                loadGifs('');
            }
        } else {
            // Open GIF picker with search results for user to choose
            gifPicker.classList.add('open');
            gifSearchInput.value = query;
            gifSearchInput.focus();
            loadGifs(query);
        }
    } else {
        sendMessage(username, text);
    }
}

function copyAllMessages() {
    const messageElements = messages.querySelectorAll('.message');
    let chatText = '';
    
    messageElements.forEach(msg => {
        // Extract text content without HTML tags
        const textContent = msg.textContent || msg.innerText;
        chatText += textContent + '\n';
    });
    
    if (chatText.trim()) {
        // Try modern clipboard API first
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(chatText.trim()).then(() => {
                addMessage('system', 'Chat copied to clipboard!', 'system');
            }).catch(() => {
                fallbackCopy(chatText.trim());
            });
        } else {
            fallbackCopy(chatText.trim());
        }
    } else {
        addMessage('system', 'No messages to copy', 'system');
    }
}

function fallbackCopy(text) {
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
            addMessage('system', 'Chat copied to clipboard!', 'system');
        } else {
            showCopyModal(text);
        }
    } catch (err) {
        showCopyModal(text);
    }
}

function showCopyModal(text) {
    // Create modal for manual copy
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.8); z-index: 1000; display: flex;
        align-items: center; justify-content: center;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
        background: #111; border: 2px solid #00ff00; padding: 20px;
        max-width: 80%; max-height: 80%; overflow: auto;
        font-family: 'Courier New', monospace; color: #00ff00;
    `;
    
    const title = document.createElement('div');
    title.textContent = 'Copy Chat (Select All & Copy):';
    title.style.cssText = 'margin-bottom: 10px; color: #ffff00;';
    
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.cssText = `
        width: 100%; height: 300px; background: #000; color: #00ff00;
        border: 1px solid #333; font-family: 'Courier New', monospace;
        font-size: 12px; padding: 10px;
    `;
    textArea.readOnly = true;
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = `
        margin-top: 10px; background: #333; color: #00ff00;
        border: 1px solid #00ff00; padding: 5px 15px;
        font-family: 'Courier New', monospace; cursor: pointer;
    `;
    
    closeBtn.onclick = () => document.body.removeChild(modal);
    modal.onclick = (e) => { if (e.target === modal) document.body.removeChild(modal); };
    
    content.appendChild(title);
    content.appendChild(textArea);
    content.appendChild(closeBtn);
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    // Auto-select text
    textArea.select();
    textArea.focus();
}

// Notification functions
function requestNotificationPermission() {
    console.log('Requesting notification permission...');
    
    if (!('Notification' in window)) {
        addMessage('system', 'Browser does not support notifications', 'system');
        return;
    }
    
    console.log('Current permission:', Notification.permission);
    
    if (Notification.permission === 'granted') {
        notificationsEnabled = true;
        addMessage('system', 'Notifications already enabled!', 'system');
        // Test notification immediately
        showTestNotification();
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            console.log('Permission result:', permission);
            if (permission === 'granted') {
                notificationsEnabled = true;
                addMessage('system', 'Notifications enabled! You\'ll get alerts when tab is not visible', 'system');
                showTestNotification();
            } else {
                addMessage('system', 'Notifications denied', 'system');
            }
        });
    } else {
        addMessage('system', 'Notifications blocked. Enable in browser settings.', 'system');
    }
}

function showTestNotification() {
    try {
        playNotificationSound();
        
        const notification = new Notification('Terminal Chat Test', {
            body: 'Notifications are working! You\'ll get alerts for new messages.',
            icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMDAwMDAwIi8+Cjx0ZXh0IHg9IjE2IiB5PSIyMCIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxNiIgZmlsbD0iIzAwZmYwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+8J+SrDwvdGV4dD4KPHN2Zz4=',
            tag: 'terminal-chat-test',
            silent: false
        });
        
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
        
        setTimeout(() => notification.close(), 3000);
    } catch (error) {
        console.error('Test notification failed:', error);
        addMessage('system', 'Test notification failed: ' + error.message, 'system');
    }
}

function showNotification(user, text) {
    console.log('showNotification called:', user, text, 'Permission:', Notification.permission);
    
    if (notificationsEnabled && Notification.permission === 'granted') {
        try {
            playNotificationSound();
            
            const notification = new Notification(`💬 ${user}`, {
                body: text.length > 100 ? text.substring(0, 100) + '...' : text,
                icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMDAwMDAwIi8+Cjx0ZXh0IHg9IjE2IiB5PSIyMCIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxNiIgZmlsbD0iIzAwZmYwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+8J+SrDwvdGV4dD4KPHN2Zz4=',
                tag: 'terminal-chat',
                requireInteraction: false,
                silent: false
            });
            
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
            
            // Auto-close after 5 seconds
            setTimeout(() => notification.close(), 5000);
            console.log('Notification created successfully');
        } catch (error) {
            console.error('Notification failed:', error);
            addMessage('system', 'Notification error: ' + error.message, 'system');
        }
    } else {
        console.log('Notification not shown - enabled:', notificationsEnabled, 'permission:', Notification.permission);
    }
}

function playNotificationSound() {
    try {
        // Create a simple beep sound using Web Audio API
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
        
        console.log('Notification sound played');
    } catch (error) {
        console.log('Could not play notification sound:', error);
        // Fallback: try to play a simple audio element
        try {
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmGgU7k9n1unEiBC13yO/eizEIHWq+8+OWT');
            audio.volume = 0.3;
            audio.play();
        } catch (e) {
            console.log('Audio fallback also failed:', e);
        }
    }
}

// Page visibility detection
document.addEventListener('visibilitychange', () => {
    isPageVisible = !document.hidden;
    console.log('Page visibility changed:', isPageVisible);
});

window.addEventListener('focus', () => {
    isPageVisible = true;
    console.log('Window focused');
});

window.addEventListener('blur', () => {
    isPageVisible = false;
    console.log('Window blurred');
});

// Prevent zoom on iOS
document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
        e.preventDefault();
    }
});

// Keep input focused on mobile
input.addEventListener('touchend', () => {
    input.focus();
});

// ===== HUDDLE =====

let huddleActive = false;
let huddleId = null;
let huddleParticipants = [];
let inHuddle = false;
let huddleMuted = false;
let huddleCameraOff = false;
let localHuddleStream = null;
const peerConnections = new Map();
const pendingIceCandidates = new Map();

const huddleBar = document.getElementById('huddle-bar');
const huddleParticipantsLabel = document.getElementById('huddle-participants-label');
const huddleJoinBtn = document.getElementById('huddle-join-btn');
const huddleMuteBtn = document.getElementById('huddle-mute-btn');
const huddleCameraBtn = document.getElementById('huddle-camera-btn');
const huddleLeaveBtn = document.getElementById('huddle-leave-btn');
const huddleAttachBtn = document.getElementById('huddle-attach-btn');
const huddleVideoPanel = document.getElementById('huddle-video-panel');

function updateHuddleUI() {
    if (!huddleActive) {
        huddleBar.style.display = 'none';
        if (huddleAttachBtn) huddleAttachBtn.textContent = '📹 Start Huddle';
        return;
    }
    huddleBar.style.display = 'flex';
    const participantNames = huddleParticipants.map(p =>
        p.socketId === core.socketId ? p.username + ' (you)' : p.username
    );
    huddleParticipantsLabel.textContent = participantNames.join(', ');
    huddleJoinBtn.style.display = inHuddle ? 'none' : 'inline-block';
    huddleMuteBtn.style.display = inHuddle ? 'inline-block' : 'none';
    huddleCameraBtn.style.display = inHuddle ? 'inline-block' : 'none';
    huddleLeaveBtn.style.display = inHuddle ? 'inline-block' : 'none';
    huddleMuteBtn.textContent = huddleMuted ? '[ Unmute ]' : '[ Mute ]';
    huddleCameraBtn.textContent = huddleCameraOff ? '[ Camera On ]' : '[ Camera Off ]';
    huddleVideoPanel.style.display = inHuddle ? 'flex' : 'none';
    if (huddleAttachBtn) {
        huddleAttachBtn.textContent = inHuddle ? '📹 In Huddle' : '📹 Join Huddle';
    }
}

async function startOrJoinHuddle() {
    if (inHuddle) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        addMessage('system', 'Huddle not supported: microphone API unavailable', 'system');
        return;
    }
    let hasVideo = false;
    try {
        localHuddleStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        hasVideo = true;
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            addMessage('system', 'Microphone access denied. Allow mic access to join huddle.', 'system');
            return;
        }
        // Camera unavailable — fall back to audio only
        try {
            localHuddleStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (err2) {
            addMessage('system', 'Could not access microphone: ' + err2.message, 'system');
            return;
        }
    }
    // Show local video preview
    huddleVideoPanel.innerHTML = '';
    const localContainer = document.createElement('div');
    localContainer.className = 'huddle-video-container';
    localContainer.id = 'huddle-video-local';
    if (hasVideo) {
        const localVideo = document.createElement('video');
        localVideo.autoplay = true;
        localVideo.muted = true;
        localVideo.playsInline = true;
        localVideo.srcObject = localHuddleStream;
        localContainer.appendChild(localVideo);
    } else {
        const noCam = document.createElement('div');
        noCam.className = 'huddle-video-no-cam';
        noCam.textContent = '[no camera]';
        localContainer.appendChild(noCam);
    }
    const localLabel = document.createElement('span');
    localLabel.className = 'huddle-video-label';
    localLabel.textContent = 'You';
    localContainer.appendChild(localLabel);
    huddleVideoPanel.appendChild(localContainer);
    if (!huddleActive) {
        core.startHuddle();
    } else {
        core.joinHuddle();
    }
}

function leaveHuddle() {
    if (!inHuddle) return;
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    pendingIceCandidates.clear();
    huddleVideoPanel.innerHTML = '';
    if (localHuddleStream) {
        localHuddleStream.getTracks().forEach(t => t.stop());
        localHuddleStream = null;
    }
    inHuddle = false;
    huddleMuted = false;
    huddleCameraOff = false;
    core.leaveHuddle();
    updateHuddleUI();
}

function toggleHuddleMute() {
    if (!localHuddleStream) return;
    huddleMuted = !huddleMuted;
    localHuddleStream.getAudioTracks().forEach(track => {
        track.enabled = !huddleMuted;
    });
    updateHuddleUI();
}

function toggleHuddleCamera() {
    if (!localHuddleStream) return;
    huddleCameraOff = !huddleCameraOff;
    localHuddleStream.getVideoTracks().forEach(track => {
        track.enabled = !huddleCameraOff;
    });
    const localContainer = document.getElementById('huddle-video-local');
    if (localContainer) {
        localContainer.classList.toggle('camera-off', huddleCameraOff);
    }
    updateHuddleUI();
}

async function createHuddlePeerConnection(peerSocketId) {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });
    peerConnections.set(peerSocketId, pc);

    if (localHuddleStream) {
        localHuddleStream.getTracks().forEach(track => {
            pc.addTrack(track, localHuddleStream);
        });
    }

    pc.ontrack = (event) => {
        let container = document.getElementById('huddle-video-' + peerSocketId);
        if (!container) {
            container = document.createElement('div');
            container.className = 'huddle-video-container';
            container.id = 'huddle-video-' + peerSocketId;
            const video = document.createElement('video');
            video.autoplay = true;
            video.playsInline = true;
            const peer = huddleParticipants.find(p => p.socketId === peerSocketId);
            const label = document.createElement('span');
            label.className = 'huddle-video-label';
            label.textContent = peer ? peer.username : peerSocketId.substring(0, 6);
            container.appendChild(video);
            container.appendChild(label);
            huddleVideoPanel.appendChild(container);
        }
        container.querySelector('video').srcObject = event.streams[0];
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            core.sendHuddleSignal(peerSocketId, { type: 'candidate', candidate: event.candidate });
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
            pc.close();
            peerConnections.delete(peerSocketId);
        }
    };

    return pc;
}

async function flushPendingIceCandidates(peerSocketId, pc) {
    const candidates = pendingIceCandidates.get(peerSocketId) || [];
    pendingIceCandidates.delete(peerSocketId);
    for (const candidate of candidates) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.warn('Failed to add pending ICE candidate:', e);
        }
    }
}

core.addEventListener('huddle-state', (e) => {
    const data = e.detail;
    huddleActive = true;
    huddleId = data.huddleId;
    huddleParticipants = data.participants;
    updateHuddleUI();
});

core.addEventListener('huddle-started', (e) => {
    const data = e.detail;
    huddleActive = true;
    huddleId = data.huddleId;
    huddleParticipants = data.participants;
    if (data.initiator.socketId !== core.socketId) {
        addMessage('system', data.initiator.username + ' started a huddle. Use /huddle or click [ Join ] to join.', 'system');
    }
    updateHuddleUI();
});

core.addEventListener('huddle-joined', async (e) => {
    const data = e.detail;
    inHuddle = true;
    huddleId = data.huddleId;
    huddleParticipants = data.participants;
    for (const peer of data.existingPeers) {
        const pc = await createHuddlePeerConnection(peer.socketId);
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            core.sendHuddleSignal(peer.socketId, { type: 'offer', sdp: pc.localDescription });
        } catch (e) {
            console.error('Huddle offer error:', e);
        }
    }
    addMessage('system', 'Joined huddle. Participants: ' + huddleParticipants.map(p => p.username).join(', '), 'system');
    updateHuddleUI();
});

core.addEventListener('huddle-user-joined', (e) => {
    const data = e.detail;
    huddleParticipants = data.participants;
    if (data.socketId !== core.socketId) {
        addMessage('system', data.username + ' joined the huddle', 'system');
    }
    updateHuddleUI();
});

core.addEventListener('huddle-user-left', (e) => {
    const data = e.detail;
    huddleParticipants = data.participants;
    addMessage('system', data.username + ' left the huddle', 'system');
    updateHuddleUI();
});

core.addEventListener('huddle-peer-left', (e) => {
    const data = e.detail;
    const pc = peerConnections.get(data.socketId);
    if (pc) {
        pc.close();
        peerConnections.delete(data.socketId);
    }
    pendingIceCandidates.delete(data.socketId);
    const container = document.getElementById('huddle-video-' + data.socketId);
    if (container) container.remove();
});

core.addEventListener('huddle-ended', () => {
    huddleActive = false;
    inHuddle = false;
    huddleId = null;
    huddleParticipants = [];
    huddleMuted = false;
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    pendingIceCandidates.clear();
    huddleVideoPanel.innerHTML = '';
    if (localHuddleStream) {
        localHuddleStream.getTracks().forEach(t => t.stop());
        localHuddleStream = null;
    }
    huddleCameraOff = false;
    addMessage('system', 'Huddle ended', 'system');
    updateHuddleUI();
});

core.addEventListener('huddle-error', (e) => {
    const message = e.detail;
    addMessage('system', 'Huddle: ' + message, 'system');
});

core.addEventListener('huddle-signal', async (e) => {
    const { fromSocketId, signal } = e.detail;
    if (!inHuddle) return;
    let pc = peerConnections.get(fromSocketId);

    if (signal.type === 'offer') {
        if (!pc) {
            pc = await createHuddlePeerConnection(fromSocketId);
        }
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            await flushPendingIceCandidates(fromSocketId, pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            core.sendHuddleSignal(fromSocketId, { type: 'answer', sdp: pc.localDescription });
        } catch (e) {
            console.error('Huddle offer handling error:', e);
        }
    } else if (signal.type === 'answer') {
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                await flushPendingIceCandidates(fromSocketId, pc);
            } catch (e) {
                console.error('Huddle answer handling error:', e);
            }
        }
    } else if (signal.type === 'candidate') {
        if (pc && pc.remoteDescription) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } catch (e) {
                console.warn('ICE candidate error:', e);
            }
        } else {
            if (!pendingIceCandidates.has(fromSocketId)) {
                pendingIceCandidates.set(fromSocketId, []);
            }
            pendingIceCandidates.get(fromSocketId).push(signal.candidate);
        }
    }
});

huddleJoinBtn.onclick = () => startOrJoinHuddle();
huddleMuteBtn.onclick = () => toggleHuddleMute();
huddleCameraBtn.onclick = () => toggleHuddleCamera();
huddleLeaveBtn.onclick = () => leaveHuddle();
if (huddleAttachBtn) {
    huddleAttachBtn.onclick = () => {
        attachMenu.classList.remove('open');
        startOrJoinHuddle();
    };
}

// Initial message
addMessage('system', 'Commands: /nick, /color, /notify, /copy, /help', 'system');