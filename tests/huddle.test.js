const { expect } = require('chai');
const { createServer } = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { app, server, io } = require('../server');

const PORT = 3099;
let serverInstance;

function connect(roomId = 'test-huddle-room', username = 'user1') {
    return new Promise((resolve) => {
        const client = new Client(`http://localhost:${PORT}`);
        client.on('connect', () => {
            client.emit('join-room', { roomId, password: '', username, color: 'cyan' });
        });
        client.once('auth-success', () => resolve(client));
    });
}

before((done) => {
    serverInstance = server.listen(PORT, done);
});

after((done) => {
    serverInstance.close(done);
});

describe('Huddle - Start', () => {
    it('broadcasts huddle-started to room when first user starts huddle', (done) => {
        const roomId = 'test-huddle-start-1';
        Promise.all([connect(roomId, 'alice'), connect(roomId, 'bob')]).then(([alice, bob]) => {
            bob.once('huddle-started', (data) => {
                expect(data).to.have.property('huddleId');
                expect(data.initiator.username).to.equal('alice');
                expect(data.participants).to.have.length(1);
                alice.disconnect();
                bob.disconnect();
                done();
            });
            alice.emit('huddle-start', { roomId });
        });
    });

    it('sends huddle-joined back to the initiator with empty existingPeers', (done) => {
        const roomId = 'test-huddle-start-2';
        connect(roomId, 'alice').then((alice) => {
            alice.once('huddle-joined', (data) => {
                expect(data).to.have.property('huddleId');
                expect(data.existingPeers).to.deep.equal([]);
                expect(data.participants).to.have.length(1);
                alice.disconnect();
                done();
            });
            alice.emit('huddle-start', { roomId });
        });
    });

    it('rejects a second huddle-start in the same room', (done) => {
        const roomId = 'test-huddle-start-3';
        Promise.all([connect(roomId, 'alice'), connect(roomId, 'bob')]).then(([alice, bob]) => {
            alice.once('huddle-joined', () => {
                bob.once('huddle-error', (msg) => {
                    expect(msg).to.include('already active');
                    alice.disconnect();
                    bob.disconnect();
                    done();
                });
                bob.emit('huddle-start', { roomId });
            });
            alice.emit('huddle-start', { roomId });
        });
    });
});

describe('Huddle - Join', () => {
    it('sends huddle-joined with existingPeers when a second user joins', (done) => {
        const roomId = 'test-huddle-join-1';
        Promise.all([connect(roomId, 'alice'), connect(roomId, 'bob')]).then(([alice, bob]) => {
            alice.once('huddle-joined', () => {
                bob.once('huddle-joined', (data) => {
                    expect(data.existingPeers).to.have.length(1);
                    expect(data.existingPeers[0].username).to.equal('alice');
                    expect(data.participants).to.have.length(2);
                    alice.disconnect();
                    bob.disconnect();
                    done();
                });
                bob.emit('huddle-join', { roomId });
            });
            alice.emit('huddle-start', { roomId });
        });
    });

    it('broadcasts huddle-user-joined to the room when a peer joins', (done) => {
        const roomId = 'test-huddle-join-2';
        Promise.all([connect(roomId, 'alice'), connect(roomId, 'bob'), connect(roomId, 'carol')]).then(([alice, bob, carol]) => {
            alice.once('huddle-joined', () => {
                carol.once('huddle-user-joined', (data) => {
                    expect(data.username).to.equal('bob');
                    expect(data.participants).to.have.length(2);
                    alice.disconnect();
                    bob.disconnect();
                    carol.disconnect();
                    done();
                });
                bob.emit('huddle-join', { roomId });
            });
            alice.emit('huddle-start', { roomId });
        });
    });

    it('returns huddle-error if no active huddle exists', (done) => {
        const roomId = 'test-huddle-join-3';
        connect(roomId, 'alice').then((alice) => {
            alice.once('huddle-error', (msg) => {
                expect(msg).to.include('No active huddle');
                alice.disconnect();
                done();
            });
            alice.emit('huddle-join', { roomId });
        });
    });
});

