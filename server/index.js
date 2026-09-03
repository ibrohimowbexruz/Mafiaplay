const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { nanoid } = require('nanoid');
const { Room, PHASE, NIGHT_SECONDS, DAY_SECONDS, VOTING_SECONDS, RESULT_SECONDS } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '..', 'public')));

const rooms = new Map(); // roomId -> Room

function publicPlayerView(room, forId) {
  const me = room.players.get(forId);
  return {
    roomId: room.id,
    phase: room.phase,
    round: room.round,
    timeLeft: room.timeLeft,
    players: room.playerList(),
    myRole: me ? me.role : null,
    myAlive: me ? me.alive : null,
    isHost: room.hostId === forId,
    mafiaTeam: me && me.role === 'mafia'
      ? room.playerList().filter(p => room.players.get(p.id).role === 'mafia')
      : null,
  };
}

function broadcastState(room) {
  for (const id of room.players.keys()) {
    io.to(id).emit('state', publicPlayerView(room, id));
  }
}

function clearTimer(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
}

function startTimer(room, seconds, onEnd) {
  clearTimer(room);
  room.timeLeft = seconds;
  room.timer = setInterval(() => {
    room.timeLeft--;
    if (room.timeLeft <= 0) {
      clearTimer(room);
      onEnd();
    } else {
      broadcastState(room);
    }
  }, 1000);
}

const BOT_NAMES = ['Aziz', 'Malika', 'Sardor', 'Nodira', 'Jasur', 'Kamola', 'Otabek', 'Zilola', 'Bekzod', 'Sitora'];

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickBotName(room) {
  const used = new Set([...room.players.values()].map(p => p.name));
  const free = BOT_NAMES.filter(n => !used.has(n));
  return free.length ? randomPick(free) : `Bot${Math.floor(Math.random() * 1000)}`;
}

function runBotNightActions(room) {
  if (room.phase !== PHASE.NIGHT) return;
  const alive = room.alivePlayers();
  for (const p of alive) {
    if (!p.isBot) continue;
    const delay = 1000 + Math.random() * (NIGHT_SECONDS * 1000 * 0.5);
    setTimeout(() => {
      if (room.phase !== PHASE.NIGHT || !p.alive) return;
      const others = alive.filter(x => x.id !== p.id && x.alive);
      if (!others.length) return;
      if (p.role === 'mafia') {
        const targets = others.filter(x => x.role !== 'mafia');
        if (targets.length) room.nightActions.mafiaTargetId = randomPick(targets).id;
      } else if (p.role === 'doctor') {
        room.nightActions.doctorSaveId = randomPick(others).id;
      } else if (p.role === 'detective') {
        room.nightActions.detectiveCheckId = randomPick(others).id;
      }
    }, delay);
  }
}

function runBotVotes(room) {
  if (room.phase !== PHASE.VOTING) return;
  const alive = room.alivePlayers();
  for (const p of alive) {
    if (!p.isBot) continue;
    const delay = 1000 + Math.random() * (VOTING_SECONDS * 1000 * 0.6);
    setTimeout(() => {
      if (room.phase !== PHASE.VOTING || !p.alive) return;
      const others = alive.filter(x => x.id !== p.id && x.alive);
      if (!others.length) return;
      let pool = others;
      if (p.role === 'mafia') {
        const nonMafia = others.filter(x => x.role !== 'mafia');
        if (nonMafia.length) pool = nonMafia;
      }
      room.votes[p.id] = randomPick(pool).id;
    }, delay);
  }
}

function startNight(room) {
  room.phase = PHASE.NIGHT;
  room.round++;
  room.nightActions = {};
  broadcastState(room);
  startTimer(room, NIGHT_SECONDS, () => resolveNightPhase(room));
  runBotNightActions(room);
}

function resolveNightPhase(room) {
  const { killedId, detectiveResult } = room.resolveNight();
  room.phase = PHASE.RESULT;
  const killedPlayer = killedId ? room.players.get(killedId) : null;
  room.log.push(killedPlayer
    ? `Tun natijasi: ${killedPlayer.name} o'ldirildi.`
    : `Tun natijasi: bu kecha hech kim o'lmadi.`);
  broadcastState(room);
  io.to(room.id).emit('nightResult', {
    killedId,
    killedName: killedPlayer ? killedPlayer.name : null,
  });
  // Detective faqat o'ziga natija ko'radi
  if (detectiveResult) {
    const detective = [...room.players.values()].find(p => p.role === 'detective' && p.alive);
    if (detective) {
      const suspect = room.players.get(detectiveResult.targetId);
      io.to(detective.id).emit('detectiveResult', {
        targetName: suspect ? suspect.name : '?',
        isMafia: detectiveResult.isMafia,
      });
    }
  }
  const winner = room.checkWinner();
  if (winner) return endGame(room, winner);

  startTimer(room, RESULT_SECONDS, () => startDay(room));
}

function startDay(room) {
  room.phase = PHASE.DAY;
  broadcastState(room);
  startTimer(room, DAY_SECONDS, () => startVoting(room));
}

