import * as Phaser from "phaser";
import { MODES, modeName } from "../modes";
import Online, { SERVER_URL } from "../net/Online";
import { PALETTE } from "../Player";
import {
  BTN_H,
  type Button,
  fontFamily,
  layoutButton,
  makeButton,
  makeSpinner,
  PANEL_COLOR,
  PRIMARY,
  SECONDARY,
  SPINNER_INDENT,
  SPINNER_SIZE,
  setButtonLoading,
  setButtonStyle,
  setButtonVisible,
  textInput,
} from "../ui";

const PAD = 24;
const GAP = 12;
const MAX_PLAYERS = PALETTE.length;
const SWATCH = 14;
const MEMBER_ROW_H = 26;
const COPY_W = 120;
// how long the Copy button says "Copied!"
const COPIED_MS = 1_500;

/**
 * Online setup. Before joining: your name and colour, then create a room or join one by its code.
 * In a room: who's there, the host's mode and bot count, your colour, and Start. The game scene takes over once the server starts the game.
 */
export default class OnlineLobbyScene extends Phaser.Scene {
  constructor() {
    super("OnlineLobbyScene");
  }

  private online!: Online;
  /** Colour picked before joining a room; in a room the server's copy counts. */
  private color!: number;
  private error!: string;
  // a request is on its way; ignore clicks until it's answered
  private busy!: boolean;

  private panel!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private statusSpinner!: Phaser.GameObjects.Graphics;
  private errorText!: Phaser.GameObjects.Text;
  // before joining
  private nameLabel!: Phaser.GameObjects.Text;
  private nameInput!: Phaser.GameObjects.DOMElement;
  private createButton!: Button;
  private codeLabel!: Phaser.GameObjects.Text;
  private codeInput!: Phaser.GameObjects.DOMElement;
  private joinButton!: Button;
  private backButton!: Button;
  // both
  private colorLabel!: Phaser.GameObjects.Text;
  private swatches!: Button[];
  // in a room
  // an HTML field, so the code can be selected and copied like any text
  private roomCode!: Phaser.GameObjects.DOMElement;
  private copyButton!: Button;
  private membersLabel!: Phaser.GameObjects.Text;
  private memberSwatches!: Phaser.GameObjects.Rectangle[];
  private memberTexts!: Phaser.GameObjects.Text[];
  private modeLabel!: Phaser.GameObjects.Text;
  private modeButtons!: Button[];
  private botsLabel!: Phaser.GameObjects.Text;
  private botButtons!: Button[];
  private leaveButton!: Button;
  private startButton!: Button;

  /** Coming back from a game keeps the room; a fresh visit starts at "create or join". */
  init(data: { error?: string }) {
    this.online = Online.get();
    this.color = this.online.me?.color ?? 0;
    this.error = data.error ?? "";
    this.busy = false;
  }

  create() {
    const font = fontFamily();
    const labelStyle = { fontFamily: font, fontSize: "16px", fontStyle: "bold", color: "#d4ccff" };

    this.panel = this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0);
    this.title = this.add.text(0, 0, "", { fontFamily: font, fontSize: "32px", fontStyle: "bold", color: "#f8f5ff" });
    this.status = this.add.text(0, 0, "", { fontFamily: font, fontSize: "14px", color: "#d4ccff" });
    this.statusSpinner = makeSpinner(this);
    this.errorText = this.add.text(0, 0, "", { fontFamily: font, fontSize: "15px", fontStyle: "bold", color: "#ff4d5e" });

    this.nameLabel = this.add.text(0, 0, "Your name", labelStyle);
    this.nameInput = this.add.dom(0, 0, textInput(font, "Name", 20, this.online.savedName)).setOrigin(0);
    this.createButton = makeButton(this, "Create room", PRIMARY, () => this.createRoom());
    this.codeLabel = this.add.text(0, 0, "Or join a friend's room", labelStyle);
    const code = textInput(font, "Room code", 8, "");
    code.style.textTransform = "uppercase";
    code.addEventListener("keydown", (e) => e.key === "Enter" && this.joinRoom());
    this.codeInput = this.add.dom(0, 0, code).setOrigin(0);
    this.joinButton = makeButton(this, "Join", SECONDARY, () => this.joinRoom());
    this.backButton = makeButton(this, "Back", SECONDARY, () => this.scene.start("HomeScene"));

