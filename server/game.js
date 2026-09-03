const { nanoid } = require('nanoid');

// 10 kishi uchun standart rol taqsimoti
// 3 Mafia, 1 Detective (Komissar), 1 Doctor, 5 Tinch aholi
const ROLE_SETUPS = {
  10: { mafia: 3, detective: 1, doctor: 1, civilian: 5 },
  9:  { mafia: 2, detective: 1, doctor: 1, civilian: 5 },
  8:  { mafia: 2, detective: 1, doctor: 1, civilian: 4 },
  7:  { mafia: 2, detective: 1, doctor: 1, civilian: 3 },
  6:  { mafia: 2, detective: 1, doctor: 0, civilian: 3 },
  5:  { mafia: 1, detective: 1, doctor: 1, civilian: 2 },
  4:  { mafia: 1, detective: 1, doctor: 0, civilian: 2 },
};

const PHASE = {
  LOBBY: 'lobby',
  NIGHT: 'night',
  DAY: 'day',
  VOTING: 'voting',
  RESULT: 'result',
  ENDED: 'ended',
};

const NIGHT_SECONDS = 45;
const DAY_SECONDS = 90;
const VOTING_SECONDS = 30;
const RESULT_SECONDS = 8;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Room {
  constructor(hostId, hostName) {
    this.id = nanoid(6).toUpperCase();
    this.players = new Map(); // socketId -> {id, name, role, alive, tgId}
    this.hostId = hostId;
    this.phase = PHASE.LOBBY;
    this.round = 0;
    this.nightActions = {}; // { mafiaTargetId, doctorSaveId, detectiveCheckId }
    this.votes = {}; // voterId -> targetId
    this.timer = null;
    this.timeLeft = 0;
    this.log = [];
    this.addPlayer(hostId, hostName);
  }

  addPlayer(id, name, isBot = false) {
    if (this.phase !== PHASE.LOBBY) return { error: "O'yin allaqachon boshlangan" };
    if (this.players.size >= 10) return { error: 'Xona to\'la (10/10)' };
    this.players.set(id, { id, name, role: null, alive: true, isBot });
    return { ok: true };
  }

  botCount() {
    return [...this.players.values()].filter(p => p.isBot).length;
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  playerList() {
    return [...this.players.values()].map(p => ({
      id: p.id, name: p.name, alive: p.alive, isBot: !!p.isBot,
    }));
  }

  canStart() {
    const n = this.players.size;
    return n >= 4 && ROLE_SETUPS[n];
  }

  assignRoles() {
    const n = this.players.size;
    const setup = ROLE_SETUPS[n];
    const roles = [];
    for (let i = 0; i < setup.mafia; i++) roles.push('mafia');
    for (let i = 0; i < setup.detective; i++) roles.push('detective');
    for (let i = 0; i < setup.doctor; i++) roles.push('doctor');
    for (let i = 0; i < setup.civilian; i++) roles.push('civilian');
    const shuffled = shuffle(roles);
    let i = 0;
    for (const p of this.players.values()) {
      p.role = shuffled[i++];
      p.alive = true;
    }
  }

  getMafiaIds() {
    return [...this.players.values()].filter(p => p.role === 'mafia' && p.alive).map(p => p.id);
  }

  alivePlayers() {
    return [...this.players.values()].filter(p => p.alive);
  }

  aliveCount(role) {
    return [...this.players.values()].filter(p => p.alive && (role ? p.role === role : true)).length;
  }

  checkWinner() {
    const mafiaAlive = this.aliveCount('mafia');
    const totalAlive = this.aliveCount();
    if (mafiaAlive === 0) return 'civilian';
    if (mafiaAlive >= totalAlive - mafiaAlive) return 'mafia';
    return null;
  }

  resolveNight() {
    const { mafiaTargetId, doctorSaveId, detectiveCheckId } = this.nightActions;
    let killedId = null;
    if (mafiaTargetId && mafiaTargetId !== doctorSaveId) {
      const target = this.players.get(mafiaTargetId);
      if (target && target.alive) {
        target.alive = false;
        killedId = mafiaTargetId;
      }
    }
    let detectiveResult = null;
    if (detectiveCheckId) {
      const suspect = this.players.get(detectiveCheckId);
      if (suspect) detectiveResult = { targetId: detectiveCheckId, isMafia: suspect.role === 'mafia' };
    }
    this.nightActions = {};
    return { killedId, detectiveResult };
  }

  resolveVoting() {
    const tally = {};
    for (const targetId of Object.values(this.votes)) {
      tally[targetId] = (tally[targetId] || 0) + 1;
    }
    let maxVotes = 0;
    let eliminatedId = null;
    let tie = false;
    for (const [id, count] of Object.entries(tally)) {
      if (count > maxVotes) { maxVotes = count; eliminatedId = id; tie = false; }
      else if (count === maxVotes) { tie = true; }
    }
    if (tie || !eliminatedId) {
      this.votes = {};
      return { eliminatedId: null, tally };
    }
    const player = this.players.get(eliminatedId);
    if (player) player.alive = false;
    this.votes = {};
    return { eliminatedId, tally };
  }
}

module.exports = { Room, PHASE, NIGHT_SECONDS, DAY_SECONDS, VOTING_SECONDS, RESULT_SECONDS, ROLE_SETUPS };
