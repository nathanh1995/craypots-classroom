const path = require("path");
const express = require("express");
const http = require("http");
const { randomUUID } = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_POTS_PER_BOAT = 10;
const STARTING_BOATS = 1;
const STARTING_POTS = 5;
const BOAT_COST = 100;
const BOAT_SELL_VALUE = 50;
const POT_COST = 5;
const SESSION_CODE_LENGTH = 6;
const AUTO_LOCK_SECONDS = 60;
const TEACHER_CODE_LENGTH = 6;

const weatherLabels = {
  good: "Good",
  bad: "Bad"
};

const state = {
  sessionCode: null,
  teacherAccessCode: null,
  gameStarted: false,
  round: 1,
  phase: "planning",
  choicesLocked: false,
  lockDeadlineMs: null,
  weather: "good",
  previousWeather: "good",
  lastRoll: null,
  teacherId: null,
  players: {},
  socketToPlayer: {},
  history: []
};
let autoLockTimer = null;

function createId() {
  return randomUUID().slice(0, 12);
}

function createSessionCode() {
  const min = 10 ** (SESSION_CODE_LENGTH - 1);
  const max = 10 ** SESSION_CODE_LENGTH - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

function getResolvedWeather(roll) {
  if ([1, 2, 3].includes(roll)) {
    return "good";
  }
  if ([5, 6].includes(roll)) {
    return "bad";
  }
  return state.previousWeather;
}

function rollUniversalDice() {
  return Math.floor(Math.random() * 6) + 1;
}

function addHistoryEntry(message) {
  state.history.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    message
  });
}

function getPlayerList() {
  return Object.values(state.players)
    .sort((a, b) => {
      if (b.cash !== a.cash) {
        return b.cash - a.cash;
      }
      if (b.boats !== a.boats) {
        return b.boats - a.boats;
      }
      return a.name.localeCompare(b.name);
    })
    .map((player, index) => ({
      id: player.id,
      rank: index + 1,
      name: player.name,
      emoji: player.emoji,
      boats: player.boats,
      pots: player.pots,
      cash: player.cash,
      status: player.status,
      connected: player.connected,
      lockedInRound: player.lockedInRound,
      lastPlacement: player.lastPlacement,
      lastRoundResult: player.lastRoundResult,
      needsSettlement: Boolean(player.pendingRoundSettlement),
      totalEarned: player.totalEarned,
      totalPotsLost: player.totalPotsLost
    }));
}

function snapshot() {
  const lockSecondsRemaining =
    state.lockDeadlineMs && !state.choicesLocked && state.phase === "planning"
      ? Math.max(0, Math.ceil((state.lockDeadlineMs - Date.now()) / 1000))
      : null;

  return {
    sessionCode: state.sessionCode,
    gameStarted: state.gameStarted,
    teacherClaimed: Boolean(state.teacherId),
    round: state.round,
    phase: state.phase,
    choicesLocked: state.choicesLocked,
    lockDeadlineMs: state.lockDeadlineMs,
    lockSecondsRemaining,
    weather: state.weather,
    previousWeather: state.previousWeather,
    lastRoll: state.lastRoll,
    weatherLabel: weatherLabels[state.weather],
    players: getPlayerList(),
    history: state.history.slice(-12)
  };
}

function broadcastState() {
  io.emit("state:update", snapshot());
}

function ensureTeacher(socketId) {
  if (socketId !== state.teacherId) {
    throw new Error("Teacher controls are only available to the host.");
  }
}

function ensureGameStarted() {
  if (!state.gameStarted) {
    throw new Error("Game has not started yet.");
  }
}

function getPlayerBySocket(socketId) {
  const playerId = state.socketToPlayer[socketId];
  if (!playerId) {
    return null;
  }
  return state.players[playerId] || null;
}

function ensurePlayer(socketId) {
  const player = getPlayerBySocket(socketId);
  if (!player) {
    throw new Error("Player not found.");
  }
  if (player.status === "bankrupt") {
    throw new Error("This player is bankrupt and cannot take actions.");
  }
  return player;
}

