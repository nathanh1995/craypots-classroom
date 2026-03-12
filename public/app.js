const socket = io();

const STORAGE_NAME_KEY = "craypots_player_name";
const STORAGE_PIN_KEY = "craypots_player_pin";
const STORAGE_TOKEN_KEY = "craypots_player_token";
const STORAGE_SESSION_CODE_KEY = "craypots_session_code";
const STORAGE_EMOJI_KEY = "craypots_player_emoji";
const STORAGE_TEACHER_CODE_KEY = "craypots_teacher_access_code";
const DICE_FACE_MAP = {
  1: "⚀",
  2: "⚁",
  3: "⚂",
  4: "⚃",
  5: "⚄",
  6: "⚅"
};

const elements = {
  claimTeacherButton: document.getElementById("claimTeacherButton"),
  teacherAccessCode: document.getElementById("teacherAccessCode"),
  sessionCode: document.getElementById("sessionCode"),
  joinButton: document.getElementById("joinButton"),
  clearSavedButton: document.getElementById("clearSavedButton"),
  playerName: document.getElementById("playerName"),
  playerPin: document.getElementById("playerPin"),
  playerEmoji: document.getElementById("playerEmoji"),
  statusMessage: document.getElementById("statusMessage"),
  teacherPanel: document.getElementById("teacherPanel"),
  sessionCodeValue: document.getElementById("sessionCodeValue"),
  createGameButton: document.getElementById("createGameButton"),
  startGameButton: document.getElementById("startGameButton"),
  playerPanel: document.getElementById("playerPanel"),
  roundNumber: document.getElementById("roundNumber"),
  teacherWeather: document.getElementById("teacherWeather"),
  teacherDice: document.getElementById("teacherDice"),
  autoLockCountdown: document.getElementById("autoLockCountdown"),
  weatherLabel: document.getElementById("weatherLabel"),
  phaseBadge: document.getElementById("phaseBadge"),
  nextActionText: document.getElementById("nextActionText"),
  rollWeatherButton: document.getElementById("rollWeatherButton"),
  lockChoicesButton: document.getElementById("lockChoicesButton"),
  startRoundButton: document.getElementById("startRoundButton"),
  lastRollValue: document.getElementById("lastRollValue"),
  resolveRoundButton: document.getElementById("resolveRoundButton"),
  resetButton: document.getElementById("resetButton"),
  playerIdentity: document.getElementById("playerIdentity"),
  playerCountdownAlert: document.getElementById("playerCountdownAlert"),
  playerStats: document.getElementById("playerStats"),
  insideInput: document.getElementById("insideInput"),
  outsideInput: document.getElementById("outsideInput"),
  placeButton: document.getElementById("placeButton"),
  lockInButton: document.getElementById("lockInButton"),
  buyBoatsInput: document.getElementById("buyBoatsInput"),
  buyPotsInput: document.getElementById("buyPotsInput"),
  buyTotalInput: document.getElementById("buyTotalInput"),
  buyButton: document.getElementById("buyButton"),
  sellBoatsInput: document.getElementById("sellBoatsInput"),
  sellPotsInput: document.getElementById("sellPotsInput"),
  sellTotalInput: document.getElementById("sellTotalInput"),
  sellButton: document.getElementById("sellButton"),
  claimAmountInput: document.getElementById("claimAmountInput"),
  claimSettlementButton: document.getElementById("claimSettlementButton"),
  leaderboardBody: document.getElementById("leaderboardBody"),
  historyList: document.getElementById("historyList")
};

const viewState = {
  playerId: null,
  playerToken: null,
  teacher: false,
  snapshot: null,
  lastRoll: null,
  diceTimer: null,
  countdownTimer: null
};

function setStatus(message, isError = false) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.style.color = isError ? "#bc4749" : "#2f6690";
}

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => {
      resolve(response || { ok: false, error: "No response from server." });
    });
  });
}

function saveLogin(name, pin, token, sessionCode, emoji) {
  localStorage.setItem(STORAGE_NAME_KEY, name);
  localStorage.setItem(STORAGE_PIN_KEY, pin);
  localStorage.setItem(STORAGE_TOKEN_KEY, token);
  localStorage.setItem(STORAGE_SESSION_CODE_KEY, sessionCode);
  localStorage.setItem(STORAGE_EMOJI_KEY, emoji);
}

