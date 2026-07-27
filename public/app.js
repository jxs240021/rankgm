// Front-end event listener for Start Game button
document.getElementById('start-game-btn').addEventListener('click', () => {
  const confirmStart = confirm(
    "Are you sure all players have joined?\n\nOnce the game is started, no additional players will be able to join this game instance."
  );

  if (confirmStart) {
    socket.emit('start-game', { roomCode: currentRoomCode });
  }
});



// Locate your existing Start Game button listener in public/app.js
const startGameBtn = document.getElementById('start-game-btn'); // Make sure this matches your button ID in index.html

if (startGameBtn) {
  startGameBtn.addEventListener('click', () => {
    // 1. Show built-in browser confirmation prompt with Yes/No options (OK / Cancel)
    const hostConfirmed = confirm(
      "Are all players in the lobby?\n\nOnce you start the game, no new players will be able to join this room. Click OK (Yes) to proceed or Cancel (No) to wait."
    );

    // 2. Only emit the start-game event if the host clicks OK / Yes
    if (hostConfirmed) {
      socket.emit('start-game', { roomCode: currentRoomCode });
    } else {
      console.log("Game start cancelled by host.");
      // Do nothing — the host stays in the lobby screen and can wait for more players
    }
  });
}






let myPlayerName = '';

// Store player name on room creation or join
socket.on('room-joined', ({ roomCode, isHost, room }) => {
  // Find self in room players array or capture from local input
  const me = room.players.find(p => p.id === socket.id);
  if (me) {
    myPlayerName = me.name;
    // Display on the screen
    const nameBadge = document.getElementById('user-display-name');
    if (nameBadge) {
      nameBadge.textContent = `Player: ${myPlayerName}`;
    }
  }
});
