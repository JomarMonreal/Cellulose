import * as Phaser from "phaser";
import GameScene from "./scenes/GameScene";
import HomeScene from "./scenes/HomeScene";
import LobbyScene from "./scenes/LobbyScene";

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
    // the first scene starts on boot
    scene: [HomeScene, LobbyScene, GameScene],
  };
}