describe('Huddle - Leave', () => {
    it('broadcasts huddle-user-left when a participant leaves', (done) => {
        const roomId = 'test-huddle-leave-1';
        Promise.all([connect(roomId, 'alice'), connect(roomId, 'bob')]).then(([alice, bob]) => {
            bob.once('huddle-joined', () => {
                alice.once('huddle-user-left', (data) => {
                    expect(data.username).to.equal('bob');
                    expect(data.participants).to.have.length(1);
                    alice.disconnect();
                    bob.disconnect();
                    done();
                });
                bob.emit('huddle-leave', { roomId });
            });
            alice.once('huddle-joined', () => {
                bob.emit('huddle-join', { roomId });
            });
            alice.emit('huddle-start', { roomId });
        });
    });

    it('notifies remaining peer via huddle-peer-left when a participant leaves', (done) => {
        const roomId = 'test-huddle-leave-2';
        Promise.all([connect(roomId, 'alice'), connect(roomId, 'bob')]).then(([alice, bob]) => {
            bob.once('huddle-joined', () => {
                alice.once('huddle-peer-left', (data) => {
                    expect(data).to.have.property('socketId');
                    alice.disconnect();
                    bob.disconnect();
                    done();
                });
                bob.emit('huddle-leave', { roomId });
            });
            alice.once('huddle-joined', () => {
                bob.emit('huddle-join', { roomId });
            });
            alice.emit('huddle-start', { roomId });
        });
    });

    it('broadcasts huddle-ended when the last participant leaves', (done) => {
        const roomId = 'test-huddle-leave-3';
        Promise.all([connect(roomId, 'alice'), connect(roomId, 'bob')]).then(([alice, bob]) => {
            alice.once('huddle-joined', () => {
                bob.once('huddle-ended', () => {
                    alice.disconnect();
                    bob.disconnect();
                    done();
                });
                alice.emit('huddle-leave', { roomId });
            });
            alice.emit('huddle-start', { roomId });
        });
    });
});

describe('Huddle - End', () => {
    it('broadcasts huddle-ended to all room members', (done) => {
        const roomId = 'test-huddle-end-1';
        Promise.all([connect(roomId, 'alice'), connect(roomId, 'bob')]).then(([alice, bob]) => {
            alice.once('huddle-joined', () => {
                bob.once('huddle-ended', () => {
                    alice.disconnect();
                    bob.disconnect();
                    done();
                });
                alice.emit('huddle-end', { roomId });
            });
            alice.emit('huddle-start', { roomId });
        });
    });
});

describe('Huddle - Disconnect cleanup', () => {
    it('ends huddle when last participant disconnects', (done) => {
        const roomId = 'test-huddle-dc-1';
        Promise.all([connect(roomId, 'alice'), connect(roomId, 'bob')]).then(([alice, bob]) => {
            alice.once('huddle-joined', () => {
                bob.once('huddle-ended', () => {
                    bob.disconnect();
                    done();
                });
                alice.disconnect(); // disconnect triggers leave
            });
            alice.emit('huddle-start', { roomId });
        });
    });

    it('notifies remaining participants when a peer disconnects', (done) => {
        const roomId = 'test-huddle-dc-2';
        Promise.all([connect(roomId, 'alice'), connect(roomId, 'bob')]).then(([alice, bob]) => {
            bob.once('huddle-joined', () => {
                alice.once('huddle-peer-left', () => {
                    alice.disconnect();
                    done();
                });
                bob.disconnect();
            });
            alice.once('huddle-joined', () => {
                bob.emit('huddle-join', { roomId });
            });
            alice.emit('huddle-start', { roomId });
        });
    });
});

describe('Huddle - Signaling relay', () => {
    it('relays huddle-signal from one peer to another', (done) => {
        const roomId = 'test-huddle-signal-1';
        Promise.all([connect(roomId, 'alice'), connect(roomId, 'bob')]).then(([alice, bob]) => {
            bob.once('huddle-joined', (joinData) => {
                const aliceSocketId = joinData.existingPeers[0].socketId;
                alice.once('huddle-signal', (data) => {
                    expect(data.signal.type).to.equal('offer');
                    expect(data.signal.sdp).to.equal('fake-sdp');
                    alice.disconnect();
                    bob.disconnect();
                    done();
                });
                bob.emit('huddle-signal', {
                    toSocketId: aliceSocketId,
                    signal: { type: 'offer', sdp: 'fake-sdp' }
                });
            });
            alice.once('huddle-joined', () => {
                bob.emit('huddle-join', { roomId });
            });
            alice.emit('huddle-start', { roomId });
        });
    });
});

describe('Huddle - Room join with active huddle', () => {
    it('sends huddle-state to a user joining a room with an active huddle', (done) => {
        const roomId = 'test-huddle-state-1';
        connect(roomId, 'alice').then((alice) => {
            alice.once('huddle-joined', () => {
                // Attach huddle-state listener BEFORE emitting join-room
                // so we don't miss the event that immediately follows auth-success
                const bob = new Client(`http://localhost:${PORT}`);
                bob.once('huddle-state', (data) => {
                    expect(data).to.have.property('huddleId');
                    expect(data.participants).to.have.length(1);
                    alice.disconnect();
                    bob.disconnect();
                    done();
                });
                bob.once('connect', () => {
                    bob.emit('join-room', { roomId, password: '', username: 'bob', color: 'cyan' });
                });
            });
            alice.emit('huddle-start', { roomId });
        });
    });
});
