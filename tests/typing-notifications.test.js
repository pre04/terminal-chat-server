'use strict';

const { expect } = require('chai');
const { io: Client } = require('socket.io-client');

let server, io, PORT;

before(function (done) {
    ({ server, io } = require('../server'));
    server.listen(0, () => {
        PORT = server.address().port;
        done();
    });
});

after(function (done) {
    io.close();
    server.close(done);
});

/**
 * Helper: connect a socket client and wait for it to be ready.
 */
function connect() {
    return new Client(`http://localhost:${PORT}`, { forceNew: true });
}

/**
 * Helper: join a room and resolve once auth-success is received.
 */
function joinRoom(client, roomId, username, color = 'cyan') {
    return new Promise((resolve, reject) => {
        client.once('auth-success', resolve);
        client.once('auth-failed', (msg) => reject(new Error('auth-failed: ' + msg)));
        client.emit('join-room', { roomId, password: '', username, color });
    });
}

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
// Typing notification tests
// ---------------------------------------------------------------------------

describe('Typing Notifications', function () {
    const ROOM = 'test-room-typing';

    let alice, bob;

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

    // -----------------------------------------------------------------------
    // Core broadcast tests
    // -----------------------------------------------------------------------

    it('broadcasts user-typing to other room members when typing-start is emitted', function (done) {
        Promise.all([joinRoom(alice, ROOM, 'alice'), joinRoom(bob, ROOM, 'bob')])
            .then(() => {
                bob.once('user-typing', (data) => {
                    expect(data).to.deep.equal({ username: 'alice' });
                    done();
                });
                alice.emit('typing-start', { roomId: ROOM, username: 'alice' });
            })
            .catch(done);
    });

    it('broadcasts user-stopped-typing to other room members when typing-stop is emitted', function (done) {
        Promise.all([joinRoom(alice, ROOM, 'alice'), joinRoom(bob, ROOM, 'bob')])
            .then(() => {
                bob.once('user-stopped-typing', (data) => {
                    expect(data).to.deep.equal({ username: 'alice' });
                    done();
                });
                alice.emit('typing-stop', { roomId: ROOM, username: 'alice' });
            })
            .catch(done);
    });

    it('does NOT echo user-typing back to the sender', function (done) {
        joinRoom(alice, ROOM, 'alice')
            .then(() => {
                const fail = () => done(new Error('sender received its own user-typing event'));
                alice.once('user-typing', fail);
                alice.emit('typing-start', { roomId: ROOM, username: 'alice' });
                // If no echo arrives within 500 ms we consider it passing
                setTimeout(() => {
                    alice.off('user-typing', fail);
                    done();
                }, 500);
            })
            .catch(done);
    });

    it('broadcasts user-stopped-typing when a typing user disconnects', function (done) {
        Promise.all([joinRoom(alice, ROOM, 'alice'), joinRoom(bob, ROOM, 'bob')])
            .then(() => {
                bob.once('user-stopped-typing', (data) => {
                    expect(data.username).to.equal('alice');
                    done();
                });
                // Alice starts typing then disconnects without sending typing-stop
                alice.emit('typing-start', { roomId: ROOM, username: 'alice' });
                setTimeout(() => alice.disconnect(), 100);
            })
            .catch(done);
    });

    // -----------------------------------------------------------------------
    // Room isolation tests
    // -----------------------------------------------------------------------

    it('does NOT deliver user-typing events to clients in a different room', function (done) {
        const OTHER_ROOM = 'other-room-typing';
        Promise.all([joinRoom(alice, ROOM, 'alice'), joinRoom(bob, OTHER_ROOM, 'bob')])
            .then(() => {
                const fail = () => done(new Error('bob received typing event from a different room'));
                bob.once('user-typing', fail);
                alice.emit('typing-start', { roomId: ROOM, username: 'alice' });
                setTimeout(() => {
                    bob.off('user-typing', fail);
                    done();
                }, 500);
            })
            .catch(done);
    });

    it('does NOT deliver user-stopped-typing events to clients in a different room', function (done) {
        const OTHER_ROOM = 'other-room-typing-stop';
        Promise.all([joinRoom(alice, ROOM, 'alice'), joinRoom(bob, OTHER_ROOM, 'bob')])
            .then(() => {
                const fail = () => done(new Error('bob received stopped-typing event from a different room'));
                bob.once('user-stopped-typing', fail);
                alice.emit('typing-stop', { roomId: ROOM, username: 'alice' });
                setTimeout(() => {
                    bob.off('user-stopped-typing', fail);
                    done();
                }, 500);
            })
            .catch(done);
    });

    // -----------------------------------------------------------------------
    // Validation / edge-case tests
    // -----------------------------------------------------------------------

    it('ignores typing-start when roomId is missing', function (done) {
        Promise.all([joinRoom(alice, ROOM, 'alice'), joinRoom(bob, ROOM, 'bob')])
            .then(() => {
                const fail = () => done(new Error('bob received user-typing despite missing roomId'));
                bob.once('user-typing', fail);
                alice.emit('typing-start', { username: 'alice' }); // no roomId
                setTimeout(() => {
                    bob.off('user-typing', fail);
                    done();
                }, 500);
            })
            .catch(done);
    });

    it('ignores typing-start when username is missing', function (done) {
        Promise.all([joinRoom(alice, ROOM, 'alice'), joinRoom(bob, ROOM, 'bob')])
            .then(() => {
                const fail = () => done(new Error('bob received user-typing despite missing username'));
                bob.once('user-typing', fail);
                alice.emit('typing-start', { roomId: ROOM }); // no username
                setTimeout(() => {
                    bob.off('user-typing', fail);
                    done();
                }, 500);
            })
            .catch(done);
    });

    it('ignores typing-stop when roomId is missing', function (done) {
        Promise.all([joinRoom(alice, ROOM, 'alice'), joinRoom(bob, ROOM, 'bob')])
            .then(() => {
                const fail = () => done(new Error('bob received user-stopped-typing despite missing roomId'));
                bob.once('user-stopped-typing', fail);
                alice.emit('typing-stop', { username: 'alice' }); // no roomId
                setTimeout(() => {
                    bob.off('user-stopped-typing', fail);
                    done();
                }, 500);
            })
            .catch(done);
    });

    it('ignores typing-stop when username is missing', function (done) {
        Promise.all([joinRoom(alice, ROOM, 'alice'), joinRoom(bob, ROOM, 'bob')])
            .then(() => {
                const fail = () => done(new Error('bob received user-stopped-typing despite missing username'));
                bob.once('user-stopped-typing', fail);
                alice.emit('typing-stop', { roomId: ROOM }); // no username
                setTimeout(() => {
                    bob.off('user-stopped-typing', fail);
                    done();
                }, 500);
            })
            .catch(done);
    });

    it('ignores typing-start when client is not in the specified room', function (done) {
        const WRONG_ROOM = 'room-alice-never-joined';
        // alice joins ROOM, bob joins WRONG_ROOM
        Promise.all([joinRoom(alice, ROOM, 'alice'), joinRoom(bob, WRONG_ROOM, 'bob')])
            .then(() => {
                const fail = () => done(new Error('bob received user-typing from a room alice never joined'));
                bob.once('user-typing', fail);
                // alice tries to send typing-start for WRONG_ROOM (which she hasn't joined)
                alice.emit('typing-start', { roomId: WRONG_ROOM, username: 'alice' });
                setTimeout(() => {
                    bob.off('user-typing', fail);
                    done();
                }, 500);
            })
            .catch(done);
    });

    // -----------------------------------------------------------------------
    // Multiple users typing
    // -----------------------------------------------------------------------

    it('correctly delivers typing events from multiple users to a third observer', function (done) {
        const MULTI_ROOM = 'test-room-multi-typing';
        const carol = connect();
        let carolReady = false;
        carol.once('connect', () => { carolReady = true; });

        // Wait for carol to connect before joining
        const poll = setInterval(() => {
            if (carolReady) {
                clearInterval(poll);
                Promise.all([
                    joinRoom(alice, MULTI_ROOM, 'alice'),
                    joinRoom(bob, MULTI_ROOM, 'bob'),
                    joinRoom(carol, MULTI_ROOM, 'carol'),
                ])
                    .then(() => {
                        const received = new Set();
                        const onTyping = (data) => {
                            received.add(data.username);
                            if (received.has('alice') && received.has('bob')) {
                                carol.off('user-typing', onTyping);
                                carol.disconnect();
                                done();
                            }
                        };
                        carol.on('user-typing', onTyping);
                        alice.emit('typing-start', { roomId: MULTI_ROOM, username: 'alice' });
                        bob.emit('typing-start', { roomId: MULTI_ROOM, username: 'bob' });
                    })
                    .catch((err) => { carol.disconnect(); done(err); });
            }
        }, 50);
    });
});