function clearSavedLogin() {
  localStorage.removeItem(STORAGE_NAME_KEY);
  localStorage.removeItem(STORAGE_PIN_KEY);
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  localStorage.removeItem(STORAGE_SESSION_CODE_KEY);
  localStorage.removeItem(STORAGE_EMOJI_KEY);
}

function getAutoLockSeconds(snapshot) {
  if (!snapshot || snapshot.phase !== "planning" || snapshot.choicesLocked || !snapshot.lockDeadlineMs) {
    return null;
  }
  const remaining = Math.ceil((snapshot.lockDeadlineMs - Date.now()) / 1000);
  return Math.max(0, remaining);
}

function formatAutoLock(snapshot) {
  if (snapshot.phase !== "planning" || snapshot.choicesLocked) {
    return "Locked";
  }
  if (!Number.isInteger(snapshot.lastRoll)) {
    return "Starts after roll";
  }
  const seconds = getAutoLockSeconds(snapshot);
  if (seconds === null) {
    return "-";
  }
  return `${seconds}s`;
}

function updateCountdownUI() {
  const snapshot = viewState.snapshot;
  if (!snapshot) {
    return;
  }

  elements.autoLockCountdown.textContent = formatAutoLock(snapshot);
  const me = snapshot.players.find((player) => player.id === viewState.playerId);
  if (!me) {
    return;
  }

  if (snapshot.phase === "planning" && !snapshot.choicesLocked && Number.isInteger(snapshot.lastRoll)) {
    elements.playerCountdownAlert.textContent = `Locking automatically in ${formatAutoLock(snapshot)}.`;
  } else if (snapshot.choicesLocked) {
    elements.playerCountdownAlert.textContent = "Choices are locked.";
  } else {
    elements.playerCountdownAlert.textContent = "";
  }
}

function getDiceFace(roll) {
  return DICE_FACE_MAP[roll] || "?";
}

function renderDice(roll, animate) {
  if (!elements.teacherDice) {
    return;
  }

  if (!Number.isInteger(roll)) {
    if (viewState.diceTimer) {
      clearInterval(viewState.diceTimer);
      viewState.diceTimer = null;
    }
    elements.teacherDice.classList.remove("rolling");
    elements.teacherDice.textContent = "?";
    return;
  }

  if (!animate) {
    elements.teacherDice.classList.remove("rolling");
    elements.teacherDice.textContent = getDiceFace(roll);
    return;
  }

  if (viewState.diceTimer) {
    clearInterval(viewState.diceTimer);
    viewState.diceTimer = null;
  }

  elements.teacherDice.classList.add("rolling");
  let ticks = 0;
  viewState.diceTimer = setInterval(() => {
    const randomRoll = Math.floor(Math.random() * 6) + 1;
    elements.teacherDice.textContent = getDiceFace(randomRoll);
    ticks += 1;
    if (ticks >= 12) {
      clearInterval(viewState.diceTimer);
      viewState.diceTimer = null;
      elements.teacherDice.classList.remove("rolling");
      elements.teacherDice.textContent = getDiceFace(roll);
    }
  }, 80);
}

function getPhaseText(snapshot, me) {
  if (!snapshot.sessionCode) {
    return "Waiting for teacher to create a game session.";
  }
  if (!snapshot.gameStarted) {
    return "Session created. Waiting for teacher to start the game.";
  }
  if (snapshot.phase === "resolved") {
    return "Round resolved. Waiting for teacher to start next round.";
  }
  if (snapshot.choicesLocked) {
    return "Choices are locked for this round.";
  }
  if (me?.lockedInRound) {
    return "You are locked in for this round.";
  }
  return "Planning is open. Set choices, buy/sell, then lock in.";
}

