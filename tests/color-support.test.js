'use strict';

// Test suite for the expanded color palette (FEAT-002).
// Verifies that new colors (added in FEAT-001) flow correctly through
// the server: join with a new color, receive it in messages and user-list,
// and change color via update-user.

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
// Color support tests -- validates the expanded 16-color palette end-to-end
// ---------------------------------------------------------------------------

describe('Color Support', function () {
    const ROOM = 'test-room-color';

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
    // New color in message broadcast
    // -----------------------------------------------------------------------

    // Verifies that a new-palette color ('pink') sent with a message is
    // included in the broadcasted new-message event payload.
    it('broadcasts message with new color (pink) to other users in the room', function (done) {
        const ROOM_MSG = 'test-room-color-msg';

        Promise.all([
            joinRoom(alice, ROOM_MSG, 'alice', 'pink'),
            joinRoom(bob, ROOM_MSG, 'bob', 'cyan')
        ])
            .then(() => {
                // Bob listens for the message from Alice
                bob.once('new-message', (msg) => {
                    // The server should relay the color field as-is
                    expect(msg.user).to.equal('alice');
                    expect(msg.color).to.equal('pink');
                    expect(msg.text).to.equal('hello from pink');
                    done();
                });

                // Alice sends a message with color 'pink' (one of the new colors)
                alice.emit('send-message', {
                    roomId: ROOM_MSG,
                    user: 'alice',
                    text: 'hello from pink',
                    color: 'pink'
                });
            })
            .catch(done);
    });

    // -----------------------------------------------------------------------
    // New color in user-list
    // -----------------------------------------------------------------------

    // Verifies that when a user joins with one of the new colors, the
    // user-list event includes the correct color for that user.
    it('includes new color in user-list when a user joins with a new color', function (done) {
        const ROOM_LIST = 'test-room-color-list';

        // Alice joins first, then Bob joins and triggers a user-list update
        joinRoom(alice, ROOM_LIST, 'alice', 'coral')
            .then(() => {
                // Listen for the user-list event that fires when Bob joins
                alice.once('user-list', (users) => {
                    // Find Alice in the user list and verify her color
                    const aliceEntry = users.find(u => u.username === 'alice');
                    expect(aliceEntry).to.exist;
                    expect(aliceEntry.color).to.equal('coral');

                    // Also verify Bob's color is present
                    const bobEntry = users.find(u => u.username === 'bob');
                    expect(bobEntry).to.exist;
                    expect(bobEntry.color).to.equal('lavender');
                    done();
                });

                // Bob joins with another new color
                joinRoom(bob, ROOM_LIST, 'bob', 'lavender').catch(done);
            })
            .catch(done);
    });

    // -----------------------------------------------------------------------
    // Color change via update-user
    // -----------------------------------------------------------------------

    // Verifies that emitting update-user with a new color ('gold') causes
    // the server to broadcast an updated user-list reflecting the change.
    it('reflects color change via update-user in the user-list', function (done) {
        const ROOM_UPDATE = 'test-room-color-update';

        Promise.all([
            joinRoom(alice, ROOM_UPDATE, 'alice', 'cyan'),
            joinRoom(bob, ROOM_UPDATE, 'bob', 'green')
        ])
            .then(() => {
                // Small delay so initial join user-list events are consumed,
                // then listen for the update-user triggered broadcast.
                setTimeout(() => {
                    bob.once('user-list', (users) => {
                        const aliceEntry = users.find(u => u.username === 'alice');
                        expect(aliceEntry).to.exist;
                        // Alice's color should now be 'gold' after the update
                        expect(aliceEntry.color).to.equal('gold');
                        done();
                    });

                    // Alice changes her color to 'gold' (one of the new colors)
                    alice.emit('update-user', { username: 'alice', color: 'gold' });
                }, 100);
            })
            .catch(done);
    });

    // -----------------------------------------------------------------------
    // Multiple new colors in the same room
    // -----------------------------------------------------------------------

    // Verifies that several users can each use different new-palette colors
    // and all are correctly represented in the user-list.
    it('supports multiple users with different new colors in the same room', function (done) {
        const ROOM_MULTI = 'test-room-color-multi';
        const carol = connect();

        carol.once('connect', () => {
            // Join alice and bob first, then set up listener before carol joins
            Promise.all([
                joinRoom(alice, ROOM_MULTI, 'alice', 'teal'),
                joinRoom(bob, ROOM_MULTI, 'bob', 'lime')
            ])
                .then(() => {
                    // Listen for the user-list broadcast triggered by carol's join
                    alice.once('user-list', (users) => {
                        expect(users).to.have.lengthOf(3);

                        const aliceEntry = users.find(u => u.username === 'alice');
                        const bobEntry = users.find(u => u.username === 'bob');
                        const carolEntry = users.find(u => u.username === 'carol');

                        expect(aliceEntry.color).to.equal('teal');
                        expect(bobEntry.color).to.equal('lime');
                        expect(carolEntry.color).to.equal('silver');

                        carol.disconnect();
                        done();
                    });

                    // Carol joins last, triggering the user-list broadcast
                    joinRoom(carol, ROOM_MULTI, 'carol', 'silver').catch((err) => {
                        carol.disconnect();
                        done(err);
                    });
                })
                .catch((err) => { carol.disconnect(); done(err); });
        });
    });
});
