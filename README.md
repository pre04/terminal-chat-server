# Terminal Chat Server

A real-time terminal-style chat application with WebSocket support.

## Features
- Real-time messaging across devices
- Terminal-like UI with green-on-black theme
- Unique room URLs for private conversations
- Username persistence
- Message history (last 100 messages per room)
- Image, video, and voice note sharing
- **GIF picker** - Search and send GIFs powered by GIPHY
- Desktop notifications
- Room passwords for private chats

## Deploy to Replit

1. Go to [replit.com](https://replit.com)
2. Click "Create Repl"
3. Choose "Node.js" template
4. Upload these files:
   - `package.json`
   - `server.js` 
   - `public/index.html`
5. Click "Run" button

## Local Development

```bash
npm install
npm start
```

Visit `http://localhost:3000`

## How to Use

1. Visit your Replit URL (e.g., `https://your-repl.your-username.repl.co`)
2. App creates unique room URL automatically
3. Share the full URL with friends
4. Chat in real-time!

## Commands

- `/nick <name>` - Change username
- `/color <color>` - Change text color (green, cyan, yellow, magenta, red, blue, orange, purple)
- `/emoji` - Toggle emoji picker
- `/gif` - Open GIF picker
- `/password <pass>` - Enter room password
- `/setpass <pass>` - Set room password (empty rooms only)
- `/notify` - Enable desktop notifications
- `/copy` - Copy all chat messages
- `/clear` - Clear chat display
- `/room` - Show room info
- `/help` - Show all commands

## Media Features

- **📎 Attach Button**: Access all media options
  - 📷 Take Photo - Capture from camera
  - 🖼️ Gallery - Select from device
  - 🎬 Record Video - Capture video
  - 🎞️ Video Gallery - Select video from device
  - 🎤 Voice Note - Record audio message
  - 🎞️ GIF - Search and send GIFs

## Technical Details

- **Backend**: Node.js + Express + Socket.io
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Real-time**: WebSocket connections
- **Storage**: In-memory (resets on server restart)
- **Rooms**: URL-based room system
- **GIF API**: GIPHY