function ensurePlanningOpen(player) {
  ensureGameStarted();
  if (state.phase !== "planning") {
    throw new Error("Round is not in planning phase.");
  }
  if (state.choicesLocked) {
    throw new Error("Choices are locked for this round.");
  }
  if (player.lockedInRound) {
    throw new Error("You already locked your choices this round.");
  }
}

function validateName(name) {
  const normalized = String(name || "").trim().slice(0, 24);
  if (!normalized) {
    throw new Error("Enter a player name.");
  }
  return normalized;
}

function validatePin(pin) {
  const normalized = String(pin || "").trim();
  if (!/^\d{4}$/.test(normalized)) {
    throw new Error("PIN must be exactly 4 digits.");
  }
  return normalized;
}

function validateSessionCode(code) {
  const normalized = String(code || "")
    .trim()
    .toUpperCase();
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error("Session code must be exactly 6 digits.");
  }
  return normalized;
}

function validateEmoji(emoji) {
  const normalized = String(emoji || "").trim();
  if (!normalized || normalized.length > 8) {
    throw new Error("Choose one emoji.");
  }
  return normalized;
}

function validateTeacherAccessCode(code) {
  const normalized = String(code || "").trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error(`Teacher access code must be exactly ${TEACHER_CODE_LENGTH} digits.`);
  }
  return normalized;
}

