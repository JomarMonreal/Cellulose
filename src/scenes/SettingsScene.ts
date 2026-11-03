import * as Phaser from "phaser";
import { getMusicVolume, getSfxVolume, isMuted, loadSounds, popForPlace, setMusicVolume, setMuted, setSfxVolume } from "../sound";
import { BTN_H, type Button, displayFont, fitHeight, fontFamily, layoutButton, makeButton, PANEL_COLOR, PRIMARY, SECONDARY, setButtonStyle } from "../ui";

const PAD = 24;
const SLIDER_H = 28;

type Slider = { label: Phaser.GameObjects.Text; value: Phaser.GameObjects.Text; input: Phaser.GameObjects.DOMElement };

/**
 * Audio settings: how loud the sound effects (the pops) and the music are, and a switch that mutes both (also the
 * speaker button in a game, and M). Changes apply as you move the sliders and are remembered in this browser.
 */
export default class SettingsScene extends Phaser.Scene {
  constructor() {
    super("SettingsScene");
  }

  private panel!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  private sfx!: Slider;
  private music!: Slider;
  private muteButton!: Button;
  private backButton!: Button;

  preload() {
    // the sound effects slider plays a pop, to hear how loud it is
    loadSounds(this);
  }

  create() {
    const font = fontFamily();
    const display = displayFont();
    this.panel = this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0);
    this.title = this.add.text(0, 0, "Settings", { fontFamily: display, fontSize: "32px", fontStyle: "bold", color: "#f8f5ff" });
    this.sfx = this.makeSlider("Sound effects", getSfxVolume(), (v) => {
      setSfxVolume(v);
      // a muted game would make the slider seem broken; moving it is asking to hear it
      if (isMuted()) this.setMute(false);
      popForPlace(this);
    });
    this.music = this.makeSlider("Music", getMusicVolume(), (v) => {
      setMusicVolume(v);
      if (isMuted()) this.setMute(false);
    });
    this.muteButton = makeButton(this, "", SECONDARY, () => this.setMute(!isMuted()));
    this.backButton = makeButton(this, "Back", SECONDARY, () => this.scene.start("HomeScene"));
    this.setMute(isMuted());

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
    this.layout(this.scale.gameSize);
  }

  /** A label with the percentage beside it, and a range input from 0 to 100% under them. */
  private makeSlider(name: string, value: number, onChange: (v: number) => void): Slider {
    const label = this.add.text(0, 0, name, { fontFamily: displayFont(), fontSize: "16px", fontStyle: "bold", color: "#d4ccff" });
    const shown = this.add.text(0, 0, "", { fontFamily: fontFamily(), fontSize: "15px", fontStyle: "bold", color: "#f8f5ff" }).setOrigin(1, 0);
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.value = String(Math.round(value * 100));
    input.setAttribute("aria-label", `${name} volume`);
    Object.assign(input.style, { width: "100px", height: `${SLIDER_H}px`, margin: "0", accentColor: "#ffe03d", cursor: "pointer" });
    const show = () => shown.setText(`${input.value}%`);
    input.addEventListener("input", () => {
      show();
      onChange(Number(input.value) / 100);
    });
    show();
    return { label, value: shown, input: this.add.dom(0, 0, input).setOrigin(0) };
  }

  private setMute(on: boolean) {
    setMuted(on);
    this.muteButton.label.setText(on ? "Unmute all" : "Mute all");
    setButtonStyle(this.muteButton, on ? PRIMARY : SECONDARY);
  }

  /** A centred panel: the two sliders, then mute and Back. */
  private layout({ width, height }: Phaser.Structs.Size) {
    const pw = Math.min(480, width - PAD * 2);
    const inner = pw - 64;
    const sliderH = 24 + SLIDER_H + 28;
    const ph = 32 + this.title.height + 28 + sliderH * 2 + BTN_H + 16 + BTN_H + 32;
    fitHeight(this, ph + PAD * 2);
    const px = (width - pw) / 2;
    const x = px + 32;
    let y = Math.max(PAD, (height - ph) / 2);
    this.panel.setPosition(px, y).setSize(pw, ph);
    y += 32;
    this.title.setPosition(x, y);
    y += this.title.height + 28;
    for (const s of [this.sfx, this.music]) {
      s.label.setPosition(x, y);
      s.value.setPosition(x + inner, y);
      y += 24;
      s.input.setPosition(x, y);
      (s.input.node as HTMLInputElement).style.width = `${inner}px`;
      y += SLIDER_H + 28;
    }
    layoutButton(this.muteButton, x, y, inner);
    y += BTN_H + 16;
    layoutButton(this.backButton, x, y, inner);
  }
}
