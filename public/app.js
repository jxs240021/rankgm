// Front-end event listener for Start Game button
document.getElementById('start-game-btn').addEventListener('click', () => {
  const confirmStart = confirm(
    "Are you sure all players have joined?\n\nOnce the game is started, no additional players will be able to join this game instance."
  );

  if (confirmStart) {
    socket.emit('start-game', { roomCode: currentRoomCode });
  }
});