function clearAutoLockTimer() {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

function scheduleAutoLock() {
  clearAutoLockTimer();
  state.lockDeadlineMs = Date.now() + AUTO_LOCK_SECONDS * 1000;
  autoLockTimer = setTimeout(() => {
    autoLockTimer = null;
    if (state.phase === "planning" && !state.choicesLocked) {
      lockChoices(`Auto-lock applied after ${AUTO_LOCK_SECONDS} second countdown.`);
      broadcastState();
    }
  }, AUTO_LOCK_SECONDS * 1000);
}

function assignPlayerSocket(player, socket) {
  if (player.socketId && state.socketToPlayer[player.socketId]) {
    delete state.socketToPlayer[player.socketId];
  }
  player.socketId = socket.id;
  player.connected = true;
  state.socketToPlayer[socket.id] = player.id;
}

function buildPlayer(name, pin, emoji) {
  return {
    id: createId(),
    token: createId(),
    name,
    emoji,
    pin,
    socketId: null,
    connected: false,
    boats: STARTING_BOATS,
    pots: STARTING_POTS,
    cash: 0,
    status: "active",
    lockedInRound: false,
    lastPlacement: {
      inside: 0,
      outside: 0
    },
    lastRoundResult: null,
    pendingRoundSettlement: null,
    totalEarned: 0,
    totalPotsLost: 0
  };
}

function joinPlayer(socket, payload) {
  if (!state.sessionCode) {
    throw new Error("No active session. Ask your teacher to create a game.");
  }

  const name = validateName(payload?.name);
  const pin = validatePin(payload?.pin);
  const sessionCode = validateSessionCode(payload?.sessionCode);
  const emoji = validateEmoji(payload?.emoji);
  const token = String(payload?.token || "").trim();

  if (sessionCode !== state.sessionCode) {
    throw new Error("Session code is incorrect.");
  }

  let player = null;
  let reconnected = false;

  if (token) {
    player = Object.values(state.players).find((item) => item.token === token) || null;
    if (player) {
      if (player.pin !== pin) {
        throw new Error("PIN does not match this saved player.");
      }
      if (player.name.toLowerCase() !== name.toLowerCase()) {
        throw new Error("Name does not match this saved player.");
      }
      reconnected = true;
    }
  }

  if (!player) {
    player =
      Object.values(state.players).find(
        (item) => item.name.toLowerCase() === name.toLowerCase() && item.pin === pin
      ) || null;
    if (player) {
      reconnected = true;
    }
  }

  if (!player) {
    const nameTaken = Object.values(state.players).some(
      (item) => item.name.toLowerCase() === name.toLowerCase() && item.pin !== pin
    );
    if (nameTaken) {
      throw new Error("That name is already in use with a different PIN.");
    }

    player = buildPlayer(name, pin, emoji);
    state.players[player.id] = player;
    addHistoryEntry(`${player.emoji} ${player.name} joined the class game.`);
  } else if (!player.connected) {
    addHistoryEntry(`${player.name} reconnected.`);
  }

  player.emoji = emoji;

  assignPlayerSocket(player, socket);

  return {
    playerId: player.id,
    token: player.token,
    reconnected
  };
}

function handlePlacement(player, payload) {
  ensurePlanningOpen(player);

  const inside = Number(payload?.inside ?? 0);
  const outside = Number(payload?.outside ?? 0);

  if (!Number.isInteger(inside) || !Number.isInteger(outside) || inside < 0 || outside < 0) {
    throw new Error("Inside and outside pots must be whole numbers.");
  }

  const totalPlaced = inside + outside;
  const capacity = player.boats * MAX_POTS_PER_BOAT;

  if (totalPlaced > player.pots) {
    throw new Error("You cannot place more pots than you own.");
  }

  if (totalPlaced > capacity) {
    throw new Error(`Your boats can carry at most ${capacity} pots this round.`);
  }

  player.lastPlacement = { inside, outside };
}

function handleBuy(player, payload) {
  ensurePlanningOpen(player);

  const boats = Number(payload?.boats ?? 0);
  const pots = Number(payload?.pots ?? 0);
  const claimedTotal = Number(payload?.claimedTotal);

  if (
    !Number.isInteger(boats) ||
    !Number.isInteger(pots) ||
    !Number.isInteger(claimedTotal) ||
    boats < 0 ||
    pots < 0 ||
    claimedTotal < 0
  ) {
    throw new Error("Purchases must be whole numbers.");
  }

  const totalCost = boats * BOAT_COST + pots * POT_COST;
  if (claimedTotal !== totalCost) {
    throw new Error(`Incorrect total. Buying ${boats} boat(s) and ${pots} pot(s) costs $${totalCost}.`);
  }
  if (totalCost > player.cash) {
    throw new Error("Not enough money for that purchase.");
  }

  player.cash -= totalCost;
  player.boats += boats;
  player.pots += pots;

  if (boats > 0 || pots > 0) {
    addHistoryEntry(`${player.name} bought ${boats} boat(s) and ${pots} pot(s) for $${totalCost}.`);
  }
}

function handleSell(player, payload) {
  ensurePlanningOpen(player);

  const boatsToSell = Number(payload?.boats ?? 0);
  const potsToSell = Number(payload?.pots ?? 0);
  const claimedTotal = Number(payload?.claimedTotal);

  if (
    !Number.isInteger(boatsToSell) ||
    !Number.isInteger(potsToSell) ||
    !Number.isInteger(claimedTotal) ||
    boatsToSell < 0 ||
    potsToSell < 0 ||
    claimedTotal < 0
  ) {
    throw new Error("Sales must be whole numbers.");
  }

  if (boatsToSell > player.boats) {
    throw new Error("You cannot sell more boats than you own.");
  }

  if (potsToSell > player.pots) {
    throw new Error("You cannot sell more pots than you own.");
  }

  const capacityAfterSale = (player.boats - boatsToSell) * MAX_POTS_PER_BOAT;
  if (player.pots - potsToSell > capacityAfterSale) {
    throw new Error("Sell pots first or keep enough boats to hold your pots.");
  }

  const totalValue = boatsToSell * BOAT_SELL_VALUE + potsToSell * POT_COST;
  if (claimedTotal !== totalValue) {
    throw new Error(
      `Incorrect total. Selling ${boatsToSell} boat(s) and ${potsToSell} pot(s) returns $${totalValue}.`
    );
  }

  if (boatsToSell === 0 && potsToSell === 0) {
    return;
  }

  player.boats -= boatsToSell;
  player.pots -= potsToSell;
  player.cash += totalValue;
  addHistoryEntry(`${player.name} sold ${boatsToSell} boat(s) and ${potsToSell} pot(s) for $${totalValue}.`);
}

function lockPlayerChoices(player) {
  ensurePlanningOpen(player);
  player.lockedInRound = true;
  addHistoryEntry(`${player.name} locked in choices for round ${state.round}.`);
}

function allActivePlayersLocked() {
  const activePlayers = Object.values(state.players).filter((player) => player.status !== "bankrupt");
  if (!activePlayers.length) {
    return false;
  }
  return activePlayers.every((player) => player.lockedInRound);
}

function rollWeather() {
  ensureGameStarted();
  if (state.phase !== "planning") {
    throw new Error("You can only roll weather during planning.");
  }
  if (state.choicesLocked) {
    throw new Error("Choices are already locked.");
  }
  if (Number.isInteger(state.lastRoll)) {
    throw new Error("Dice has already been rolled this round.");
  }

  const roll = rollUniversalDice();
  state.weather = getResolvedWeather(roll);
  state.previousWeather = state.weather;
  state.lastRoll = roll;
  scheduleAutoLock();
  addHistoryEntry(`Universal dice rolled ${roll}. Weather is ${weatherLabels[state.weather].toLowerCase()}.`);
}

function lockChoices(reasonMessage = `Teacher locked choices for round ${state.round}.`) {
  ensureGameStarted();
  if (state.phase !== "planning") {
    throw new Error("Round is not in planning phase.");
  }
  if (state.choicesLocked) {
    throw new Error("Choices are already locked.");
  }

  clearAutoLockTimer();
  state.lockDeadlineMs = null;
  state.choicesLocked = true;
  for (const player of Object.values(state.players)) {
    if (player.status !== "bankrupt") {
      player.lockedInRound = true;
    }
  }
  addHistoryEntry(reasonMessage);
}

function resolveRound() {
  ensureGameStarted();
  if (state.phase !== "planning") {
    throw new Error("Round has already been resolved.");
  }
  if (!state.choicesLocked) {
    throw new Error("Lock choices before resolving the round.");
  }
  if (!Number.isInteger(state.lastRoll)) {
    throw new Error("Roll the universal dice before resolving.");
  }

  const weather = state.weather;

  for (const player of Object.values(state.players)) {
    if (player.status === "bankrupt") {
      continue;
    }

    const { inside, outside } = player.lastPlacement;
    let earned = 0;
    let lostPots = 0;

    if (weather === "good") {
      earned = inside * 2 + outside * 8;
    } else {
      earned = inside * 4;
      lostPots = outside;
      player.pots = Math.max(0, player.pots - lostPots);
      player.totalPotsLost += lostPots;
    }

    player.pendingRoundSettlement = {
      round: state.round,
      weather,
      earned,
      lostPots
    };
    player.lastRoundResult = null;
  }

  state.phase = "resolved";
  addHistoryEntry(
    `Round ${state.round} resolved in ${weatherLabels[weather].toLowerCase()} weather. Students must claim earnings.`
  );
}

function startNewRound() {
  ensureGameStarted();
  if (state.phase !== "resolved") {
    throw new Error("Resolve the current round before starting a new one.");
  }
  const unsettledPlayers = Object.values(state.players).filter(
    (player) => player.status !== "bankrupt" && player.pendingRoundSettlement
  );
  if (unsettledPlayers.length) {
    throw new Error("All active students must claim their earnings first.");
  }

  state.round += 1;
  state.phase = "planning";
  state.choicesLocked = false;
  state.lastRoll = null;
  state.lockDeadlineMs = null;
  clearAutoLockTimer();

  for (const player of Object.values(state.players)) {
    if (player.status === "bankrupt") {
      continue;
    }
    player.lastPlacement = { inside: 0, outside: 0 };
    player.lockedInRound = false;
  }

  addHistoryEntry(`Round ${state.round} started. Students can set choices now.`);
}

function claimRoundSettlement(player, payload) {
  ensureGameStarted();
  if (state.phase !== "resolved") {
    throw new Error("You can claim earnings only after round resolution.");
  }

  const pending = player.pendingRoundSettlement;
  if (!pending) {
    throw new Error("No pending earnings to claim.");
  }

  const amount = Number(payload?.amount);
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error("Earnings must be a whole dollar amount.");
  }
  if (amount !== pending.earned) {
    throw new Error(`Incorrect amount. Your earnings for round ${pending.round} are $${pending.earned}.`);
  }

  player.cash += amount;
  player.totalEarned += amount;
  player.lastRoundResult = {
    round: pending.round,
    weather: pending.weather,
    earned: pending.earned,
    lostPots: pending.lostPots
  };
  player.pendingRoundSettlement = null;

  if (player.cash < 0 || (player.pots === 0 && player.cash < POT_COST && player.boats === 0)) {
    player.status = "bankrupt";
    addHistoryEntry(`${player.name} is bankrupt and out of the game.`);
  }

  addHistoryEntry(`${player.name} correctly claimed $${amount} for round ${player.lastRoundResult.round}.`);
}