function getNextActionText(snapshot, me) {
  if (!me) {
    return "";
  }
  if (!snapshot.gameStarted) {
    return "Check the session code and wait for the teacher to start.";
  }
  if (me.status === "bankrupt") {
    return "You are out of the game. Watch the leaderboard.";
  }
  if (snapshot.phase === "resolved") {
    if (me.needsSettlement) {
      return "Calculate your earnings and submit the exact amount to claim it.";
    }
    return "Round finished. Wait for others, then teacher starts the next round.";
  }
  if (snapshot.choicesLocked) {
    return "Teacher locked choices. Wait for round results.";
  }
  if (me.lockedInRound) {
    return "You are done for this round. Nice work.";
  }
  return "Do Step 1 if needed, then Step 2 to place pots, then Step 3 to lock in.";
}

function setPlayerInputsEnabled(enabled) {
  const nodes = [
    elements.insideInput,
    elements.outsideInput,
    elements.placeButton,
    elements.lockInButton,
    elements.buyBoatsInput,
    elements.buyPotsInput,
    elements.buyTotalInput,
    elements.buyButton,
    elements.sellBoatsInput,
    elements.sellPotsInput,
    elements.sellTotalInput,
    elements.sellButton
  ];
  for (const node of nodes) {
    node.disabled = !enabled;
  }
}

function setClaimInputsEnabled(enabled) {
  elements.claimAmountInput.disabled = !enabled;
  elements.claimSettlementButton.disabled = !enabled;
}

function renderStats(player) {
  if (!player) {
    elements.playerStats.innerHTML = "";
    return;
  }

  const lastResult = player.lastRoundResult
    ? `Round ${player.lastRoundResult.round}: +$${player.lastRoundResult.earned}${
        player.lastRoundResult.lostPots ? `, lost ${player.lastRoundResult.lostPots} pot(s)` : ""
      }`
    : player.needsSettlement
      ? "Pending: submit your round earnings."
      : "No round resolved yet.";

  elements.playerStats.innerHTML = `
    <article class="stat-card">
      <h3>Money</h3>
      <p>$${player.cash}</p>
    </article>
    <article class="stat-card">
      <h3>Boats</h3>
      <p>${player.boats}</p>
    </article>
    <article class="stat-card">
      <h3>Pots</h3>
      <p>${player.pots}</p>
    </article>
    <article class="stat-card">
      <h3>Status</h3>
      <p>${player.status === "bankrupt" ? "Out of game" : "Active"}</p>
    </article>
    <article class="stat-card">
      <h3>Last result</h3>
      <p>${lastResult}</p>
    </article>
  `;
}

