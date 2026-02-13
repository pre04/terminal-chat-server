# Terminal Chat Server

A real-time terminal-style chat application with WebSocket support.

## Features
- Real-time messaging across devices
- Terminal-like UI with green-on-black theme
- Unique room URLs for private conversations
- Username persistence
- Message history (last 100 messages per room)
- **GIF Support** - Search and send GIFs via GIPHY integration
- Image, video, and voice message support
- Emoji reactions

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
- `/color <color>` - Change text color
- `/gif` - Open GIF search picker
- `/emoji` - Toggle emoji picker
- `/clear` - Clear chat display
- `/room` - Show room info
- `/notify` - Enable desktop notifications
- `/copy` - Copy all chat messages
- `/users` - Toggle online users panel
- `/password <pass>` - Enter room password
- `/setpass <pass>` - Set room password (empty rooms only)
- `/help` - Show commands

## GIF Support

The chat includes integrated GIF search powered by GIPHY:
- Click the 📎 attachment button and select "🎭 GIF Search"
- Or type `/gif` in the chat
- Search for GIFs or browse trending GIFs
- Click any GIF to send it to the chat

## Technical Details

- **Backend**: Node.js + Express + Socket.io
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Real-time**: WebSocket connections
- **Storage**: In-memory (resets on server restart)
- **Rooms**: URL-based room system
- **GIF API**: GIPHY (public beta key for demo)