function resetGame() {
  clearAutoLockTimer();
  state.round = 1;
  state.phase = "planning";
  state.choicesLocked = false;
  state.lockDeadlineMs = null;
  state.weather = "good";
  state.previousWeather = "good";
  state.lastRoll = null;
  state.history = [];

  for (const player of Object.values(state.players)) {
    player.boats = STARTING_BOATS;
    player.pots = STARTING_POTS;
    player.cash = 0;
    player.status = "active";
    player.lockedInRound = false;
    player.lastPlacement = { inside: 0, outside: 0 };
    player.lastRoundResult = null;
    player.pendingRoundSettlement = null;
    player.totalEarned = 0;
    player.totalPotsLost = 0;
  }

  addHistoryEntry("Game reset to starting values.");
}

function createGameSession() {
  clearAutoLockTimer();
  state.sessionCode = createSessionCode();
  state.gameStarted = false;
  state.round = 1;
  state.phase = "planning";
  state.choicesLocked = false;
  state.lockDeadlineMs = null;
  state.weather = "good";
  state.previousWeather = "good";
  state.lastRoll = null;
  state.players = {};
  state.socketToPlayer = {};
  state.history = [];
  addHistoryEntry(`New game session created. Code: ${state.sessionCode}`);
}

function startGameSession() {
  if (!state.sessionCode) {
    throw new Error("Create a game session first.");
  }
  if (state.gameStarted) {
    throw new Error("Game is already started.");
  }
  state.gameStarted = true;
  addHistoryEntry(`Game started for session ${state.sessionCode}.`);
}

