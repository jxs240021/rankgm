const socket = io();

let myId = null;
let currentRoomCode = null;
let isCreator = false;

document.getElementById('create-btn').onclick = () => {
    let name = document.getElementById('player-name').value.trim();
    if (!name) return alert('Please enter your name');
    socket.emit('create-room', { playerName: name });
};

document.getElementById('join-btn').onclick = () => {
    let name = document.getElementById('player-name').value.trim();
    let roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (!name || !roomCode) return alert('Enter name and room code');
    socket.emit('join-room', { roomCode, playerName: name });
};

socket.on('room-joined', (data) => {
    currentRoomCode = data.roomCode;
    isCreator = data.isHost;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
    document.getElementById('display-room-code').innerText = currentRoomCode;
});

socket.on('error-msg', (msg) => {
    alert(msg);
});

socket.on('update-room', (room) => {
    updateGameUI(room);
});

socket.on('game-started', (room) => {
    updateGameUI(room);
});

function startGame() {
    socket.emit('start-game', { roomCode: currentRoomCode });
}

function updateGameUI(room) {
    let mySockId = socket.id;
    let lobbyDiv = document.getElementById('lobby-section');
    let playDiv = document.getElementById('play-section');
    
    // Scoreboard setup
    let scoreboardHtml = '<h3>Scoreboard</h3><ul>';
    room.players.forEach(p => {
        scoreboardHtml += `<li>${p.name}: ${p.score} pts ${p.id === room.currentHostId ? '👑 (Host)' : ''}</li>`;
    });
    scoreboardHtml += '</ul>';
    document.getElementById('scoreboard').innerHTML = scoreboardHtml;

    if (room.state === 'lobby') {
        lobbyDiv.style.display = 'block';
        playDiv.style.display = 'none';
        let html = '<h3>Players in Room:</h3><ul>';
        room.players.forEach(p => {
            html += `<li>${p.name} ${p.id === room.hostId ? '(Room Creator)' : ''}</li>`;
        });
        html += '</ul>';
        if (isCreator) {
            html += `<button onclick="startGame()">Start Game</button>`;
        } else {
            html += `<p>Waiting for host to start...</p>`;
        }
        lobbyDiv.innerHTML = html;
    } else {
        lobbyDiv.style.display = 'none';
        playDiv.style.display = 'block';

        if (room.state === 'game-over') {
            playDiv.innerHTML = `<h2>Game Over! Final Scores Above.</h2>`;
            return;
        }

        let isCurrentHost = (room.currentHostId === mySockId);

        if (isCurrentHost) {
            if (room.state === 'hosting') {
                // Host ranking interface
                let submittedEntries = Object.entries(room.selectedWords);
                let html = `<h3>You are the Host! Rank the submitted movie words:</h3>`;
                html += `<div id="ranking-list">`;
                submittedEntries.forEach(([sId, word], idx) => {
                    let pObj = room.players.find(p => p.id === sId);
                    html += `<div class="rank-item" data-id="${sId}" style="margin: 5px; padding: 5px; background: #eee;">
                        <span>${pObj ? pObj.name : 'Unknown'}: <strong>${word}</strong></span>
                        <button onclick="moveRank(this, -1)">⬆️</button>
                        <button onclick="moveRank(this, 1)">⬇️</button>
                    </div>`;
                });
                html += `</div><button onclick="submitRankings('${room.code}')" style="margin-top:10px;">Lock In Rankings & Award Points</button>`;
                playDiv.innerHTML = html;
            } else {
                playDiv.innerHTML = `<h3>You are the Host this round!</h3><p>Waiting for other players to pick their words and pass templates...</p>`;
            }
        } else {
            // Regular player interface
            let hand = room.playerHands[mySockId] || [];
            let alreadySubmitted = room.selectedWords[mySockId];

            if (alreadySubmitted) {
                playDiv.innerHTML = `<h3>You selected: "${alreadySubmitted}"</h3><p>Waiting for other players and the host...</p>`;
            } else {
                let html = `<h3>Your Prompt Hand (Select 1 word to use):</h3><div style="display:flex; gap:10px;">`;
                hand.forEach(word => {
                    html += `<button onclick="selectWord('${word}')" style="padding:15px; font-size:16px;">${word}</button>`;
                });
                html += `</div>`;
                playDiv.innerHTML = html;
            }
        }
    }
}

function selectWord(word) {
    socket.emit('submit-word', { roomCode: currentRoomCode, chosenWord: word });
}

function moveRank(btn, direction) {
    let item = btn.parentElement;
    let list = item.parentElement;
    if (direction === -1 && item.previousElementSibling) {
        list.insertBefore(item, item.previousElementSibling);
    } else if (direction === 1 && item.nextElementSibling) {
        list.insertBefore(item.nextElementSibling, item);
    }
}

function submitRankings() {
    let items = document.querySelectorAll('.rank-item');
    let rankedSocketIds = Array.from(items).map(item => item.getAttribute('data-id'));
    socket.emit('submit-rankings', { roomCode: currentRoomCode, rankedSocketIds });
}