const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Load external JSON dictionary file on server startup
let movieDictionary = [];
const dictionaryPath = path.join(__dirname, 'movies.json');

try {
  const rawData = fs.readFileSync(dictionaryPath, 'utf-8');
  movieDictionary = JSON.parse(rawData);
  console.log(`Successfully loaded ${movieDictionary.length} entries into dictionary.`);
} catch (error) {
  console.error('Error reading movies.json file:', error);
}

let rooms = {}; // RoomCode -> Room State Object

function getRandomWords(count) {
  if (movieDictionary.length === 0) return [];
  let shuffled = [...movieDictionary].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

io.on('connection', (socket) => {
  socket.on('create-room', ({ playerName }) => {
    // Corrected string formatting syntax for room code generation
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    rooms[roomCode] = {
      hostId: socket.id,
      players: [{ id: socket.id, name: playerName, score: 0 }],
      state: 'lobby', // lobby, selecting, hosting, round-over, game-over
      roundsPlayed: 0,
      hostRotationIndex: 0,
      currentHostId: null,
      playerHands: {}, // socketId -> array of 4 words
      selectedWords: {} // socketId -> word they chose this turn
    };

    socket.join(roomCode);
    socket.emit('room-joined', { roomCode, isHost: true, room: rooms[roomCode] });
  });

  socket.on('join-room', ({ roomCode, playerName }) => {
    if (!roomCode) return;
    roomCode = roomCode.toUpperCase();
    if (!rooms[roomCode]) {
      return socket.emit('error-msg', 'Room not found!');
    }
    if (rooms[roomCode].state !== 'lobby') {
      return socket.emit('error-msg', 'Game already in progress!');
    }

    rooms[roomCode].players.push({ id: socket.id, name: playerName, score: 0 });
    socket.join(roomCode);
    io.to(roomCode).emit('update-room', rooms[roomCode]);
    socket.emit('room-joined', { roomCode, isHost: false, room: rooms[roomCode] });
  });

  socket.on('start-game', ({ roomCode }) => {
    let room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) {
      return socket.emit('error-msg', 'Need at least 2 players to start!');
    }

    room.state = 'selecting';
    room.roundsPlayed = 0;
    room.hostRotationIndex = 0;
    room.currentHostId = room.players[0].id; // First player is host of round 1

    // Deal 4 random words to everyone except the current host
    room.players.forEach(p => {
      if (p.id !== room.currentHostId) {
        room.playerHands[p.id] = getRandomWords(4);
      }
    });

    io.to(roomCode).emit('game-started', room);
  });

  socket.on('submit-word', ({ roomCode, chosenWord }) => {
    let room = rooms[roomCode];
    if (!room || room.state !== 'selecting') return;

    room.selectedWords[socket.id] = chosenWord;

    // Remove selected word from player's hand and pass remaining 3 to next player
    let hand = room.playerHands[socket.id] || [];
    let wordIndex = hand.indexOf(chosenWord);
    if (wordIndex > -1) hand.splice(wordIndex, 1);

    let currentPlayerIndex = room.players.findIndex(p => p.id === socket.id);
    let nextPlayerIndex = (currentPlayerIndex + 1) % room.players.length;
    let nextPlayer = room.players[nextPlayerIndex];

    // If next player is the host, skip them and pass to the player after them
    if (nextPlayer.id === room.currentHostId) {
      nextPlayerIndex = (nextPlayerIndex + 1) % room.players.length;
      nextPlayer = room.players[nextPlayerIndex];
    }

    // Give remaining words to next player (if they are not the host)
    if (nextPlayer.id !== room.currentHostId) {
      room.playerHands[nextPlayer.id] = (room.playerHands[nextPlayer.id] || []).concat(hand);
    }
    room.playerHands[socket.id] = []; // Clear hand after passing

    // Check if all non-host players have submitted a word
    let nonHostPlayers = room.players.filter(p => p.id !== room.currentHostId);
    let allSubmitted = nonHostPlayers.every(p => room.selectedWords[p.id]);

    if (allSubmitted) {
      room.state = 'hosting'; // Transition to host ranking screen
    }

    io.to(roomCode).emit('update-room', room);
  });

  socket.on('submit-rankings', ({ roomCode, rankedSocketIds }) => {
    let room = rooms[roomCode];
    if (!room || room.currentHostId !== socket.id || room.state !== 'hosting') return;

    // Expects `rankedSocketIds` to be ordered from best (index 0) to worst (last index).
    // The top-ranked player gets highest points, descending down to 1 point for last place.
    let totalRanked = rankedSocketIds.length;
    rankedSocketIds.forEach((sId, index) => {
      let player = room.players.find(p => p.id === sId);
      if (player) {
        let pointsEarned = totalRanked - index; // e.g., 1st gets 3, 2nd gets 2, 3rd gets 1
        player.score += pointsEarned;
      }
    });

    room.roundsPlayed++;
    if (room.roundsPlayed >= room.players.length) {
      room.state = 'game-over';
    } else {
      // Rotate host role to the next person
      room.hostRotationIndex = (room.hostRotationIndex + 1) % room.players.length;
      room.currentHostId = room.players[room.hostRotationIndex].id;
      room.state = 'selecting';
      room.selectedWords = {};
      room.playerHands = {};

      room.players.forEach(p => {
        if (p.id !== room.currentHostId) {
          room.playerHands[p.id] = getRandomWords(4);
        }
      });
    }

    io.to(roomCode).emit('update-room', room);
  });

  socket.on('disconnect', () => {
    for (let roomCode in rooms) {
      let room = rooms[roomCode];
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[roomCode];
      } else {
        io.to(roomCode).emit('update-room', room);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
