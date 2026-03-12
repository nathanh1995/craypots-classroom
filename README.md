# Craypots Classroom

Small shared-session classroom game based on the worksheet version of Craypots.

## What it does

- One live session for the whole class
- Students join/reconnect with name + 4-digit PIN
- Teacher rolls one universal game dice for weather, locks choices, resolves rounds, starts next rounds, and resets the game
- Live leaderboard ranks players by money
- Leaderboard also shows each player's boats, pots, online state, and lock state
- Projector display at `/display.html` with oversized leaderboard cards

## Rules used

- Start with 1 boat and 5 pots
- Each boat can hold 10 pots
- Boats cost $100 to buy and sell for $50
- Pots cost $5 to buy and sell for $5
- Good weather: inside reef earns $2 per pot, outside reef earns $8 per pot
- Bad weather: inside reef earns $4 per pot, outside reef pots are lost
- Teacher rolls a universal 1-6 dice each round (1-3 good, 4 repeats previous weather, 5-6 bad)

## Round flow

1. Teacher rolls universal dice.
2. Students choose placements and optional buy/sell actions.
3. Students can lock in their own choices.
4. Teacher locks all remaining choices.
5. Teacher resolves the round.
6. Teacher starts the next round.

## Run it

1. Open PowerShell in this folder and run `npm install`
2. Start the server with `npm start`
3. On the teacher device, open `http://localhost:3000`
4. On student devices on the same network, open `http://MSFC3497648346:3000`

If Windows complains about running npm from a network share, use:

```powershell
cmd /c "pushd \\E5266S01SV001.BLUE.SCHOOLS.INTERNAL\fsE5266S01-StaffFolders$\E4113833\Desktop\Craypots && npm start && popd"
```

## Notes

- Session state is kept in memory, so restarting the server resets the game.
- Reconnect works while the server is running, using saved name + PIN + token in the browser.
- If you want this available outside your local network, add deployment or a hosted database/realtime layer later.
