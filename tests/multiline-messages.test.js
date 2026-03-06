'use strict';

const { expect } = require('chai');
const { io: Client } = require('socket.io-client');

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
// Multi-line message tests
// ---------------------------------------------------------------------------

describe('Multi-line Messages', function () {
    const ROOM = 'test-room-multiline';

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

    it('preserves newlines in messages through WebSocket transport', function (done) {
        const multiLineText = 'line1\nline2\nline3';

        Promise.all([joinRoom(alice, ROOM, 'alice'), joinRoom(bob, ROOM, 'bob')])
            .then(() => {
                const msgPromise = waitForEvent(bob, 'new-message');
                alice.emit('send-message', {
                    roomId: ROOM,
                    user: 'alice',
                    text: multiLineText,
                    type: 'user',
                    color: 'cyan'
                });
                return msgPromise;
            })
            .then((msg) => {
                expect(msg.text).to.equal(multiLineText);
                expect(msg.text).to.contain('\n');
                expect(msg.text.split('\n')).to.have.lengthOf(3);
                done();
            })
            .catch(done);
    });

    it('preserves newlines in message history (load-messages)', function (done) {
        const HISTORY_ROOM = 'test-room-multiline-history';
        const multiLineText = 'hello\nworld\nfoo';

        joinRoom(alice, HISTORY_ROOM, 'alice')
            .then(() => {
                const msgPromise = waitForEvent(alice, 'new-message');
                alice.emit('send-message', {
                    roomId: HISTORY_ROOM,
                    user: 'alice',
                    text: multiLineText,
                    type: 'user',
                    color: 'cyan'
                });
                return msgPromise;
            })
            .then(() => {
                // Carol joins and should receive the message via load-messages
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
                            const found = messages.find((m) => m.user === 'alice' && m.text === multiLineText);
                            expect(found).to.exist;
                            expect(found.text).to.contain('\n');
                            expect(found.text.split('\n')).to.have.lengthOf(3);
                            carol.disconnect();
                            done();
                        })
                        .catch((err) => { carol.disconnect(); done(err); });
                });
            })
            .catch(done);
    });

    it('preserves empty lines (double newlines) in messages', function (done) {
        const textWithEmptyLine = 'hello\n\nworld';

        Promise.all([joinRoom(alice, ROOM + '-empty', 'alice'), joinRoom(bob, ROOM + '-empty', 'bob')])
            .then(() => {
                const msgPromise = waitForEvent(bob, 'new-message');
                alice.emit('send-message', {
                    roomId: ROOM + '-empty',
                    user: 'alice',
                    text: textWithEmptyLine,
                    type: 'user',
                    color: 'cyan'
                });
                return msgPromise;
            })
            .then((msg) => {
                expect(msg.text).to.equal(textWithEmptyLine);
                expect(msg.text).to.contain('\n\n');
                expect(msg.text.split('\n')).to.have.lengthOf(3);
                done();
            })
            .catch(done);
    });
});
