const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    maxHttpBufferSize: 45e6 // 45MB to support 30MB images after base64 encoding
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

// Run cleanup every hour
setInterval(cleanupOldMessages, 60 * 60 * 1000);

// Serve static files
app.use(express.static('public'));

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
        const { roomId, user, text, type, image } = data;

        // Store message
        if (!rooms[roomId]) rooms[roomId] = [];

        const message = {
            user,
            text,
            type: type || 'user',
            time: Date.now(),
            color: data.color || null,
            image: image || null
        };

        rooms[roomId].push(message);

        // Keep only last 100 messages per room (in addition to time-based cleanup)
        if (rooms[roomId].length > 100) {
            rooms[roomId] = rooms[roomId].slice(-100);
        }

        // Broadcast to all users in room
        io.to(roomId).emit('new-message', message);

        console.log(`Message in room ${roomId}: ${user}: ${image ? '[IMAGE] ' : ''}${text}`);
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
