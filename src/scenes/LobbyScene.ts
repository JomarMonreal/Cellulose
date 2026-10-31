import * as Phaser from "phaser";
import { PALETTE } from "../Player";
import { BTN_H, type Button, fontFamily, layoutButton, makeButton, PANEL_COLOR, PRIMARY, SECONDARY, setButtonStyle } from "../ui";
import { FINAL_GENERATION, type GameSettings } from "./GameScene";

const PAD = 24;
const GAP = 12;
const MAX_OPPONENTS = PALETTE.length - 1;

/** Single-player setup: pick your colour and how many AI colonies to face, then start. */
export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super("LobbyScene");
  }

  private settings!: GameSettings;

  private panel!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  private colorLabel!: Phaser.GameObjects.Text;
  private swatches!: Button[];
  private opponentsLabel!: Phaser.GameObjects.Text;
  private opponentButtons!: Button[];
  private matchup!: Phaser.GameObjects.Text;
  private backButton!: Button;
  private startButton!: Button;

  /** Coming back from a game keeps that game's settings. */
  init(data: Partial<GameSettings>) {
    this.settings = { color: data.color ?? 0, opponents: data.opponents ?? MAX_OPPONENTS };
  }

  create() {
    const font = fontFamily();
    const labelStyle = { fontFamily: font, fontSize: "16px", fontStyle: "bold", color: "#d4ccff" };

    this.panel = this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0);
    this.title = this.add.text(0, 0, "New game", { fontFamily: font, fontSize: "32px", fontStyle: "bold", color: "#f8f5ff" });
    this.colorLabel = this.add.text(0, 0, "", labelStyle);
    this.swatches = PALETTE.map(({ color }, i) =>
      makeButton(this, "", { fill: color, hover: color, text: "#120e22" }, () => {
        this.settings.color = i;
        this.refresh();
      }),
    );
    this.opponentsLabel = this.add.text(0, 0, "AI opponents", labelStyle);
    this.opponentButtons = Array.from({ length: MAX_OPPONENTS }, (_, i) =>
      makeButton(this, `${i + 1}`, SECONDARY, () => {
        this.settings.opponents = i + 1;
        this.refresh();
      }),
    );
    this.matchup = this.add.text(0, 0, "", { fontFamily: font, fontSize: "15px", color: "#f8f5ff", lineSpacing: 4 });
    this.backButton = makeButton(this, "Back", SECONDARY, () => this.scene.start("HomeScene"));
    this.startButton = makeButton(this, "Start", PRIMARY, () => this.scene.start("GameScene", { ...this.settings }));

    this.refresh();
    this.layout(this.scale.gameSize);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
  }

  /** Show the current choices: a tick on the chosen colour, the chosen opponent count lit up, and who you'll face. */
  private refresh() {
    const { color, opponents } = this.settings;
    this.colorLabel.setText(`Your colour: ${PALETTE[color].name}`);
    this.swatches.forEach((b, i) => b.label.setText(i === color ? "✓" : ""));
    this.opponentButtons.forEach((b, i) => setButtonStyle(b, i + 1 === opponents ? PRIMARY : SECONDARY));
    const rivals = PALETTE.filter((_, i) => i !== color)
      .slice(0, opponents)
      .map((p) => `${p.name} AI`);
    this.matchup.setText(`You vs ${rivals.join(", ")}\n${FINAL_GENERATION} generations. Most land at the end wins.`);
  }

  /** A centred panel; rows of equal-width buttons fill its width. */
  private layout({ width, height }: Phaser.Structs.Size) {
    const pw = Math.min(460, width - PAD * 2);
    const inner = pw - 64;
    this.matchup.setWordWrapWidth(inner);
    const ph = 32 + this.title.height + 28 + 24 + BTN_H + 28 + 24 + BTN_H + 24 + this.matchup.height + 32 + BTN_H + 32;
    const px = (width - pw) / 2;
    const py = Math.max(PAD, (height - ph) / 2);
    const x = px + 32;
    this.panel.setPosition(px, py).setSize(pw, ph);

    let y = py + 32;
    this.title.setPosition(x, y);
    y += this.title.height + 28;

    this.colorLabel.setPosition(x, y);
    y += 24;
    this.layoutRow(this.swatches, x, y, inner);
    y += BTN_H + 28;

    this.opponentsLabel.setPosition(x, y);
    y += 24;
    this.layoutRow(this.opponentButtons, x, y, inner);
    y += BTN_H + 24;

    this.matchup.setPosition(x, y);
    y += this.matchup.height + 32;
    this.layoutRow([this.backButton, this.startButton], x, y, inner);
  }

  private layoutRow(buttons: Button[], x: number, y: number, w: number) {
    const bw = (w - GAP * (buttons.length - 1)) / buttons.length;
    buttons.forEach((b, i) => layoutButton(b, x + i * (bw + GAP), y, bw));
  }
}
