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

// Get unique random words that haven't been used in this game instance
function getRandomWords(count, usedWordsSet) {
  let availableWords = movieDictionary.filter(word => !usedWordsSet.has(word));
  
  // Reshuffle available pool
  let shuffled = [...availableWords].sort(() => 0.5 - Math.random());
  let selected = shuffled.slice(0, count);

  // Mark selected words as used
  selected.forEach(word => usedWordsSet.add(word));
  return selected;
}

io.on('connection', (socket) => {
  socket.on('create-room', ({ playerName }) => {
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    rooms[roomCode] = {
      hostId: socket.id,
      players: [{ id: socket.id, name: playerName, score: 0 }],
      state: 'lobby', // lobby, selecting, hosting, game-over
      roundsPlayed: 0,
      hostRotationIndex: 0,
      currentHostId: null,
      playerHands: {},         // socketId -> array of words currently in hand
      selectedWords: {},       // socketId -> word chosen this round
      usedWords: new Set(),    // Track all words dealt/used during this game session
      passedHands: {}          // socketId -> hand of 3 words passed to them for the next turn
    };

    socket.join(roomCode);
    socket.emit('room-joined', { roomCode, isHost: true, room: serializeRoom(rooms[roomCode]) });
  });

  socket.on('join-room', ({ roomCode, playerName }) => {
    if (!roomCode) return;
    roomCode = roomCode.toUpperCase();
    let room = rooms[roomCode];

    if (!room) {
      return socket.emit('error-msg', 'Room not found!');
    }
    // Block new players once game has started
    if (room.state !== 'lobby') {
      return socket.emit('error-msg', 'Game already in progress! New players cannot join once a game has started.');
    }

    room.players.push({ id: socket.id, name: playerName, score: 0 });
    socket.join(roomCode);
    io.to(roomCode).emit('update-room', serializeRoom(room));
    socket.emit('room-joined', { roomCode, isHost: false, room: serializeRoom(room) });
  });

  socket.on('start-game', ({ roomCode }) => {
    let room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.state !== 'lobby') {
      return socket.emit('error-msg', 'Game has already started!');
    }
    if (room.players.length < 2) {
      return socket.emit('error-msg', 'Need at least 2 players to start!');
    }

    room.state = 'selecting';
    room.roundsPlayed = 0;
    room.hostRotationIndex = 0;
    room.currentHostId = room.players[0].id; // First player is host of round 1
    room.usedWords = new Set();
    room.passedHands = {};

    // Initial deal: Deal 4 unique, fresh words to everyone except the current round host
    room.players.forEach(p => {
      if (p.id !== room.currentHostId) {
        room.playerHands[p.id] = getRandomWords(4, room.usedWords);
      } else {
        room.playerHands[p.id] = [];
      }
    });

    io.to(roomCode).emit('game-started', serializeRoom(room));
  });

socket.on('submit-word', ({ roomCode, chosenWord }) => {
    let room = rooms[roomCode];
    if (!room || room.state !== 'selecting') return;

    room.selectedWords[socket.id] = chosenWord;

    // Get current hand and remove chosen word, leaving exactly 3 unchosen words
    let hand = room.playerHands[socket.id] || [];
    let remainingThreeWords = hand.filter(w => w !== chosenWord);

    // Find the next player in the full seating circle (including current host)
    let submitterIndex = room.players.findIndex(p => p.id === socket.id);
    let recipientIndex = (submitterIndex + 1) % room.players.length;
    let recipientPlayer = room.players[recipientIndex];

    // Pass the 3 discarded words directly to the next player in seat order
    room.passedHands[recipientPlayer.id] = remainingThreeWords;

    // Check if all active non-host players have submitted a word
    let nonHostPlayers = room.players.filter(p => p.id !== room.currentHostId);
    let allSubmitted = nonHostPlayers.every(p => room.selectedWords[p.id]);

    if (allSubmitted) {
      room.state = 'hosting'; // Transition to host ranking screen
    }

    io.to(roomCode).emit('update-room', serializeRoom(room));
  });
  
  socket.on('submit-rankings', ({ roomCode, rankedSocketIds }) => {
    let room = rooms[roomCode];
    if (!room || room.currentHostId !== socket.id || room.state !== 'hosting') return;

    // Award points (1st place = highest points down to 1 point)
    let totalRanked = rankedSocketIds.length;
    rankedSocketIds.forEach((sId, index) => {
      let player = room.players.find(p => p.id === sId);
      if (player) {
        let pointsEarned = totalRanked - index;
        player.score += pointsEarned;
      }
    });

    room.roundsPlayed++;
    if (room.roundsPlayed >= room.players.length) {
      room.state = 'game-over';
    } else {
      // Rotate host role to the next player in seating order
      room.hostRotationIndex = (room.hostRotationIndex + 1) % room.players.length;
      room.currentHostId = room.players[room.hostRotationIndex].id;
      room.state = 'selecting';
      room.selectedWords = {};
      
      // Deal hands for the next round:
      // The new host gets 0 cards.
      // Every active non-host player gets their 3 passed discarded words + 1 new unique card = 4 cards.
      room.players.forEach(p => {
        if (p.id !== room.currentHostId) {
          let passedThree = room.passedHands[p.id] || [];
          let oneNewWord = getRandomWords(1, room.usedWords);

          if (passedThree.length === 3) {
            room.playerHands[p.id] = [...passedThree, ...oneNewWord];
          } else {
            // Fallback just in case (e.g. Round 1 initial deal)
            room.playerHands[p.id] = getRandomWords(4, room.usedWords);
          }
        } else {
          // The new host does not play cards this round
          room.playerHands[p.id] = [];
        }
      });

      // Reset passed hands queue for the next turn
      room.passedHands = {};
    }

    io.to(roomCode).emit('update-room', serializeRoom(room));
  });
  
  socket.on('disconnect', () => {
    for (let roomCode in rooms) {
      let room = rooms[roomCode];
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[roomCode];
      } else {
        io.to(roomCode).emit('update-room', serializeRoom(room));
      }
    }
  });
});

// Helper function to convert Sets to Arrays for JSON serialization over web sockets
function serializeRoom(room) {
  return {
    ...room,
    usedWords: Array.from(room.usedWords || [])
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
