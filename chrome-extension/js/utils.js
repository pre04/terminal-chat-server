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

export const USER_COLORS = ['green', 'cyan', 'yellow', 'magenta', 'red', 'blue', 'orange', 'purple'];

export const COLOR_HEX = {
    cyan:    '#00ffff',
    green:   '#00ff00',
    yellow:  '#ffff00',
    magenta: '#ff00ff',
    red:     '#ff6b6b',
    blue:    '#6b9eff',
    orange:  '#ffa500',
    purple:  '#9966cc',
};
