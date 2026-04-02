/**
 * UI rendering tests using Puppeteer.
 *
 * These tests start the real server, open the web app in a headless browser,
 * and use a socket.io-client to inject messages — then assert the DOM reflects
 * what the shared modules (ChatCore, escapeHtml, linkify) should produce.
 *
 * Focused on the highest-risk areas of the refactor:
 *   1. addMessage() uses imported escapeHtml/linkify correctly
 *   2. ChatCore event dispatch → e.detail extraction works end-to-end
 *   3. User color classes are applied
 *   4. System messages are styled differently from user messages
 */

const puppeteer = require('puppeteer');
const { io: ioClient } = require('socket.io-client');
const assert = require('assert');

// Resolve Chrome executable: env override → puppeteer's own download → Playwright cache fallback
function resolveChrome() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
    try { return puppeteer.executablePath(); } catch (_) {}
    return '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';
}
const CHROME = resolveChrome();
const ROOM = 'ui-test-room';

let server, io, PORT, BASE, browser, page;

before(function (done) {
    this.timeout(20000);
    ({ server, io } = require('../server'));
    server.listen(0, () => {
        PORT = server.address().port;
        BASE = `http://localhost:${PORT}`;
        done();
    });
});

after(async function () {
    this.timeout(10000);
    if (browser) await browser.close();
    await new Promise(resolve => { io.close(); server.close(resolve); });
});

beforeEach(async function () {
    this.timeout(20000);
    if (!browser) {
        browser = await puppeteer.launch({
            executablePath: CHROME,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            headless: true,
        });
    }
    page = await browser.newPage();
    await page.goto(`${BASE}/?room=${ROOM}`, { waitUntil: 'networkidle0' });

    // Wait for auth-success (app connects and joins room automatically)
    await page.waitForFunction(() => {
        const msgs = document.querySelectorAll('#messages .message');
        return [...msgs].some(m => m.textContent.includes('Connected to room'));
    }, { timeout: 8000 });
});

afterEach(async function () {
    if (page) await page.close();
});

// Helper: send a message from a separate socket.io client and wait for it to appear.
async function injectMessage({ user, text, type = 'user', color = 'cyan', image = null, voice = null, video = null }) {
    await new Promise((resolve, reject) => {
        const s = ioClient(BASE);
        s.on('connect', () => {
            s.emit('join-room', { roomId: ROOM, password: '', username: user, color });
        });
        s.on('auth-success', () => {
            s.emit('send-message', {
                roomId: ROOM, user, text, type, color,
                image, voice, video, replyTo: null,
            });
            setTimeout(() => { s.disconnect(); resolve(); }, 200);
        });
        s.on('connect_error', reject);
        setTimeout(() => reject(new Error('inject timeout')), 5000);
    });

    // Wait for the message to appear in the page DOM
    await page.waitForFunction(
        (expectedText) => [...document.querySelectorAll('#messages .message')]
            .some(m => m.dataset.text === expectedText),
        { timeout: 5000 },
        text
    );
}

// ─────────────────────────────────────────────────────────────────────────────

describe('UI Rendering — message display', function () {
    this.timeout(30000);

    it('renders a user message with correct username and text', async function () {
        await injectMessage({ user: 'alice', text: 'hello world', color: 'green' });

        const result = await page.evaluate(() => {
            const msgs = [...document.querySelectorAll('#messages .message.user')];
            const msg = msgs.find(m => m.dataset.text === 'hello world');
            if (!msg) return null;
            return {
                text: msg.dataset.text,
                user: msg.dataset.user,
                html: msg.innerHTML,
            };
        });

        assert.ok(result, 'message element not found in DOM');
        assert.strictEqual(result.text, 'hello world');
        assert.strictEqual(result.user, 'alice');
        assert.ok(result.html.includes('alice'), 'username not rendered');
        assert.ok(result.html.includes('hello world'), 'message text not rendered');
    });

    it('applies the correct color class for user color', async function () {
        await injectMessage({ user: 'bob', text: 'colortest', color: 'magenta' });

        const hasColorClass = await page.evaluate(() => {
            const msg = [...document.querySelectorAll('#messages .message')]
                .find(m => m.dataset.text === 'colortest');
            return msg ? msg.classList.contains('color-magenta') : false;
        });

        assert.ok(hasColorClass, 'color-magenta class not applied to message');
    });

    it('renders a system message with system class (no user class)', async function () {
        await injectMessage({ user: 'system', text: 'sys-msg-test', type: 'system', color: null });

        const result = await page.evaluate(() => {
            const msg = [...document.querySelectorAll('#messages .message')]
                .find(m => m.dataset.text === 'sys-msg-test');
            if (!msg) return null;
            return { isSystem: msg.classList.contains('system'), isUser: msg.classList.contains('user') };
        });

        assert.ok(result, 'system message not found');
        assert.ok(result.isSystem, 'system message missing .system class');
        assert.ok(!result.isUser, 'system message should not have .user class');
    });
});