function claimTeacher(socket, payload) {
  const accessCodeRaw = String(payload?.accessCode || "").trim();
  const newAccessCodeRaw = String(payload?.newAccessCode || "").trim();

  if (!state.teacherAccessCode) {
    if (state.teacherId && state.teacherId !== socket.id) {
      throw new Error("Teacher controls are already claimed on another device.");
    }

    let chosenCode = null;
    if (/^\d{6}$/.test(newAccessCodeRaw)) {
      chosenCode = newAccessCodeRaw;
    } else if (/^\d{6}$/.test(accessCodeRaw)) {
      chosenCode = accessCodeRaw;
    } else {
      chosenCode = createSessionCode();
    }

    state.teacherAccessCode = chosenCode;
    state.teacherId = socket.id;
    return { bootstrap: true, teacherAccessCode: chosenCode };
  }

  const accessCode = validateTeacherAccessCode(accessCodeRaw);
  if (accessCode !== state.teacherAccessCode) {
    throw new Error("Teacher access code is incorrect.");
  }
  if (state.teacherId && state.teacherId !== socket.id) {
    throw new Error("Teacher controls are already claimed on another device.");
  }
  state.teacherId = socket.id;
  return { bootstrap: false, teacherAccessCode: state.teacherAccessCode };
}

function kickPlayerById(playerId) {
  const player = state.players[playerId];
  if (!player) {
    throw new Error("Player not found.");
  }

  if (player.socketId) {
    const playerSocket = io.sockets.sockets.get(player.socketId);
    if (playerSocket) {
      playerSocket.disconnect(true);
    }
    delete state.socketToPlayer[player.socketId];
  }

  delete state.players[playerId];
  addHistoryEntry(`${player.name} was removed by teacher.`);
}

