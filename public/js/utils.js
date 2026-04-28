// Shared utility functions used by both the web app and the Chrome extension.

export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Escape HTML then wrap bare URLs in <a> tags.
export function linkify(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(
        /(https?:\/\/[^\s<>"]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#88ff88;text-decoration:underline">$1</a>'
    );
}

export function formatTime(ts) {
    return new Date(ts).toLocaleTimeString();
}

// Returns a random 6-character alphanumeric room ID.
// Does NOT update window.location — callers are responsible for that.
export function generateRoomId() {
    return Math.random().toString(36).substring(2, 8);
}

// Expanded from 8 to 16 colors to give users more personalization options
export const USER_COLORS = ['green', 'cyan', 'yellow', 'magenta', 'red', 'blue', 'orange', 'purple', 'white', 'pink', 'lime', 'teal', 'gold', 'coral', 'lavender', 'silver'];

export const COLOR_HEX = {
    cyan:     '#00ffff',
    green:    '#00ff00',
    yellow:   '#ffff00',
    magenta:  '#ff00ff',
    red:      '#ff6b6b',
    blue:     '#6b9eff',
    orange:   '#ffa500',
    purple:   '#9966cc',
    // New colors added to expand the palette from 8 to 16
    white:    '#ffffff',
    pink:     '#ff69b4',
    lime:     '#32cd32',
    teal:     '#2dd4bf',
    gold:     '#ffd700',
    coral:    '#ff7f50',
    lavender: '#b380ff',
    silver:   '#c0c0c0',
};
