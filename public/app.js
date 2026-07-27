// Front-end event listener for Start Game button
document.getElementById('start-game-btn').addEventListener('click', () => {
  const confirmStart = confirm(
    "Are you sure all players have joined?\n\nOnce the game is started, no additional players will be able to join this game instance."
  );

  if (confirmStart) {
    socket.emit('start-game', { roomCode: currentRoomCode });
  }
});

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
