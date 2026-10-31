import * as Phaser from "phaser";
import MainScene from "./scenes/MainScene";

export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#120e22",
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: parent.clientWidth,
      height: parent.clientHeight,
    },
    // lets scenes place HTML elements (like the zoom input) over the canvas
    dom: { createContainer: true },
    // no sound yet; without this Phaser opens an AudioContext and, after the game is destroyed
    // (e.g. React's dev-mode remount), tries to suspend/resume it once it's closed
    audio: { noAudio: true },
    scene: [MainScene],
  };
}
