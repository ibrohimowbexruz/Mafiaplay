const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const socket = io();
let myId = null;
let currentState = null;
let selectedTarget = null;
let hasVotedThisRound = false;
let lastPhase = null;

const ROLE_INFO = {
  mafia: { name: 'Mafia', desc: "Tunda birovni yo'q qilasiz. Sherikaringiz kim ekanini bilasiz.", icon: 'dagger' },
  detective: { name: 'Komissar', desc: 'Har kecha bir kishini tekshirib, mafia ekan-emasligini bilib olasiz.', icon: 'magnifier' },
  doctor: { name: 'Doktor', desc: "Har kecha bir kishini o'limdan asraysiz.", icon: 'syringe' },
  civilian: { name: 'Tinch aholi', desc: "Kunduzi muhokama va ovoz berish orqali mafiani toping.", icon: 'person' },
};

const ROLE_ICONS = {
  dagger: `<svg viewBox="0 0 48 48" width="30" height="30"><path d="M24 4l3 14-3 4-3-4 3-14z" fill="#fff"/><rect x="22.5" y="20" width="3" height="16" fill="#fff"/><rect x="17" y="34" width="14" height="3" rx="1.5" fill="#fff"/><rect x="22.5" y="36" width="3" height="7" fill="#fff"/></svg>`,
  syringe: `<svg viewBox="0 0 48 48" width="30" height="30"><g fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><line x1="10" y1="38" x2="20" y2="28"/><rect x="18" y="14" width="10" height="16" rx="1.5" transform="rotate(45 23 22)"/><line x1="30" y1="10" x2="34" y2="14"/><line x1="34" y1="6" x2="38" y2="10"/><line x1="26" y1="14" x2="30" y2="10"/></g></svg>`,
  magnifier: `<svg viewBox="0 0 48 48" width="30" height="30"><g fill="none" stroke="#fff" stroke-width="2.5"><circle cx="20" cy="20" r="10"/><line x1="27" y1="27" x2="37" y2="37" stroke-linecap="round"/></g><g fill="#fff"><rect x="30" y="6" width="4" height="14" rx="1" transform="rotate(35 32 13)"/></g></svg>`,
  person: `<svg viewBox="0 0 48 48" width="30" height="30"><circle cx="24" cy="16" r="8" fill="#fff"/><path d="M10 40c0-9 6-14 14-14s14 5 14 14" fill="#fff"/></svg>`,
};

const NIGHT_FACTS = [
  "Bilasizmi? Ma'lumki, oktopuslarning uchta yuragi bor.",
  "Bilasizmi? Bol hech qachon buzilmaydi — minglab yillar saqlanishi mumkin.",
  "Bilasizmi? Bananlar botanik jihatdan rezavorlar hisoblanadi.",
  "Bilasizmi? Insonning yuragi kuniga taxminan 100 000 marta uradi.",
  "Bilasizmi? Eng katta sut emizuvchi — ko'k kit, tili bir filcha og'irlikda.",
  "Bilasizmi? Ayrim toshbaqalar 150 yildan ortiq yashaydi.",
  "Bilasizmi? Yer sayyorasining 70% dan ortig'i suv bilan qoplangan.",
  "Bilasizmi? Chaqmoq quyoshdan 5 barobar issiqroq bo'lishi mumkin.",
  "Bilasizmi? Odam miyasi tanadagi energiyaning taxminan 20% ini sarflaydi.",
  "Bilasizmi? Ari asalari o'z tilida raqsga tushib, ma'lumot uzatadi.",
  "Bilasizmi? Venera Yerdan issiqroq sayyora — qo'rg'oshinni eritadigan haroratda.",
  "Bilasizmi? Dunyoda eng ko'p gapiriladigan til — Mandarin xitoy tili.",
  "Bilasizmi? Momiq bulutlarning og'irligi million tonnaga yetishi mumkin.",
  "Bilasizmi? Muzlik davri paytida mamontlar Misrda piramidalar qurilganda hali yashagan.",
  "Bilasizmi? Inson terisi har 27 kunda to'liq yangilanadi.",
];

