import * as Phaser from "phaser";
import { startBackground } from "./background";
import { createGameConfig } from "./config";
import Online, { wakeServer } from "./net/Online";
import "./style.css";

// a host that sleeps when idle starts waking while the page loads, not when someone clicks Play
wakeServer();

const parent = document.getElementById("game")!;
startBackground(document.getElementById("bg") as HTMLCanvasElement);

// scenes read the fonts when they build their text, so wait for both first
Promise.all([document.fonts.load('16px "Bricolage Grotesque"'), document.fonts.load('16px "Arco"')])
  .catch(() => {})
  .then(() => {
    const game = new Phaser.Game(createGameConfig(parent));
    game.events.once(Phaser.Core.Events.READY, () => parent.querySelector(".boot-loader")?.remove());
    // a ranked match found while you're on another screen opens in this game
    Online.attach(game);
  });