function startVoting(room) {
  room.phase = PHASE.VOTING;
  room.votes = {};
  broadcastState(room);
  startTimer(room, VOTING_SECONDS, () => resolveVotingPhase(room));
  runBotVotes(room);
}

function resolveVotingPhase(room) {
  const { eliminatedId, tally } = room.resolveVoting();
  room.phase = PHASE.RESULT;
  const eliminated = eliminatedId ? room.players.get(eliminatedId) : null;
  room.log.push(eliminated
    ? `Ovoz natijasi: ${eliminated.name} chiqarib yuborildi (rol: ${eliminated.role}).`
    : `Ovoz natijasi: ovozlar taqsimlandi, hech kim chiqarilmadi.`);
  broadcastState(room);
  io.to(room.id).emit('votingResult', {
    eliminatedId,
    eliminatedName: eliminated ? eliminated.name : null,
    eliminatedRole: eliminated ? eliminated.role : null,
    tally,
  });
  const winner = room.checkWinner();
  if (winner) return endGame(room, winner);

  startTimer(room, RESULT_SECONDS, () => startNight(room));
}

function endGame(room, winner) {
  clearTimer(room);
  room.phase = PHASE.ENDED;
  io.to(room.id).emit('gameOver', {
    winner,
    players: [...room.players.values()].map(p => ({ name: p.name, role: p.role, alive: p.alive })),
  });
  broadcastState(room);
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, cb) => {
    const room = new Room(socket.id, name || 'Host');
    rooms.set(room.id, room);
    socket.join(room.id);
    socket.roomId = room.id;
    cb({ ok: true, roomId: room.id });
    broadcastState(room);
  });

  socket.on('joinRoom', ({ roomId, name }, cb) => {
    const room = rooms.get((roomId || '').toUpperCase());
    if (!room) return cb({ error: 'Xona topilmadi' });
    const res = room.addPlayer(socket.id, name || 'O\'yinchi');
    if (res.error) return cb({ error: res.error });
    socket.join(room.id);
    socket.roomId = room.id;
    cb({ ok: true, roomId: room.id });
    broadcastState(room);
  });

  socket.on('addBot', () => {
    const room = rooms.get(socket.roomId);
    if (!room || room.hostId !== socket.id) return;
    const botId = 'bot_' + nanoid(8);
    const name = pickBotName(room);
    room.addPlayer(botId, name, true);
    broadcastState(room);
  });

  socket.on('removeBot', () => {
    const room = rooms.get(socket.roomId);
    if (!room || room.hostId !== socket.id || room.phase !== PHASE.LOBBY) return;
    const bots = [...room.players.values()].filter(p => p.isBot);
    if (!bots.length) return;
    room.removePlayer(bots[bots.length - 1].id);
    broadcastState(room);
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.roomId);
    if (!room || room.hostId !== socket.id) return;
    if (!room.canStart()) return;
    room.assignRoles();
    startNight(room);
  });

  socket.on('mafiaTarget', ({ targetId }) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.phase !== PHASE.NIGHT) return;
    const me = room.players.get(socket.id);
    if (!me || me.role !== 'mafia' || !me.alive) return;
    room.nightActions.mafiaTargetId = targetId;
  });

  socket.on('doctorSave', ({ targetId }) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.phase !== PHASE.NIGHT) return;
    const me = room.players.get(socket.id);
    if (!me || me.role !== 'doctor' || !me.alive) return;
    room.nightActions.doctorSaveId = targetId;
  });

  socket.on('detectiveCheck', ({ targetId }) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.phase !== PHASE.NIGHT) return;
    const me = room.players.get(socket.id);
    if (!me || me.role !== 'detective' || !me.alive) return;
    room.nightActions.detectiveCheckId = targetId;
  });

  socket.on('castVote', ({ targetId }) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.phase !== PHASE.VOTING) return;
    const me = room.players.get(socket.id);
    if (!me || !me.alive) return;
    room.votes[socket.id] = targetId;
  });

  socket.on('chatMessage', ({ text }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const me = room.players.get(socket.id);
    if (!me) return;
    // O'lganlar faqat o'lganlar bilan gaplashadi, tunda mafia faqat o'zaro
    if (room.phase === PHASE.NIGHT) {
      if (me.role === 'mafia' && me.alive) {
        for (const id of room.getMafiaIds()) {
          io.to(id).emit('chatMessage', { name: me.name, text, scope: 'mafia' });
        }
      }
      return;
    }
    if (!me.alive) {
      for (const p of room.players.values()) {
        if (!p.alive) io.to(p.id).emit('chatMessage', { name: me.name, text, scope: 'dead' });
      }
      return;
    }
    io.to(room.id).emit('chatMessage', { name: me.name, text, scope: 'all' });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    if (room.phase === PHASE.LOBBY) {
      room.removePlayer(socket.id);
      if (room.players.size === 0) {
        clearTimer(room);
        rooms.delete(room.id);
      } else {
        if (room.hostId === socket.id) room.hostId = [...room.players.keys()][0];
        broadcastState(room);
      }
    } else {
      const p = room.players.get(socket.id);
      if (p) p.alive = false; // o'yin davomida chiqib ketsa - o'lgan hisoblanadi
      broadcastState(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Mafia server ${PORT}-portda ishlamoqda`));