io.on("connection", (socket) => {
  socket.emit("state:update", snapshot());

  socket.on("player:join", (payload, callback) => {
    try {
      const joinInfo = joinPlayer(socket, payload);
      callback?.({ ok: true, ...joinInfo });
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("teacher:claim", (payload, callback) => {
    try {
      const claimInfo = claimTeacher(socket, payload);
      callback?.({ ok: true, ...claimInfo });
      addHistoryEntry("Teacher controls claimed.");
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("teacher:createGame", (_, callback) => {
    try {
      ensureTeacher(socket.id);
      createGameSession();
      callback?.({
        ok: true,
        sessionCode: state.sessionCode,
        teacherAccessCode: state.teacherAccessCode
      });
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("teacher:startGame", (_, callback) => {
    try {
      ensureTeacher(socket.id);
      startGameSession();
      callback?.({ ok: true });
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("player:place", (payload, callback) => {
    try {
      const player = ensurePlayer(socket.id);
      handlePlacement(player, payload);
      callback?.({ ok: true });
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("player:buy", (payload, callback) => {
    try {
      const player = ensurePlayer(socket.id);
      handleBuy(player, payload);
      callback?.({ ok: true });
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("player:sell", (payload, callback) => {
    try {
      const player = ensurePlayer(socket.id);
      handleSell(player, payload);
      callback?.({ ok: true });
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("player:lockIn", (_, callback) => {
    try {
      const player = ensurePlayer(socket.id);
      lockPlayerChoices(player);
      const everyoneLocked = allActivePlayersLocked();
      callback?.({ ok: true, everyoneLocked });
      if (everyoneLocked) {
        addHistoryEntry("All active students are locked in.");
      }
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("player:claimSettlement", (payload, callback) => {
    try {
      const player = ensurePlayer(socket.id);
      claimRoundSettlement(player, payload);
      callback?.({ ok: true });
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("teacher:rollWeather", (_, callback) => {
    try {
      ensureTeacher(socket.id);
      rollWeather();
      callback?.({ ok: true, weather: state.weather, lastRoll: state.lastRoll });
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("teacher:lockChoices", (_, callback) => {
    try {
      ensureTeacher(socket.id);
      lockChoices();
      callback?.({ ok: true });
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("teacher:resolveRound", (_, callback) => {
    try {
      ensureTeacher(socket.id);
      resolveRound();
      callback?.({ ok: true });
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("teacher:startRound", (_, callback) => {
    try {
      ensureTeacher(socket.id);
      startNewRound();
      callback?.({ ok: true });
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("teacher:reset", (_, callback) => {
    try {
      ensureTeacher(socket.id);
      resetGame();
      callback?.({ ok: true });
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("teacher:kickPlayer", (payload, callback) => {
    try {
      ensureTeacher(socket.id);
      kickPlayerById(String(payload?.playerId || ""));
      callback?.({ ok: true });
      broadcastState();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on("disconnect", () => {
    const player = getPlayerBySocket(socket.id);
    if (player) {
      player.connected = false;
      player.socketId = null;
      delete state.socketToPlayer[socket.id];
      addHistoryEntry(`${player.name} disconnected.`);
    }

    if (state.teacherId === socket.id) {
      state.teacherId = null;
      addHistoryEntry("Teacher controls are now unclaimed.");
    }

    broadcastState();
  });
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/assets", express.static(path.join(__dirname, "assets")));

server.listen(PORT, () => {
  console.log(`Craypots classroom server running on http://localhost:${PORT}`);
  if (state.teacherAccessCode) {
    console.log(`Teacher access code: ${state.teacherAccessCode}`);
  } else {
    console.log("Teacher access code will be set by first teacher claim.");
  }
});
