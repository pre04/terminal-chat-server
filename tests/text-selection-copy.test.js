'use strict';

const { expect } = require('chai');
const { io: Client } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const readmeContent = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

/**
 * Helper: wait for a named socket event once, with a timeout.
 */
function waitForEvent(client, eventName, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timed out waiting for event "${eventName}"`));
        }, timeoutMs);
        client.once(eventName, (data) => {
            clearTimeout(timer);
            resolve(data);
        });
    });
}

// ---------------------------------------------------------------------------
// Text Selection & Copy - README Content Tests
// ---------------------------------------------------------------------------

describe('Text Selection & Copy - README Content Tests', function () {
    const ROOM = 'test-room-text-selection';

    let serverRef, ioRef, PORT;
    let ownServer = false;
    let alice, bob;

    before(function (done) {
        ({ server: serverRef, io: ioRef } = require('../server'));
        if (serverRef.listening) {
            PORT = serverRef.address().port;
            return done();
        }
        ownServer = true;
        serverRef.listen(0, () => {
            PORT = serverRef.address().port;
            done();
        });
    });

    after(function (done) {
        if (!ownServer) return done();
        ioRef.close();
        serverRef.close(done);
    });

    function connect() {
        return new Client(`http://localhost:${PORT}`, { forceNew: true });
    }

    function joinRoom(client, roomId, username, color = 'cyan') {
        return new Promise((resolve, reject) => {
            client.once('auth-success', resolve);
            client.once('auth-failed', (msg) => reject(new Error('auth-failed: ' + msg)));
            client.emit('join-room', { roomId, password: '', username, color });
        });
    }

    beforeEach(function (done) {
        alice = connect();
        bob = connect();

        let ready = 0;
        const onConnect = () => { if (++ready === 2) done(); };
        alice.once('connect', onConnect);
        bob.once('connect', onConnect);
    });

    afterEach(function () {
        alice.disconnect();
        bob.disconnect();
    });

    it('preserves full README.md content through WebSocket transport', function (done) {
        Promise.all([joinRoom(alice, ROOM, 'alice'), joinRoom(bob, ROOM, 'bob')])
            .then(() => {
                const msgPromise = waitForEvent(bob, 'new-message');
                alice.emit('send-message', {
                    roomId: ROOM,
                    user: 'alice',
                    text: readmeContent,
                    type: 'user',
                    color: 'cyan'
                });
                return msgPromise;
            })
            .then((msg) => {
                expect(msg.text).to.equal(readmeContent);
                expect(msg.user).to.equal('alice');
                done();
            })
            .catch(done);
    });

    it('preserves README Features section with bullet points', function (done) {
        const lines = readmeContent.split('\n');
        const featuresStart = lines.findIndex((l) => l.startsWith('## Features'));
        const featuresEnd = lines.findIndex((l, i) => i > featuresStart && l.startsWith('## '));
        const featuresSection = lines.slice(featuresStart, featuresEnd).join('\n').trim();

        Promise.all([joinRoom(alice, ROOM + '-feat', 'alice'), joinRoom(bob, ROOM + '-feat', 'bob')])
            .then(() => {
                const msgPromise = waitForEvent(bob, 'new-message');
                alice.emit('send-message', {
                    roomId: ROOM + '-feat',
                    user: 'alice',
                    text: featuresSection,
                    type: 'user',
                    color: 'cyan'
                });
                return msgPromise;
            })
            .then((msg) => {
                expect(msg.text).to.equal(featuresSection);
                expect(msg.text).to.contain('- ');
                expect(msg.text).to.contain('## Features');
                done();
            })
            .catch(done);
    });

    it('preserves README Commands section with backtick formatting', function (done) {
        const lines = readmeContent.split('\n');
        const cmdStart = lines.findIndex((l) => l.startsWith('## Commands'));
        const cmdEnd = lines.findIndex((l, i) => i > cmdStart && l.startsWith('## '));
        const cmdSection = lines.slice(cmdStart, cmdEnd === -1 ? lines.length : cmdEnd).join('\n').trim();

        Promise.all([joinRoom(alice, ROOM + '-cmd', 'alice'), joinRoom(bob, ROOM + '-cmd', 'bob')])
            .then(() => {
                const msgPromise = waitForEvent(bob, 'new-message');
                alice.emit('send-message', {
                    roomId: ROOM + '-cmd',
                    user: 'alice',
                    text: cmdSection,
                    type: 'user',
                    color: 'cyan'
                });
                return msgPromise;
            })
            .then((msg) => {
                expect(msg.text).to.equal(cmdSection);
                expect(msg.text).to.contain('`');
                expect(msg.text).to.contain('## Commands');
                done();
            })
            .catch(done);
    });

    it('preserves README code blocks through message round-trip', function (done) {
        const codeBlockMatch = readmeContent.match(/```bash[\s\S]*?```/);
        const codeBlock = codeBlockMatch ? codeBlockMatch[0] : '```bash\nnpm install\nnpm start\n```';

        Promise.all([joinRoom(alice, ROOM + '-code', 'alice'), joinRoom(bob, ROOM + '-code', 'bob')])
            .then(() => {
                const msgPromise = waitForEvent(bob, 'new-message');
                alice.emit('send-message', {
                    roomId: ROOM + '-code',
                    user: 'alice',
                    text: codeBlock,
                    type: 'user',
                    color: 'cyan'
                });
                return msgPromise;
            })
            .then((msg) => {
                expect(msg.text).to.equal(codeBlock);
                expect(msg.text).to.contain('```');
                done();
            })
            .catch(done);
    });

    it('preserves README content in message history (load-messages)', function (done) {
        const HISTORY_ROOM = 'test-room-readme-history';

        joinRoom(alice, HISTORY_ROOM, 'alice')
            .then(() => {
                const msgPromise = waitForEvent(alice, 'new-message');
                alice.emit('send-message', {
                    roomId: HISTORY_ROOM,
                    user: 'alice',
                    text: readmeContent,
                    type: 'user',
                    color: 'cyan'
                });
                return msgPromise;
            })
            .then(() => {
                const carol = connect();
                carol.once('connect', () => {
                    const loadPromise = waitForEvent(carol, 'load-messages');
                    carol.emit('join-room', {
                        roomId: HISTORY_ROOM,
                        password: '',
                        username: 'carol',
                        color: 'cyan'
                    });
                    loadPromise
                        .then((messages) => {
                            const found = messages.find((m) => m.user === 'alice' && m.text === readmeContent);
                            expect(found).to.exist;
                            expect(found.text).to.equal(readmeContent);
                            expect(found.text).to.contain('# Terminal Chat Server');
                            carol.disconnect();
                            done();
                        })
                        .catch((err) => { carol.disconnect(); done(err); });
                });
            })
            .catch(done);
    });

    it('handles multiple README sections sent as separate messages', function (done) {
        const lines = readmeContent.split('\n');
        const featuresStart = lines.findIndex((l) => l.startsWith('## Features'));
        const featuresEnd = lines.findIndex((l, i) => i > featuresStart && l.startsWith('## '));
        const featuresSection = lines.slice(featuresStart, featuresEnd).join('\n').trim();

        const localDevStart = lines.findIndex((l) => l.startsWith('## Local Development'));
        const localDevEnd = lines.findIndex((l, i) => i > localDevStart && l.startsWith('## '));
        const localDevSection = lines.slice(localDevStart, localDevEnd).join('\n').trim();

        const techStart = lines.findIndex((l) => l.startsWith('## Technical Details'));
        const techEnd = lines.findIndex((l, i) => i > techStart && l.startsWith('## '));
        const techSection = lines.slice(techStart, techEnd === -1 ? lines.length : techEnd).join('\n').trim();

        const MULTI_ROOM = ROOM + '-multi';
        let receivedMessages = [];

        Promise.all([joinRoom(alice, MULTI_ROOM, 'alice'), joinRoom(bob, MULTI_ROOM, 'bob')])
            .then(() => {
                bob.on('new-message', (msg) => {
                    receivedMessages.push(msg);
                });

                const send = (text) => {
                    return new Promise((resolve) => {
                        alice.emit('send-message', {
                            roomId: MULTI_ROOM,
                            user: 'alice',
                            text: text,
                            type: 'user',
                            color: 'cyan'
                        });
                        // Small delay to ensure ordering
                        setTimeout(resolve, 100);
                    });
                };

                return send(featuresSection)
                    .then(() => send(localDevSection))
                    .then(() => send(techSection));
            })
            .then(() => {
                // Wait a bit for all messages to arrive
                setTimeout(() => {
                    expect(receivedMessages).to.have.lengthOf(3);
                    expect(receivedMessages[0].text).to.equal(featuresSection);
                    expect(receivedMessages[1].text).to.equal(localDevSection);
                    expect(receivedMessages[2].text).to.equal(techSection);
                    done();
                }, 300);
            })
            .catch(done);
    });
});
