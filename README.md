# Cellulose: Conway's Competitive Game of Life

A competitive take on Conway's Game of Life, playable in the browser. A [Noromon Studio](https://github.com/JomarMonreal/NoromonStudio) game.

Built with [Phaser 4](https://phaser.io), TypeScript and [Vite](https://vite.dev).

## Getting started

Requires Node.js 20 or newer.

```bash
npm install
npm run dev      # http://localhost:5173
```

Production build (outputs to `dist/`):

```bash
npm run build
npm run preview
```

## Ways to play

Apart from the playground, every way has two modes: **Strongest 500** (most land after 500 generations) and **Capture the flag** (a rival's land over your flag knocks you out; last colony standing wins, or the most land after 1000 generations).

- **Play with bots** runs entirely in the browser, against local AIs.
- **Play with friends** creates or joins a room on [CelluloseServer](../CelluloseServer), which holds the true board. The client only sends requests (place, remove, ready) and draws what the server broadcasts.
You sign in (or sign up) on the first screen before choosing any of these; a sign-in is remembered across visits.

- **Play classic** finds a 4-player match against other players, with no ratings at stake. Guests can play it.
- **Play ranked** is the same match, but rated, with tiers from Species up to Domain. It needs an account.
- **Playground** is a sandbox for plain Game of Life, in the browser: draw cells in any of the four colours, then play, pause, speed up (up to 16×) or clear, and set how many generations it runs. Colours mix as they do in a game, but there's no territory and no one to beat.

While you wait for a classic or ranked match you can play with bots or in the playground; the game jumps to the match once it's found. The sign-in screen also has **Play as guest**: everything but ranked, under a name like `Guest4821`, for that browser tab.

The online modes connect to port 3000 on the host that served the page by default. Point them somewhere else with `VITE_SERVER_URL`:

```bash
VITE_SERVER_URL=http://localhost:3100 npm run dev
```

## Project structure

```text
index.html                  # page shell, header, game container
public/
  cellulose.svg             # key art / favicon
  ARCO.ttf                  # display typeface for titles, buttons and labels (ARCO Typography Regular)
src/
  main.ts                   # boots Phaser once the font is loaded
  style.css                 # colour tokens and page layout
  config.ts                 # Phaser game config
  ui.ts                     # shared buttons and colours
  scenes/HomeScene.ts       # title screen
  scenes/LobbyScene.ts      # colour and opponent picker
  scenes/OnlineLobbyScene.ts # create or join a room on the server
  scenes/RankedScene.ts     # sign in, ratings, find a ranked match
  modes.ts                  # the game modes
  net/Online.ts             # connection to the server (requests, sign-in, queue, latest lobby and game state)
  net/QueueBanner.ts        # "finding a match" strip shown on every screen while queued
  net/protocol.ts           # message types, copied from CelluloseServer
  scenes/GameScene.ts       # board, UI, input, zoom, end-of-game results
  scenes/PlaygroundScene.ts # sandbox: draw, play, pause, speed up, clear
  Board.ts, Cell.ts         # Game of Life grid and territory
  Player.ts, Ai.ts          # players and AI opponent
  patterns.ts               # placeable patterns
```

History before the split lives in the NoromonStudio repo, up to commit `5af584b`.
