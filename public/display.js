const socket = io();
const DISPLAY_TEACHER_CODE_KEY = "craypots_display_teacher_code";
const DICE_FACE_MAP = {
  1: "\u2680",
  2: "\u2681",
  3: "\u2682",
  4: "\u2683",
  5: "\u2684",
  6: "\u2685"
};

const elements = {
  displayRound: document.getElementById("displayRound"),
  displayWeather: document.getElementById("displayWeather"),
  displayRoll: document.getElementById("displayRoll"),
  displayAutoLock: document.getElementById("displayAutoLock"),
  displayDice: document.getElementById("displayDice"),
  displayLeaderboardBody: document.getElementById("displayLeaderboardBody"),
  displayBootHeader: document.getElementById("displayBootHeader"),
  mostMoneyStat: document.getElementById("mostMoneyStat"),
  mostPotsLostStat: document.getElementById("mostPotsLostStat"),
  displayTeacherCode: document.getElementById("displayTeacherCode"),
  displayClaimTeacherButton: document.getElementById("displayClaimTeacherButton"),
  displayTeacherStatus: document.getElementById("displayTeacherStatus")
};

const viewState = {
  lastRoll: null,
  diceTimer: null,
  teacher: false,
  lastSnapshotPlayers: [],
  snapshot: null
};

function setTeacherStatus(message, isError = false) {
  elements.displayTeacherStatus.textContent = message;
  elements.displayTeacherStatus.style.color = isError ? "#bc4749" : "#2f6690";
}

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => {
      resolve(response || { ok: false, error: "No response from server." });
    });
  });
}

function getDiceFace(roll) {
  return DICE_FACE_MAP[roll] || "?";
}

function renderDice(roll, animate) {
  if (!elements.displayDice) {
    return;
  }

  if (!Number.isInteger(roll)) {
    if (viewState.diceTimer) {
      clearInterval(viewState.diceTimer);
      viewState.diceTimer = null;
    }
    elements.displayDice.classList.remove("rolling");
    elements.displayDice.textContent = "?";
    return;
  }

  if (!animate) {
    elements.displayDice.classList.remove("rolling");
    elements.displayDice.textContent = getDiceFace(roll);
    return;
  }

  if (viewState.diceTimer) {
    clearInterval(viewState.diceTimer);
    viewState.diceTimer = null;
  }

  elements.displayDice.classList.add("rolling");
  let ticks = 0;
  viewState.diceTimer = setInterval(() => {
    const randomRoll = Math.floor(Math.random() * 6) + 1;
    elements.displayDice.textContent = getDiceFace(randomRoll);
    ticks += 1;
    if (ticks >= 16) {
      clearInterval(viewState.diceTimer);
      viewState.diceTimer = null;
      elements.displayDice.classList.remove("rolling");
      elements.displayDice.textContent = getDiceFace(roll);
    }
  }, 90);
}

function renderTable(players) {
  elements.displayBootHeader.classList.toggle("hidden", !viewState.teacher);

  if (!players.length) {
    elements.displayLeaderboardBody.innerHTML = `<tr><td colspan="${viewState.teacher ? 8 : 7}" class="empty-state">No students have joined yet.</td></tr>`;
    return;
  }

  elements.displayLeaderboardBody.innerHTML = players
    .map((player) => {
      const kickCell = viewState.teacher
        ? `<td><button class="kick-player-button" data-player-id="${player.id}">Boot</button></td>`
        : "";
      return `
        <tr>
          <td>${player.rank}</td>
          <td>${player.emoji} ${player.name}</td>
          <td>$${player.cash}</td>
          <td>${player.boats}</td>
          <td>${player.pots}</td>
          <td>${player.connected ? "Yes" : "No"}</td>
          <td>${player.lockedInRound ? "Locked" : "Open"}</td>
          ${kickCell}
        </tr>
      `;
    })
    .join("");

  const buttons = elements.displayLeaderboardBody.querySelectorAll(".kick-player-button");
  for (const button of buttons) {
    button.addEventListener("click", async () => {
      const response = await emitWithAck("teacher:kickPlayer", { playerId: button.dataset.playerId });
      if (!response.ok) {
        setTeacherStatus(response.error, true);
        return;
      }
      setTeacherStatus("Student removed.");
    });
  }
}

function renderSummary(players) {
  if (!players.length) {
    elements.mostMoneyStat.textContent = "-";
    elements.mostPotsLostStat.textContent = "-";
    return;
  }

  const moneyLeader = players.reduce((best, player) => {
    const value = Number(player.totalEarned ?? 0);
    const bestValue = Number(best?.totalEarned ?? -1);
    if (!best || value > bestValue) {
      return player;
    }
    return best;
  }, null);

  const potsLostLeader = players.reduce((best, player) => {
    const value = Number(player.totalPotsLost ?? 0);
    const bestValue = Number(best?.totalPotsLost ?? -1);
    if (!best || value > bestValue) {
      return player;
    }
    return best;
  }, null);

  const money = Number(moneyLeader?.totalEarned ?? 0);
  const potsLost = Number(potsLostLeader?.totalPotsLost ?? 0);
  const moneyEmoji = moneyLeader?.emoji || "";
  const moneyName = moneyLeader?.name || "Nobody";
  const lostEmoji = potsLostLeader?.emoji || "";
  const lostName = potsLostLeader?.name || "Nobody";

  elements.mostMoneyStat.textContent = `${moneyEmoji} ${moneyName}: $${money}`;
  elements.mostPotsLostStat.textContent = `${lostEmoji} ${lostName}: ${potsLost}`;
}

function getAutoLockLabel(snapshot) {
  if (!snapshot || snapshot.phase !== "planning" || snapshot.choicesLocked) {
    return "Locked";
  }
  if (!Number.isInteger(snapshot.lastRoll)) {
    return "After roll";
  }
  if (!snapshot.lockDeadlineMs) {
    return "-";
  }
  const seconds = Math.max(0, Math.ceil((snapshot.lockDeadlineMs - Date.now()) / 1000));
  return `${seconds}s`;
}

function updateAutoLockUI() {
  elements.displayAutoLock.textContent = getAutoLockLabel(viewState.snapshot);
}

socket.on("state:update", (snapshot) => {
  viewState.snapshot = snapshot;
  viewState.lastSnapshotPlayers = snapshot.players;
  elements.displayRound.textContent = snapshot.round;
  elements.displayWeather.textContent = snapshot.weatherLabel;
  elements.displayRoll.textContent = Number.isInteger(snapshot.lastRoll) ? String(snapshot.lastRoll) : "-";
  updateAutoLockUI();
  renderDice(snapshot.lastRoll, Number.isInteger(snapshot.lastRoll) && snapshot.lastRoll !== viewState.lastRoll);
  viewState.lastRoll = snapshot.lastRoll;
  renderSummary(snapshot.players);
  renderTable(snapshot.players);
});

elements.displayClaimTeacherButton.addEventListener("click", async () => {
  const accessCode = elements.displayTeacherCode.value.trim();
  const response = await emitWithAck("teacher:claim", { accessCode });
  if (!response.ok) {
    setTeacherStatus(response.error, true);
    return;
  }
  localStorage.setItem(DISPLAY_TEACHER_CODE_KEY, accessCode);
  viewState.teacher = true;
  setTeacherStatus("Teacher controls active on this screen.");
  renderTable(viewState.lastSnapshotPlayers);
});

setInterval(updateAutoLockUI, 500);

const savedTeacherCode = localStorage.getItem(DISPLAY_TEACHER_CODE_KEY) || "";
if (savedTeacherCode) {
  elements.displayTeacherCode.value = savedTeacherCode;
}
