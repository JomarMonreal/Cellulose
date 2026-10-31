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

## Project structure

```
index.html                  # page shell, header, game container
public/
  cellulose.svg             # key art / favicon
src/
  main.ts                   # boots Phaser once the font is loaded
  style.css                 # colour tokens and page layout
  config.ts                 # Phaser game config
  scenes/MainScene.ts       # board, UI, input, zoom
  Board.ts, Cell.ts         # Game of Life grid and territory
  Player.ts, Ai.ts          # players and AI opponent
  patterns.ts               # placeable patterns
```

History before the split lives in the NoromonStudio repo, up to commit `5af584b`.