function show(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function el(id) { return document.getElementById(id); }

// ---------- ENTRY ----------
el('btnCreate').onclick = () => {
  const name = el('nameInput').value.trim() || tg?.initDataUnsafe?.user?.first_name || "O'yinchi";
  socket.emit('createRoom', { name }, (res) => {
    if (res.error) return (el('entryError').textContent = res.error);
    show('screen-lobby');
  });
};

el('btnJoin').onclick = () => {
  const name = el('nameInput').value.trim() || tg?.initDataUnsafe?.user?.first_name || "O'yinchi";
  const roomId = el('roomCodeInput').value.trim().toUpperCase();
  if (!roomId) return (el('entryError').textContent = 'Xona kodini kiriting');
  socket.emit('joinRoom', { roomId, name }, (res) => {
    if (res.error) return (el('entryError').textContent = res.error);
    show('screen-lobby');
  });
};

// URL orqali avtomatik join (?room=XXXXXX)
const urlParams = new URLSearchParams(window.location.search);
const startParam = tg?.initDataUnsafe?.start_param;
const autoRoom = urlParams.get('room') || startParam;
if (autoRoom) el('roomCodeInput').value = autoRoom.toUpperCase();

// ---------- LOBBY ----------
el('btnShare').onclick = () => {
  const link = `https://t.me/YourBotName/mafia?startapp=${currentState.roomId}`;
  if (tg) {
    tg.switchInlineQuery ? null : null;
    navigator.clipboard?.writeText(link);
  }
  el('lobbyStatus').textContent = 'Link nusxalandi: ' + link;
};

el('btnStart').onclick = () => socket.emit('startGame');
el('btnAddBot').onclick = () => socket.emit('addBot');
el('btnRemoveBot').onclick = () => socket.emit('removeBot');

// ---------- CHAT ----------
el('btnSendChat').onclick = sendChat;
el('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
function sendChat() {
  const text = el('chatInput').value.trim();
  if (!text) return;
  socket.emit('chatMessage', { text });
  el('chatInput').value = '';
}

socket.on('chatMessage', ({ name, text, scope }) => {
  const box = el('chatBox');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + (scope === 'mafia' ? 'mafia' : scope === 'dead' ? 'dead' : scope === 'system' ? 'system' : '');
  if (scope === 'system') {
    div.innerHTML = `<span class="sys-text">🗳 ${escapeHtml(text)}</span>`;
  } else {
    div.innerHTML = `<span class="name">${escapeHtml(name)}${scope === 'mafia' ? ' (mafia)' : scope === 'dead' ? ' (o\'lik)' : ''}:</span> ${escapeHtml(text)}`;
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- STATE RENDER ----------
socket.on('connect', () => { myId = socket.id; });

let rosterShownForRound = 0;
let currentFact = '';

socket.on('state', (state) => {
  currentState = state;

  if (state.phase === 'lobby') {
    show('screen-lobby');
    el('lobbyRoomId').textContent = state.roomId;
    renderLobbyPlayers(state);
  } else if (state.phase === 'ended') {
    // gameOver event handles this screen
  } else {
    if (state.round === 1 && rosterShownForRound !== 1 && document.getElementById('screen-roster').classList.contains('active') === false && document.getElementById('screen-game').classList.contains('active') === false) {
      rosterShownForRound = 1;
      showRosterThenGame(state);
    } else {
      show('screen-game');
      renderGame(state);
    }
  }
});

function showRosterThenGame(state) {
  show('screen-roster');
  el('rosterList').innerHTML = state.players.map(p =>
    `<div class="player-chip ${p.isBot ? 'bot' : ''}">${escapeHtml(p.name)}</div>`
  ).join('');
  setTimeout(() => {
    show('screen-game');
    renderGame(state);
  }, 4000);
}

function renderLobbyPlayers(state) {
  el('lobbyPlayers').innerHTML = state.players.map(p =>
    `<div class="player-chip ${p.isBot ? 'bot' : ''}">${escapeHtml(p.name)}</div>`
  ).join('');
  const n = state.players.length;
  el('lobbyStatus').textContent = n < 4 ? `Kamida 4 kishi kerak (${n}/10)` : `${n}/10 kishi tayyor`;
  el('btnStart').style.display = state.isHost && n >= 4 ? 'block' : 'none';
  el('botControls').style.display = state.isHost && n < 10 ? 'flex' : (state.isHost ? 'flex' : 'none');
}

const PHASE_LABELS = {
  night: '🌙 Tun', day: '☀️ Kun', voting: '🗳 Ovoz berish', result: '📢 Natija',
};

function renderGame(state) {
  if (state.phase !== lastPhase) {
    hasVotedThisRound = false;
    selectedTarget = null;
    lastPhase = state.phase;
  }
  el('phaseLabel').textContent = PHASE_LABELS[state.phase] || state.phase;
  el('phaseLabel').className = 'phase-badge phase-' + state.phase;
  el('timerLabel').textContent = state.timeLeft > 0 ? `${state.timeLeft}s` : '';
  el('timerLabel').classList.toggle('low', state.timeLeft > 0 && state.timeLeft <= 10);

  const role = ROLE_INFO[state.myRole];
  const roleCard = el('roleCard');
  roleCard.className = 'role-card' + (state.myRole ? ' role-' + state.myRole : '');
  document.body.className = state.myRole ? 'bg-' + state.myRole : '';
  if (role) {
    let extra = '';
    if (state.myRole === 'mafia' && state.mafiaTeam) {
      extra = `<div class="role-desc">Sherikaringiz: ${state.mafiaTeam.map(p => escapeHtml(p.name)).join(', ')}</div>`;
    }
    roleCard.innerHTML =
      `<div class="role-icon-circle role-icon-${role.icon}">${ROLE_ICONS[role.icon]}</div>` +
      `<div class="role-name">${role.name}</div><div class="role-desc">${role.desc}</div>${extra}` +
      (!state.myAlive ? '<div class="role-desc" style="color:#ff5f5f">💀 Siz o\'ldingiz — endi kuzatuvchisiz</div>' : '');
  }

  // Tunda oddiy o'yinchilar uchun chat o'rniga fakt ko'rsatiladi
  const isMafiaAtNight = state.phase === 'night' && state.myRole === 'mafia';
  const showNightFact = state.phase === 'night' && !isMafiaAtNight;
  el('nightFact').style.display = showNightFact ? 'block' : 'none';
  el('chatWrap').style.display = showNightFact ? 'none' : 'block';
  if (showNightFact) {
    if (!currentFact || state._factRound !== state.round) {
      currentFact = NIGHT_FACTS[Math.floor(Math.random() * NIGHT_FACTS.length)];
      state._factRound = state.round;
    }
    el('nightFact').innerHTML = `<div class="fact-label">🌙 Tun davom etmoqda...</div>${escapeHtml(currentFact)}`;
  }

  renderTargetArea(state);
}

function renderTargetArea(state) {
  const area = el('targetArea');
  area.innerHTML = '';
  if (!state.myAlive) return;

  let label = null, onPick = null;
  let lockAfterPick = false;

  if (state.phase === 'night') {
    if (state.myRole === 'mafia') { label = "Kimni yo'q qilamiz?"; onPick = (id) => socket.emit('mafiaTarget', { targetId: id }); }
    else if (state.myRole === 'doctor') { label = 'Kimni himoya qilamiz?'; onPick = (id) => socket.emit('doctorSave', { targetId: id }); }
    else if (state.myRole === 'detective') { label = 'Kimni tekshiramiz?'; onPick = (id) => socket.emit('detectiveCheck', { targetId: id }); }
    else return; // civilian kechasi hech narsa qilmaydi
  } else if (state.phase === 'voting') {
    label = 'Kimga ovoz berasiz?';
    onPick = (id) => socket.emit('castVote', { targetId: id });
    lockAfterPick = true;
    if (hasVotedThisRound) {
      area.innerHTML = `<div class="action-label">${label}</div><p class="hint">✅ Ovozingiz qabul qilindi, kutib turing...</p>`;
      return;
    }
  } else {
    return;
  }

  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="action-label">${label}</div>`;
  const grid = document.createElement('div');
  grid.className = 'player-grid';

  state.players.forEach(p => {
    if (p.id === myId && state.phase !== 'voting') return; // o'ziga tanlamaydi
    const chip = document.createElement('div');
    chip.className = 'player-chip' + (!p.alive ? ' dead' : '') + (p.isBot ? ' bot' : '') + (selectedTarget === p.id ? ' selected' : '');
    chip.textContent = p.name;
    if (p.alive) {
      chip.onclick = () => {
        selectedTarget = p.id;
        onPick(p.id);
        if (lockAfterPick) hasVotedThisRound = true;
        renderTargetArea(state);
      };
    }
    grid.appendChild(chip);
  });

  wrap.appendChild(grid);
  area.appendChild(wrap);
}

// ---------- NIGHT / VOTING RESULTS ----------
socket.on('nightResult', ({ killedName }) => {
  pushLog(killedName ? `☠️ ${killedName} tunda o'ldirildi` : '🌙 Bu kecha hech kim o\'lmadi');
});

socket.on('detectiveResult', ({ targetName, isMafia }) => {
  pushLog(`🕵️ Tekshiruv: ${targetName} — ${isMafia ? 'MAFIA!' : 'tinch aholi'}`);
});

socket.on('votingResult', ({ eliminatedName, eliminatedRole }) => {
  pushLog(eliminatedName
    ? `🗳 ${eliminatedName} chiqarib yuborildi (rol: ${ROLE_INFO[eliminatedRole]?.name || eliminatedRole})`
    : '🗳 Ovozlar taqsimlandi, hech kim chiqarilmadi');
});

function pushLog(text) {
  const log = el('gameLog');
  const div = document.createElement('div');
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  selectedTarget = null;
}

// ---------- GAME OVER ----------
socket.on('gameOver', ({ winner, players }) => {
  show('screen-over');
  el('overTitle').textContent = winner === 'mafia' ? '🔪 Mafia yutdi!' : '👤 Tinch aholi yutdi!';
  el('overList').innerHTML = players.map(p =>
    `<div class="player-chip ${p.alive ? '' : 'dead'}">${escapeHtml(p.name)} — ${ROLE_INFO[p.role]?.name || p.role}</div>`
  ).join('');
});

el('btnRestart').onclick = () => location.reload();
