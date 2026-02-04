const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename with original extension
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueName = crypto.randomBytes(16).toString('hex') + ext;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed (jpeg, png, gif, webp)'));
        }
    }
});

// Configure multer for voice uploads
const voiceUpload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit for voice
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/mp3', 'audio/x-m4a'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only audio files are allowed (webm, wav, mp3, m4a, ogg)'));
        }
    }
});

// Store messages and room passwords in memory
const rooms = {};
const roomPasswords = {};

// Auto-cleanup messages older than 12 hours
const CLEANUP_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours in milliseconds

function cleanupOldMessages() {
    const now = Date.now();
    const cutoffTime = now - CLEANUP_INTERVAL;

    Object.keys(rooms).forEach(roomId => {
        if (rooms[roomId]) {
            const originalCount = rooms[roomId].length;
            rooms[roomId] = rooms[roomId].filter(message => message.time > cutoffTime);

            if (originalCount > rooms[roomId].length) {
                console.log(`Cleaned up ${originalCount - rooms[roomId].length} old messages from room ${roomId}`);
            }

            // Remove empty rooms and their passwords
            if (rooms[roomId].length === 0) {
                delete rooms[roomId];
                delete roomPasswords[roomId];
                console.log(`Removed empty room ${roomId} and its password`);
            }
        }
    });
}

// Cleanup old uploaded files (older than 12 hours)
function cleanupOldUploads() {
    const now = Date.now();
    const cutoffTime = now - CLEANUP_INTERVAL;

    fs.readdir(uploadsDir, (err, files) => {
        if (err) {
            console.error('Error reading uploads directory:', err);
            return;
        }

        files.forEach(file => {
            const filePath = path.join(uploadsDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;

                if (stats.mtimeMs < cutoffTime) {
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            console.error(`Failed to delete old upload ${file}:`, err);
                        } else {
                            console.log(`Deleted old upload: ${file}`);
                        }
                    });
                }
            });
        });
    });
}

// Run cleanup every hour
setInterval(cleanupOldMessages, 60 * 60 * 1000);
setInterval(cleanupOldUploads, 60 * 60 * 1000);

// Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static(uploadsDir));

// Image upload endpoint
app.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    // Return the URL to the uploaded file
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ url: imageUrl });
});

// Voice upload endpoint
app.post('/upload-voice', voiceUpload.single('voice'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    // Return the URL to the uploaded file
    const voiceUrl = `/uploads/${req.file.filename}`;
    res.json({ url: voiceUrl });
});

// Error handling for multer
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
        }
        return res.status(400).json({ error: err.message });
    } else if (err) {
        return res.status(400).json({ error: err.message });
    }
    next();
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('join-room', (data) => {
        const { roomId, password } = data;
        
        // Check if room has password
        if (roomPasswords[roomId]) {
            if (password !== roomPasswords[roomId]) {
                socket.emit('auth-failed', 'Incorrect password');
                return;
            }
        }
        
        socket.join(roomId);
        
        // Send existing messages to new user (only messages from last 12 hours)
        if (rooms[roomId]) {
            const now = Date.now();
            const cutoffTime = now - CLEANUP_INTERVAL;
            const recentMessages = rooms[roomId].filter(msg => msg.time > cutoffTime);
            socket.emit('load-messages', recentMessages);
        }
        
        socket.emit('auth-success');
        console.log(`User ${socket.id} joined room ${roomId}`);
    });
    
    socket.on('set-password', (data) => {
        const { roomId, password } = data;
        
        // Only allow setting password if room is empty or user is first
        if (!rooms[roomId] || rooms[roomId].length === 0) {
            roomPasswords[roomId] = password;
            socket.emit('password-set', 'Room password set successfully');
            console.log(`Password set for room ${roomId}`);
        } else {
            socket.emit('password-failed', 'Cannot set password - room already has messages');
        }
    });
    
    socket.on('send-message', (data) => {
        const { roomId, user, text, type, image, voice } = data;

        // Store message
        if (!rooms[roomId]) rooms[roomId] = [];

        const message = {
            user,
            text,
            type: type || 'user',
            time: Date.now(),
            color: data.color || null,
            image: image || null,
            voice: voice || null
        };

        rooms[roomId].push(message);

        // Keep only last 100 messages per room (in addition to time-based cleanup)
        if (rooms[roomId].length > 100) {
            rooms[roomId] = rooms[roomId].slice(-100);
        }

        // Broadcast to all users in room
        io.to(roomId).emit('new-message', message);

        console.log(`Message in room ${roomId}: ${user}: ${image ? '[IMAGE] ' : ''}${voice ? '[VOICE] ' : ''}${text}`);
    });
    
    socket.on('delete-chat', (data) => {
        const { roomId } = data;
        
        // Clear all messages from room
        if (rooms[roomId]) {
            rooms[roomId] = [];
            console.log(`Chat deleted in room ${roomId}`);
        }
        
        // Broadcast to all users in room
        io.to(roomId).emit('chat-deleted');
    });
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Auto-cleanup: Messages older than 12 hours will be deleted');
});