function renderLeaderboard(players) {
  if (!players.length) {
    elements.leaderboardBody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-state">No students have joined yet.</td>
      </tr>
    `;
    return;
  }

  elements.leaderboardBody.innerHTML = players
    .map((player) => {
      const placement = `${player.lastPlacement.inside} in / ${player.lastPlacement.outside} out`;
      const result = player.lastRoundResult
        ? `+$${player.lastRoundResult.earned}${
            player.lastRoundResult.lostPots ? `, -${player.lastRoundResult.lostPots} pots` : ""
          }`
        : player.needsSettlement
          ? "Needs earnings claim"
          : "Waiting";
      const status = player.status === "bankrupt" ? " (out)" : "";

      return `
        <tr>
          <td>${player.rank}</td>
          <td>${player.emoji} ${player.name}${status}</td>
          <td>$${player.cash}</td>
          <td>${player.boats}</td>
          <td>${player.pots}</td>
          <td>${player.connected ? "Yes" : "No"}</td>
          <td>${player.lockedInRound ? "Locked" : "Open"}</td>
          <td>${placement}</td>
          <td>${result}</td>
        </tr>
      `;
    })
    .join("");
}

function renderHistory(history) {
  if (!history.length) {
    elements.historyList.innerHTML = `<div class="history-entry">Session activity will appear here.</div>`;
    return;
  }

  elements.historyList.innerHTML = history
    .slice()
    .reverse()
    .map((entry) => `<div class="history-entry">${entry.message}</div>`)
    .join("");
}

function render(snapshot) {
  viewState.snapshot = snapshot;

  elements.sessionCodeValue.textContent = snapshot.sessionCode || "Not created";
  if (!elements.sessionCode.value && snapshot.sessionCode) {
    elements.sessionCode.value = snapshot.sessionCode;
  }
  elements.roundNumber.textContent = snapshot.round;
  elements.teacherWeather.textContent = snapshot.weatherLabel;
  elements.weatherLabel.textContent = snapshot.weatherLabel;
  elements.lastRollValue.textContent = Number.isInteger(snapshot.lastRoll) ? String(snapshot.lastRoll) : "-";
  renderDice(snapshot.lastRoll, Number.isInteger(snapshot.lastRoll) && snapshot.lastRoll !== viewState.lastRoll);
  viewState.lastRoll = snapshot.lastRoll;

  const me = snapshot.players.find((player) => player.id === viewState.playerId);
  const playerEnabled =
    Boolean(me) &&
    me.status !== "bankrupt" &&
    snapshot.gameStarted &&
    snapshot.phase === "planning" &&
    !snapshot.choicesLocked &&
    !me.lockedInRound;
  const claimEnabled =
    Boolean(me) && me.status !== "bankrupt" && snapshot.gameStarted && snapshot.phase === "resolved" && me.needsSettlement;

  elements.playerPanel.classList.toggle("hidden", !me);
  elements.teacherPanel.classList.toggle("hidden", !viewState.teacher);
  setPlayerInputsEnabled(playerEnabled);
  setClaimInputsEnabled(claimEnabled);

  elements.rollWeatherButton.disabled =
    !viewState.teacher ||
    !snapshot.gameStarted ||
    snapshot.phase !== "planning" ||
    snapshot.choicesLocked ||
    Number.isInteger(snapshot.lastRoll);
  elements.lockChoicesButton.disabled =
    !viewState.teacher || !snapshot.gameStarted || snapshot.phase !== "planning" || snapshot.choicesLocked;
  elements.resolveRoundButton.disabled =
    !viewState.teacher || !snapshot.gameStarted || snapshot.phase !== "planning" || !snapshot.choicesLocked;
  elements.startRoundButton.disabled = !viewState.teacher || !snapshot.gameStarted || snapshot.phase !== "resolved";
  elements.createGameButton.disabled = !viewState.teacher;
  elements.startGameButton.disabled = !viewState.teacher || !snapshot.sessionCode || snapshot.gameStarted;

  if (me) {
    elements.playerIdentity.textContent = `${me.emoji} ${me.name}`;
    elements.phaseBadge.textContent = getPhaseText(snapshot, me);
    elements.nextActionText.textContent = getNextActionText(snapshot, me);
    renderStats(me);
  }

  updateCountdownUI();
  renderLeaderboard(snapshot.players);
  renderHistory(snapshot.history);
}

async function joinOrReconnect() {
  const name = elements.playerName.value.trim();
  const pin = elements.playerPin.value.trim();
  const sessionCode = elements.sessionCode.value.trim();
  const emoji = elements.playerEmoji.value.trim();
  const response = await emitWithAck("player:join", {
    name,
    pin,
    sessionCode,
    emoji,
    token: viewState.playerToken
  });

  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }

  viewState.playerId = response.playerId;
  viewState.playerToken = response.token;
  saveLogin(name, pin, response.token, sessionCode, emoji);
  setStatus(response.reconnected ? "Reconnected to your saved player." : "You joined the live class game.");
}

elements.joinButton.addEventListener("click", async () => {
  await joinOrReconnect();
});

elements.clearSavedButton.addEventListener("click", () => {
  clearSavedLogin();
  viewState.playerToken = null;
  viewState.playerId = null;
  setStatus("Saved login cleared on this device.");
});

elements.claimTeacherButton.addEventListener("click", async () => {
  const accessCode = elements.teacherAccessCode.value.trim();
  const response = await emitWithAck("teacher:claim", { accessCode, newAccessCode: accessCode });

  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }

  if (response.teacherAccessCode) {
    elements.teacherAccessCode.value = response.teacherAccessCode;
    localStorage.setItem(STORAGE_TEACHER_CODE_KEY, response.teacherAccessCode);
  }
  viewState.teacher = true;
  if (response.bootstrap) {
    setStatus(`Teacher controls active. Your teacher code is ${response.teacherAccessCode}.`);
  } else {
    setStatus("Teacher controls are active on this device.");
  }
  elements.teacherPanel.classList.remove("hidden");
});

elements.createGameButton.addEventListener("click", async () => {
  const response = await emitWithAck("teacher:createGame", {});
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  elements.sessionCode.value = response.sessionCode;
  elements.teacherAccessCode.value = response.teacherAccessCode;
  localStorage.setItem(STORAGE_TEACHER_CODE_KEY, response.teacherAccessCode);
  setStatus(`Session created. Session code: ${response.sessionCode}. Teacher code: ${response.teacherAccessCode}`);
});

elements.startGameButton.addEventListener("click", async () => {
  const response = await emitWithAck("teacher:startGame", {});
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  setStatus("Game started. Students can now play rounds.");
});

elements.rollWeatherButton.addEventListener("click", async () => {
  const response = await emitWithAck("teacher:rollWeather", {});
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  setStatus(`Universal dice rolled ${response.lastRoll}.`);
});

elements.lockChoicesButton.addEventListener("click", async () => {
  const response = await emitWithAck("teacher:lockChoices", {});
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  setStatus("Choices locked for this round.");
});

elements.resolveRoundButton.addEventListener("click", async () => {
  const response = await emitWithAck("teacher:resolveRound", {});
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  setStatus("Round resolved.");
});

elements.startRoundButton.addEventListener("click", async () => {
  const response = await emitWithAck("teacher:startRound", {});
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  setStatus("New round started.");
});

elements.resetButton.addEventListener("click", async () => {
  const response = await emitWithAck("teacher:reset", {});
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  setStatus("Game reset.");
});

elements.placeButton.addEventListener("click", async () => {
  const response = await emitWithAck("player:place", {
    inside: Number(elements.insideInput.value),
    outside: Number(elements.outsideInput.value)
  });
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  setStatus("Placement saved for this round.");
});

elements.lockInButton.addEventListener("click", async () => {
  const response = await emitWithAck("player:lockIn", {});
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  setStatus(response.everyoneLocked ? "You locked in. Everyone is now locked." : "You locked in your choices.");
});

elements.buyButton.addEventListener("click", async () => {
  const response = await emitWithAck("player:buy", {
    boats: Number(elements.buyBoatsInput.value),
    pots: Number(elements.buyPotsInput.value),
    claimedTotal: Number(elements.buyTotalInput.value)
  });
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  setStatus("Purchase saved.");
});

elements.sellButton.addEventListener("click", async () => {
  const response = await emitWithAck("player:sell", {
    boats: Number(elements.sellBoatsInput.value),
    pots: Number(elements.sellPotsInput.value),
    claimedTotal: Number(elements.sellTotalInput.value)
  });
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }

  setStatus("Sale saved.");
});

elements.claimSettlementButton.addEventListener("click", async () => {
  const response = await emitWithAck("player:claimSettlement", {
    amount: Number(elements.claimAmountInput.value)
  });
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  setStatus("Earnings claimed.");
});

socket.on("state:update", (snapshot) => {
  render(snapshot);
});

socket.on("connect", async () => {
  const savedName = localStorage.getItem(STORAGE_NAME_KEY) || "";
  const savedPin = localStorage.getItem(STORAGE_PIN_KEY) || "";
  const savedToken = localStorage.getItem(STORAGE_TOKEN_KEY) || "";
  const savedSessionCode = localStorage.getItem(STORAGE_SESSION_CODE_KEY) || "";
  const savedEmoji = localStorage.getItem(STORAGE_EMOJI_KEY) || "";
  const savedTeacherCode = localStorage.getItem(STORAGE_TEACHER_CODE_KEY) || "";

  if (savedName) {
    elements.playerName.value = savedName;
  }
  if (savedPin) {
    elements.playerPin.value = savedPin;
  }
  if (savedSessionCode) {
    elements.sessionCode.value = savedSessionCode;
  }
  if (savedEmoji) {
    elements.playerEmoji.value = savedEmoji;
  }
  if (savedTeacherCode) {
    elements.teacherAccessCode.value = savedTeacherCode;
  }

  if (savedName && savedPin && savedToken && !viewState.playerId) {
    viewState.playerToken = savedToken;
    await joinOrReconnect();
  }
});

if (!viewState.countdownTimer) {
  viewState.countdownTimer = setInterval(updateCountdownUI, 500);
}
