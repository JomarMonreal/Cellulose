import * as Phaser from "phaser";
import { createGameConfig } from "./config";
import "./style.css";

const parent = document.getElementById("game")!;

// MainScene reads the body font when it builds its text, so wait for it first
document.fonts
  .load('16px "Bricolage Grotesque"')
  .catch(() => {})
  .then(() => new Phaser.Game(createGameConfig(parent)));
