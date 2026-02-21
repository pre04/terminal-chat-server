# Terminal Chat Server

A real-time terminal-style chat application with WebSocket support.

## Features
- Real-time messaging across devices
- Terminal-like UI with green-on-black theme
- Unique room URLs for private conversations
- Username persistence
- Message history (last 100 messages per room)
- GIF search and sharing (powered by GIPHY)
- Image, video, and voice note sharing

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
- `/gif [search]` - Search and send GIFs
- `/clear` - Clear chat display
- `/room` - Show room info
- `/help` - Show commands

## GIF Support

The application includes built-in GIF search powered by GIPHY. To use it:
1. Click the attachment button (paperclip icon)
2. Select "GIF Search"
3. Search for GIFs or browse trending
4. Click a GIF to send it to the chat

Alternatively, use the `/gif` command:
- `/gif` - Open GIF picker with trending GIFs
- `/gif cats` - Open GIF picker and search for "cats"

**API Key Configuration**: The app includes a demo API key. For production use, get your free API key at [developers.giphy.com](https://developers.giphy.com/dashboard/) and set it in `public/index.html`.

## Technical Details

- **Backend**: Node.js + Express + Socket.io
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Real-time**: WebSocket connections
- **Storage**: In-memory (resets on server restart)
- **Rooms**: URL-based room system