    this.colorLabel = this.add.text(0, 0, "", labelStyle);
    this.swatches = PALETTE.map(({ color }, i) => makeButton(this, "", { fill: color, hover: color, text: "#120e22" }, () => this.pickColor(i)));

    const roomCode = textInput(font, "Room code", 8, "");
    roomCode.readOnly = true;
    Object.assign(roomCode.style, { fontSize: "24px", letterSpacing: "4px", textAlign: "center", color: "#ffe03d" });
    // one click selects the whole code, ready for Ctrl+C
    roomCode.addEventListener("focus", () => roomCode.select());
    this.roomCode = this.add.dom(0, 0, roomCode).setOrigin(0);
    this.copyButton = makeButton(this, "Copy", PRIMARY, () => this.copyCode());

    this.membersLabel = this.add.text(0, 0, "Players", labelStyle);
    this.memberSwatches = Array.from({ length: MAX_PLAYERS }, () => this.add.rectangle(0, 0, SWATCH, SWATCH, 0).setOrigin(0));
    this.memberTexts = Array.from({ length: MAX_PLAYERS }, () => this.add.text(0, 0, "", { fontFamily: font, fontSize: "15px", color: "#f8f5ff" }));
    this.modeLabel = this.add.text(0, 0, "", labelStyle);
    this.modeButtons = MODES.map((m, i) => makeButton(this, m.name, SECONDARY, () => this.send(() => this.online.setMode(m.id), this.modeButtons[i])));
    for (const b of this.modeButtons) b.label.setFontSize(17);
    this.botsLabel = this.add.text(0, 0, "", labelStyle);
    this.botButtons = Array.from({ length: MAX_PLAYERS }, (_, n) =>
      makeButton(this, `${n}`, SECONDARY, () => this.send(() => this.online.setBots(n), this.botButtons[n])),
    );
    this.leaveButton = makeButton(this, "Leave", SECONDARY, () => this.send(() => this.online.leave(), this.leaveButton));
    this.startButton = makeButton(this, "Start", PRIMARY, () => this.online.me?.host && this.send(() => this.online.start(), this.startButton));

