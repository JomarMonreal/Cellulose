import * as Phaser from "phaser";
import AuthScene from "./scenes/AuthScene";
import GameScene from "./scenes/GameScene";
import HomeScene from "./scenes/HomeScene";
import LobbyScene from "./scenes/LobbyScene";
import OnlineLobbyScene from "./scenes/OnlineLobbyScene";
import PlaygroundScene from "./scenes/PlaygroundScene";
import RankedScene from "./scenes/RankedScene";
import TutorialScene from "./scenes/TutorialScene";

export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    // the page's growth pattern (see background.ts) shows through; #game tints it
    transparent: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: parent.clientWidth,
      height: parent.clientHeight,
    },
    // lets scenes place HTML elements (like the zoom input) over the canvas
    dom: { createContainer: true },
    // the wheel scrolls the page when a screen is taller than the window (fitHeight); boards keep it for zoom (keepWheel)
    input: { mouse: { preventDefaultWheel: false } },
    // no sound yet; without this Phaser opens an AudioContext and, after the game is destroyed
    // (e.g. React's dev-mode remount), tries to suspend/resume it once it's closed
    audio: { noAudio: true },
    // the first scene starts on boot: sign in before anything else
    scene: [AuthScene, HomeScene, LobbyScene, OnlineLobbyScene, RankedScene, GameScene, PlaygroundScene, TutorialScene],
  };
}