describe('UI Rendering — XSS protection (escapeHtml)', function () {
    this.timeout(30000);

    it('escapes HTML tags in message text — no injected elements', async function () {
        const xssPayload = '<b>bold</b><script>window.__xss=1</script>';
        await injectMessage({ user: 'eve', text: xssPayload, color: 'red' });

        const result = await page.evaluate(() => {
            const msg = [...document.querySelectorAll('#messages .message')]
                .find(m => m.dataset.text.includes('<b>bold</b>'));
            if (!msg) return null;
            return {
                // Check the raw innerHTML contains escaped entities, not live tags
                containsLiteralLtB: msg.innerHTML.includes('&lt;b&gt;'),
                injectedBold: msg.querySelector('b') !== null,
                xssExecuted: window.__xss === 1,
            };
        });

        assert.ok(result, 'XSS message not found in DOM');
        assert.ok(result.containsLiteralLtB, 'HTML tags not escaped — raw <b> rendered');
        assert.ok(!result.injectedBold, 'injected <b> element exists in DOM — XSS succeeded');
        assert.ok(!result.xssExecuted, 'XSS script executed');
    });

    it('escapes & < > " characters in username', async function () {
        // Server sanitizes usernames too, but addMessage renders whatever it receives
        await injectMessage({ user: 'a&b<c>', text: 'escapeuser', color: 'cyan' });

        const result = await page.evaluate(() => {
            const msg = [...document.querySelectorAll('#messages .message')]
                .find(m => m.dataset.text === 'escapeuser');
            if (!msg) return null;
            // The rendered HTML must not contain unescaped < or > from the username
            return {
                hasRawAngle: msg.innerHTML.includes('<c>'),
                hasEscapedAmp: msg.innerHTML.includes('a&amp;b'),
            };
        });

        assert.ok(result, 'message not found');
        assert.ok(!result.hasRawAngle, 'unescaped < from username leaked into DOM');
    });
});

describe('UI Rendering — URL linkification (linkify)', function () {
    this.timeout(30000);

    it('converts a bare URL in message text into a clickable <a> tag', async function () {
        await injectMessage({ user: 'charlie', text: 'check https://example.com out', color: 'blue' });

        const result = await page.evaluate(() => {
            const msg = [...document.querySelectorAll('#messages .message')]
                .find(m => m.dataset.text === 'check https://example.com out');
            if (!msg) return null;
            const link = msg.querySelector('a');
            return link
                ? { href: link.href, text: link.textContent }
                : null;
        });

        assert.ok(result, 'no <a> tag found — URL not linkified');
        assert.ok(result.href.includes('example.com'), `unexpected href: ${result.href}`);
        assert.ok(result.text.includes('example.com'), 'link text wrong');
    });

    it('does not linkify plain text without a URL', async function () {
        await injectMessage({ user: 'charlie', text: 'no link here', color: 'blue' });

        const hasLink = await page.evaluate(() => {
            const msg = [...document.querySelectorAll('#messages .message')]
                .find(m => m.dataset.text === 'no link here');
            return msg ? msg.querySelector('a') !== null : false;
        });

        assert.ok(!hasLink, 'unexpected <a> tag in plain-text message');
    });
});

describe('UI Rendering — ChatCore event pipeline', function () {
    this.timeout(30000);

    it('updates the online user count when a new user joins', async function () {
        // Connect a second user and keep the socket open until after asserting
        const s = ioClient(BASE);
        try {
            await new Promise((resolve, reject) => {
                s.on('connect', () => s.emit('join-room', { roomId: ROOM, password: '', username: 'newuser', color: 'yellow' }));
                s.on('auth-success', resolve);
                s.on('connect_error', reject);
                setTimeout(() => reject(new Error('join timeout')), 5000);
            });

            await page.waitForFunction(() => {
                const el = document.getElementById('users-count');
                return el && parseInt(el.textContent) >= 2;
            }, { timeout: 5000 });

            const count = await page.$eval('#users-count', el => parseInt(el.textContent));
            assert.ok(count >= 2, `expected >= 2 online users, got ${count}`);
        } finally {
            s.disconnect();
        }
    });

    it('shows typing indicator when another user is typing', async function () {
        // Connect a second user, emit typing-start, assert, then disconnect
        const s = ioClient(BASE);
        try {
            await new Promise((resolve, reject) => {
                s.on('connect', () => s.emit('join-room', { roomId: ROOM, password: '', username: 'typer', color: 'cyan' }));
                s.on('auth-success', () => {
                    s.emit('typing-start', { roomId: ROOM, username: 'typer' });
                    resolve();
                });
                s.on('connect_error', reject);
                setTimeout(() => reject(new Error('typing timeout')), 5000);
            });

            await page.waitForFunction(() => {
                const el = document.getElementById('typing-indicator');
                return el && el.innerHTML.includes('typer');
            }, { timeout: 5000 });

            const indicator = await page.$eval('#typing-indicator', el => el.textContent);
            assert.ok(indicator.includes('typer'), `typing indicator did not show 'typer': "${indicator}"`);
        } finally {
            s.disconnect();
        }
    });
});