    // the server pushes changes; redraw on each, and hand over to the game once it starts
    const onState = () => this.online.lobby?.status === "playing" && this.scene.start("GameScene", { online: true });
    const onClosed = (reason: string) => {
      this.error = reason;
      this.refresh();
    };
    this.online.on("status", this.refresh, this).on("lobby", this.refresh, this).on("state", onState).on("closed", onClosed);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.online.off("status", this.refresh, this).off("lobby", this.refresh, this).off("state", onState).off("closed", onClosed);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);

    // e.g. a refreshed page that rejoined a running game
    if (this.online.state && this.online.lobby?.status === "playing") return onState();
    this.refresh();
  }

  private get name() {
    return (this.nameInput.node as HTMLInputElement).value.trim();
  }

  private createRoom() {
    if (!this.name) return this.showError("Enter a name first");
    // bots default to filling the room, so a solo player can start right away
    this.send(() => this.online.create(this.name, this.color, MAX_PLAYERS - 1), this.createButton);
  }

  private joinRoom() {
    // pasted codes may bring spaces or punctuation along
    const code = (this.codeInput.node as HTMLInputElement).value.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (!this.name) return this.showError("Enter a name first");
    if (!code) return this.showError("Enter the room code");
    this.send(() => this.online.join(code, this.name, this.color), this.joinButton);
  }

  /** Copy the room code to the clipboard, and say so on the button for a moment. */
  private async copyCode() {
    const field = this.roomCode.node as HTMLInputElement;
    try {
      await navigator.clipboard.writeText(field.value);
    } catch {
      // the clipboard API needs https or localhost; a page opened by LAN IP falls back to the old way
      field.select();
      if (!document.execCommand("copy")) return this.showError("Couldn't copy. Select the code and press Ctrl+C.");
    }
    if (!this.scene.isActive()) return;
    this.copyButton.label.setText("Copied!");
    this.time.delayedCall(COPIED_MS, () => this.copyButton.label.setText("Copy"));
  }

  private pickColor(i: number) {
    if (!this.online.inRoom) {
      this.color = i;
      return this.refresh();
    }
    this.send(() => this.online.setColor(i), this.swatches[i]);
  }

  /**
   * Send a request, with a spinner on the button that sent it, showing its refusal if there is one.
   * The server's broadcast does the redraw on success.
   */
  private async send(request: () => Promise<{ ok: boolean; reason?: string }>, button: Button) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    setButtonLoading(button, true);
    const r = await request();
    this.busy = false;
    // the scene may have moved on (e.g. into the game) while we waited
    if (!this.scene.isActive()) return;
    setButtonLoading(button, false);
    if (!r.ok) this.error = r.reason ?? "Something went wrong";
    this.refresh();
  }

  private showError(message: string) {
    this.error = message;
    this.refresh();
  }

  /** Show whichever view applies, filled in from the latest lobby. */
  private refresh() {
    const { online } = this;
    const lobby = online.inRoom ? online.lobby : null;
    const me = online.me;

    this.title.setText(lobby ? "Your room" : "Play with friends");
    if (lobby) (this.roomCode.node as HTMLInputElement).value = lobby.roomId;
    this.status.setText(
      online.connectionStatus ?? (lobby ? "Share the room code so friends can join." : `Connected to ${SERVER_URL}`),
    );
    this.errorText.setText(this.error);

    const pre = [this.nameLabel, this.nameInput, this.codeLabel, this.codeInput];
    for (const o of pre) o.setVisible(!lobby);
    for (const b of [this.createButton, this.joinButton, this.backButton]) setButtonVisible(b, !lobby);
    const inRoom = [this.roomCode, this.membersLabel, this.modeLabel, this.botsLabel];
    for (const o of inRoom) o.setVisible(!!lobby);
    for (const b of [this.copyButton, ...this.modeButtons, ...this.botButtons, this.leaveButton, this.startButton]) setButtonVisible(b, !!lobby);

    // colours: a tick on yours; in a room, the ones others hold are dimmed
    const mine = lobby ? (me?.color ?? -1) : this.color;
    const taken = new Set(lobby?.members.filter((m) => m !== me).map((m) => m.color));
    this.colorLabel.setText(`Your colour: ${PALETTE[mine]?.name ?? ""}`);
    this.swatches.forEach((b, i) => {
      b.label.setText(i === mine ? "✓" : "");
      b.rect.setAlpha(taken.has(i) ? 0.3 : 1);
    });

    this.memberSwatches.forEach((s, i) => {
      const m = lobby?.members[i];
      s.setVisible(!!m);
      this.memberTexts[i].setVisible(!!m);
      if (!m) return;
      s.setFillStyle(PALETTE[m.color].color);
      const tags = [m === me && "you", m.host && "host", !m.connected && "offline"].filter(Boolean).join(", ");
      this.memberTexts[i].setText(tags ? `${m.name}  (${tags})` : m.name);
    });

    if (lobby) {
      const host = !!me?.host;
      const room = MAX_PLAYERS - lobby.members.length;
      this.modeLabel.setText(host ? "Mode" : `Mode: ${modeName(lobby.mode)} (the host picks)`);
      this.modeButtons.forEach((b, i) => {
        setButtonVisible(b, host);
        setButtonStyle(b, MODES[i].id === lobby.mode ? PRIMARY : SECONDARY);
      });
      this.botsLabel.setText(host ? "Bots" : `Bots: ${lobby.bots} (the host picks)`);
      this.botButtons.forEach((b, n) => {
        setButtonVisible(b, host && n <= room);
        setButtonStyle(b, n === lobby.bots ? PRIMARY : SECONDARY);
      });
      this.startButton.label.setText(host ? "Start" : "Waiting for host");
      this.startButton.rect.setAlpha(host ? 1 : 0.4);
    }
    this.layout(this.scale.gameSize);
  }

  /** A centred panel; rows of equal-width buttons fill its width. */
  private layout({ width, height }: Phaser.Structs.Size) {
    const lobby = this.online.inRoom ? this.online.lobby : null;
    const pw = Math.min(460, width - PAD * 2);
    const inner = pw - 64;
    const indent = this.online.connected ? 0 : SPINNER_INDENT;
    this.status.setWordWrapWidth(inner - indent);
    this.errorText.setWordWrapWidth(inner);
    const errorH = this.error ? this.errorText.height + 16 : 0;
    const botsShown = this.botButtons.some((b) => b.rect.visible);
    const modesShown = this.modeButtons.some((b) => b.rect.visible);

    const head = 32 + this.title.height + 8 + this.status.height + 24;
    const colors = 24 + BTN_H + 24;
    const body = lobby
      ? BTN_H + 24 + 24 + lobby.members.length * MEMBER_ROW_H + 16 + 24 + (modesShown ? BTN_H + 24 : 8) + colors + 24 + (botsShown ? BTN_H + 24 : 0)
      : 24 + BTN_H + 24 + colors + BTN_H + 28 + 24 + BTN_H + 24;
    const ph = head + body + errorH + BTN_H + 32;
    const px = (width - pw) / 2;
    const py = Math.max(PAD, (height - ph) / 2);
    const x = px + 32;
    this.panel.setPosition(px, py).setSize(pw, ph);

    let y = py + 32;
    this.title.setPosition(x, y);
    y += this.title.height + 8;
    this.status.setPosition(x + indent, y);
    this.statusSpinner.setVisible(!this.online.connected).setPosition(x + SPINNER_SIZE / 2, y + 9);
    y += this.status.height + 24;

    const placeColors = () => {
      this.colorLabel.setPosition(x, y);
      y += 24;
      this.layoutRow(this.swatches, x, y, inner);
      y += BTN_H + 24;
    };

    if (lobby) {
      // [ ABCDE ] [Copy]
      this.roomCode.setPosition(x, y);
      (this.roomCode.node as HTMLInputElement).style.width = `${inner - COPY_W - GAP}px`;
      layoutButton(this.copyButton, x + inner - COPY_W, y, COPY_W);
      y += BTN_H + 24;
      this.membersLabel.setPosition(x, y);
      y += 24;
      lobby.members.forEach((_, i) => {
        this.memberSwatches[i].setPosition(x, y + 3);
        this.memberTexts[i].setPosition(x + SWATCH + 10, y);
        y += MEMBER_ROW_H;
      });
      y += 16;
      this.modeLabel.setPosition(x, y);
      y += 24;
      if (modesShown) {
        this.layoutRow(this.modeButtons, x, y, inner);
        y += BTN_H + 24;
      } else y += 8;
      placeColors();
      this.botsLabel.setPosition(x, y);
      y += 24;
      if (botsShown) {
        this.layoutRow(this.botButtons.filter((b) => b.rect.visible), x, y, inner);
        y += BTN_H + 24;
      }
    } else {
      this.nameLabel.setPosition(x, y);
      y += 24;
      this.nameInput.setPosition(x, y);
      (this.nameInput.node as HTMLInputElement).style.width = `${inner}px`;
      y += BTN_H + 24;
      placeColors();
      layoutButton(this.createButton, x, y, inner);
      y += BTN_H + 28;
      this.codeLabel.setPosition(x, y);
      y += 24;
      const joinW = 120;
      this.codeInput.setPosition(x, y);
      (this.codeInput.node as HTMLInputElement).style.width = `${inner - joinW - GAP}px`;
      layoutButton(this.joinButton, x + inner - joinW, y, joinW);
      y += BTN_H + 24;
    }

    if (this.error) {
      this.errorText.setPosition(x, y);
      y += this.errorText.height + 16;
    }
    this.layoutRow(lobby ? [this.leaveButton, this.startButton] : [this.backButton], x, y, inner);
  }

  private layoutRow(buttons: Button[], x: number, y: number, w: number) {
    const bw = (w - GAP * (buttons.length - 1)) / buttons.length;
    buttons.forEach((b, i) => layoutButton(b, x + i * (bw + GAP), y, bw));
  }
}

