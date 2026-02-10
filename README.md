# Terminal Chat Server

A real-time terminal-style chat application with WebSocket support.

## Features
- Real-time messaging across devices
- Terminal-like UI with green-on-black theme
- Unique room URLs for private conversations
- Username persistence
- Message history (last 100 messages per room)
- **Image sharing** - Upload and share images
- **Voice notes** - Record and send voice messages
- **Video sharing** - Upload and share videos
- **GIF support** - Search and send GIFs via GIPHY integration
- Desktop notifications
- Custom user colors
- Room passwords for private rooms

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
- `/password <pass>` - Enter room password
- `/setpass <pass>` - Set room password (empty rooms only)
- `/notify` - Enable desktop notifications
- `/copy` - Copy all chat messages
- `/clear` - Clear chat display
- `/room` - Show room info
- `/help` - Show commands

## Media Attachments

Click the 📎 button to access:
- **📷 Take Photo** - Capture a photo with your camera
- **🖼️ Gallery** - Select an image from your device
- **🎬 Record Video** - Record a video with your camera
- **🎞️ Video Gallery** - Select a video from your device
- **🎤 Voice Note** - Record a voice message
- **🎭 GIF** - Search and send GIFs from GIPHY

## Technical Details

- **Backend**: Node.js + Express + Socket.io
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Real-time**: WebSocket connections
- **Storage**: In-memory (resets on server restart)
- **Rooms**: URL-based room system
- **GIF Provider**: GIPHY API
