import * as Phaser from "phaser";
import { MODES, modeName } from "../modes";
import ChatBox from "../net/ChatBox";
import Online from "../net/Online";
import { PALETTE } from "../Player";
import {
  BTN_H,
  type Button,
  displayFont,
  fitHeight,
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
// the chat sits beside the panel when there's room for it, otherwise below it at this height
const CHAT_W = 340;
const CHAT_GAP = 16;
const CHAT_NARROW_H = 300;
// the rivals' placements setting: shown, then hidden
const SETUP_CHOICES = [
  { label: "Shown", hide: false },
  { label: "Hidden", hide: true },
];
// the ? beside that setting, and the explanation it shows
const HELP_R = 9;
const TIP_W = 300;
const TIP_PAD = 12;
const SETUP_HELP =
  "Hidden: during each placement window you only see your own new cells. Rivals' new cells appear when the window " +
  "ends, so nobody can copy or counter your setup as you build it.\n\nShown: everyone sees every cell the moment it's placed.";

/**
 * Online setup. Before joining: your name and colour, then create a room or join one by its code.
 * In a room: who's there and who's ready, the host's settings (mode, bots, whether rivals' placements show), your
 * colour, the room's chat, and Ready (or, for the host, Start). Joining while a game runs waits here for the next
 * one. The game scene takes over once the server starts a game with you in it.
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
  private setupLabel!: Phaser.GameObjects.Text;
  private setupButtons!: Button[];
  // the ? beside "Rivals' placements": hover (or tap) for what it means
  private setupHelp!: Phaser.GameObjects.Text;
  private setupHelpRing!: Phaser.GameObjects.Graphics;
  private tipBg!: Phaser.GameObjects.Rectangle;
  private tipText!: Phaser.GameObjects.Text;
  private tipOpen = false;
  private leaveButton!: Button;
  // Start for the host; Ready / Unready for everyone else
  private startButton!: Button;
  private chatPanel!: Phaser.GameObjects.Rectangle;
  private chat!: Phaser.GameObjects.DOMElement;
  private chatBox!: ChatBox;

  /** Coming back from a game keeps the room; a fresh visit starts at "create or join". */
  init(data: { error?: string }) {
    this.online = Online.get();
    this.color = this.online.me?.color ?? 0;
    this.error = data.error ?? "";
    this.busy = false;
  }

  create() {
    const font = fontFamily();
    const display = displayFont();
    const labelStyle = { fontFamily: display, fontSize: "16px", fontStyle: "bold", color: "#d4ccff" };

    this.panel = this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0);
    this.title = this.add.text(0, 0, "", { fontFamily: display, fontSize: "32px", fontStyle: "bold", color: "#f8f5ff" });
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
    this.setupLabel = this.add.text(0, 0, "", labelStyle);
    this.setupButtons = SETUP_CHOICES.map(({ label, hide }, i) =>
      makeButton(this, label, SECONDARY, () => this.send(() => this.online.setHideSetup(hide), this.setupButtons[i])),
    );
    this.setupHelpRing = this.add.graphics();
    this.setupHelp = this.add
      .text(0, 0, "?", { fontFamily: display, fontSize: "14px", fontStyle: "bold", color: "#120e22" })
      .setOrigin(0.5)
      .setPadding(4)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", (p: Phaser.Input.Pointer) => !p.wasTouch && this.showTip(true))
      .on("pointerout", (p: Phaser.Input.Pointer) => !p.wasTouch && this.showTip(false))
      // touch has no hover: a tap opens it, and another tap (anywhere) closes it
      .on("pointerdown", (p: Phaser.Input.Pointer) => p.wasTouch && this.showTip(!this.tipOpen));
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (this.tipOpen && !over.includes(this.setupHelp)) this.showTip(false);
    });
    this.tipBg = this.add.rectangle(0, 0, TIP_W, 1, 0x2b2448).setOrigin(0).setStrokeStyle(2, 0x5b4b9a).setDepth(10);
    this.tipText = this.add
      .text(0, 0, SETUP_HELP, { fontFamily: font, fontSize: "13px", color: "#f8f5ff", lineSpacing: 3, wordWrap: { width: TIP_W - TIP_PAD * 2 } })
      .setDepth(10);
    this.showTip(false);
    this.leaveButton = makeButton(this, "Leave", SECONDARY, () => this.send(() => this.online.leave(), this.leaveButton));
    // silent: the game starting plays the confirmation, for everyone in the room
    this.startButton = makeButton(this, "Start", PRIMARY, () => this.startOrReady(), null);

    // the room's chat, the same one the game shows
    this.chatPanel = this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0);
    this.chatBox = new ChatBox(this.online, (reason) => this.scene.isActive() && this.showError(reason), "No messages yet. Say hi while you wait!");
    // in its own panel the divider the game's sidebar needs is just a stray line
    (this.chatBox.element.firstElementChild as HTMLElement).style.borderTop = "none";
    this.chat = this.add.dom(0, 0, this.chatBox.element).setOrigin(0);

    // the server pushes changes; redraw on each, and hand over to the game once it starts with us in it
    const inGame = () => this.online.lobby?.status === "playing" && this.online.seat >= 0;
    const onState = () => inGame() && this.scene.start("GameScene", { online: true });
    const onClosed = (reason: string) => {
      this.error = reason;
      this.refresh();
    };
    this.online
      .on("status", this.refresh, this)
      .on("lobby", this.refresh, this)
      .on("state", onState)
      .on("closed", onClosed)
      .on("chat", this.chatBox.render, this.chatBox);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.online
        .off("status", this.refresh, this)
        .off("lobby", this.refresh, this)
        .off("state", onState)
        .off("closed", onClosed)
        .off("chat", this.chatBox.render, this.chatBox);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);

    // e.g. a refreshed page that rejoined a running game
    if (this.online.state && inGame()) return void onState();
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

  /** The host starts the game; everyone else says whether they're ready for it. */
  private startOrReady() {
    const me = this.online.me;
    if (!me) return;
    if (me.host) {
      if (this.online.lobby?.status !== "playing") this.send(() => this.online.start(), this.startButton);
    } else this.send(() => this.online.setReady(!me.ready), this.startButton);
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

  private showTip(open: boolean) {
    this.tipOpen = open;
    this.tipBg.setVisible(open);
    this.tipText.setVisible(open);
    this.setupHelpRing.setAlpha(open ? 1 : 0.8);
  }

  private showError(message: string) {
    this.error = message;
    this.refresh();
  }

  /** What the status line says in a room: who we're waiting for, or how to get friends in. */
  private roomStatus(): string {
    const { lobby, me } = this.online;
    if (!lobby || !me) return "";
    if (lobby.status === "playing") return `A game is in progress. You'll play in the next one${me.host ? "." : "; ready up while you wait."}`;
    const unready = lobby.members.filter((m) => !m.host && m.connected && !m.ready).map((m) => (m === me ? "you" : m.name));
    if (unready.length) return `Waiting for ${unready.join(", ")} to be ready. Share the room code so friends can join.`;
    if (lobby.members.length > 1) return me.host ? "Everyone's ready. Start when you like!" : "Everyone's ready. Waiting for the host to start.";
    return "Share the room code so friends can join.";
  }

  /** Show whichever view applies, filled in from the latest lobby. */
  private refresh() {
    const { online } = this;
    const lobby = online.inRoom ? online.lobby : null;
    const me = online.me;
    const playing = lobby?.status === "playing";

    this.title.setText(lobby ? "Your room" : "Play with friends");
    if (lobby) (this.roomCode.node as HTMLInputElement).value = lobby.roomId;
    this.status.setText(online.connectionStatus ?? (lobby ? this.roomStatus() : `Connected online`));
    this.errorText.setText(this.error);

    const pre = [this.nameLabel, this.nameInput, this.codeLabel, this.codeInput];
    for (const o of pre) o.setVisible(!lobby);
    for (const b of [this.createButton, this.joinButton, this.backButton]) setButtonVisible(b, !lobby);
    const inRoom = [this.roomCode, this.membersLabel, this.modeLabel, this.botsLabel, this.setupLabel, this.setupHelp, this.setupHelpRing, this.chatPanel, this.chat];
    for (const o of inRoom) o.setVisible(!!lobby);
    if (!lobby) this.showTip(false);
    for (const b of [this.copyButton, ...this.modeButtons, ...this.botButtons, ...this.setupButtons, this.leaveButton, this.startButton]) {
      setButtonVisible(b, !!lobby);
    }
    if (!lobby) this.chatBox.blur();
    else this.chatBox.render();

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
      // mid-game: who's playing and who's waiting here; otherwise who's ready (the host starts instead)
      const state = playing ? (m.seat >= 0 ? "playing" : m.ready ? "waiting, ready" : "waiting") : !m.host && (m.ready ? "ready" : "not ready");
      const tags = [m === me && "you", m.host && "host", state, !m.connected && "offline"].filter(Boolean).join(", ");
      this.memberTexts[i].setText(tags ? `${m.name}  (${tags})` : m.name);
      this.memberTexts[i].setColor(!playing && !m.host && m.ready ? "#3ddc84" : "#f8f5ff");
    });

    if (lobby) {
      const host = !!me?.host;
      // settings can't change while a game runs, so the host's buttons wait until it's over
      const edit = host && !playing;
      const room = MAX_PLAYERS - lobby.members.length;
      const by = host ? "" : " (the host picks)";
      this.modeLabel.setText(edit ? "Mode" : `Mode: ${modeName(lobby.mode)}${by}`);
      this.modeButtons.forEach((b, i) => {
        setButtonVisible(b, edit);
        setButtonStyle(b, MODES[i].id === lobby.mode ? PRIMARY : SECONDARY);
      });
      this.botsLabel.setText(edit ? "Bots" : `Bots: ${lobby.bots}${by}`);
      this.botButtons.forEach((b, n) => {
        setButtonVisible(b, edit && n <= room);
        setButtonStyle(b, n === lobby.bots ? PRIMARY : SECONDARY);
      });
      this.setupLabel.setText(edit ? "Rivals' placements" : `Rivals' placements: ${lobby.hideSetup ? "hidden" : "shown"}${by}`);
      this.setupButtons.forEach((b, i) => {
        setButtonVisible(b, edit);
        setButtonStyle(b, SETUP_CHOICES[i].hide === lobby.hideSetup ? PRIMARY : SECONDARY);
      });

      // the host's Start is dimmed until everyone else is ready; the others toggle Ready
      let label: string;
      let active = true;
      if (host) {
        const allReady = lobby.members.every((m) => m.host || !m.connected || m.ready);
        label = playing ? "Game in progress" : "Start";
        active = !playing && allReady;
      } else label = me?.ready ? "Unready" : "Ready";
      this.startButton.label.setText(label);
      setButtonStyle(this.startButton, host || !me?.ready ? PRIMARY : SECONDARY);
      this.startButton.rect.setAlpha(active ? 1 : 0.4);
    }
    this.layout(this.scale.gameSize);
  }

  /**
   * A centred panel; rows of equal-width buttons fill its width. In a room the chat sits beside the panel when
   * there's room, otherwise below it.
   */
  private layout({ width, height }: Phaser.Structs.Size) {
    const lobby = this.online.inRoom ? this.online.lobby : null;
    const pw = Math.min(460, width - PAD * 2);
    const inner = pw - 64;
    const indent = this.online.connected ? 0 : SPINNER_INDENT;
    this.status.setWordWrapWidth(inner - indent);
    this.errorText.setWordWrapWidth(inner);

    // measure first (the panel's height decides where it's centred), then place for real
    const ph = this.placeContents(0, 0, inner, indent) + 64;
    const wide = !!lobby && width >= pw + CHAT_GAP + CHAT_W + PAD * 2;
    const chatH = !lobby ? 0 : wide ? ph : CHAT_NARROW_H;
    const totalW = wide ? pw + CHAT_GAP + CHAT_W : pw;
    const totalH = wide || !lobby ? ph : ph + CHAT_GAP + chatH;
    fitHeight(this, totalH + PAD * 2);
    const px = (width - totalW) / 2;
    const py = Math.max(PAD, (height - totalH) / 2);
    this.panel.setPosition(px, py).setSize(pw, ph);
    this.placeContents(px + 32, py + 32, inner, indent);

    if (!lobby) return;
    const [cx, cy, cw] = wide ? [px + pw + CHAT_GAP, py, CHAT_W] : [px, py + ph + CHAT_GAP, pw];
    this.chatPanel.setPosition(cx, cy).setSize(cw, chatH);
    // the chat brings its own top padding
    this.chat.setPosition(cx + 20, cy + 18);
    Object.assign((this.chat.node as HTMLElement).style, { width: `${cw - 40}px`, height: `${chatH - 38}px` });
  }

  /** Place the panel's contents from (x, y), `inner` wide. Returns the bottom of the last row, relative to y. */
  private placeContents(x: number, top: number, inner: number, indent: number): number {
    const lobby = this.online.inRoom ? this.online.lobby : null;
    let y = top;
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
    // a label, then its buttons if any are showing (the host's), otherwise just a little space
    const placeSetting = (label: Phaser.GameObjects.Text, buttons: Button[], reserve = 0) => {
      // "Rivals' placements: hidden (the host picks)" can be wider than a phone's panel
      label.setWordWrapWidth(inner - reserve).setPosition(x, y);
      y += Math.max(24, label.height + 6);
      const shown = buttons.filter((b) => b.rect.visible);
      if (shown.length) {
        this.layoutRow(shown, x, y, inner);
        y += BTN_H + 24;
      } else y += 8;
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
      // the ? sits at the end of the label's first line; leave room for it so the label wraps before it
      const helpW = HELP_R * 2 + 10;
      const labelY = y;
      placeSetting(this.setupLabel, this.setupButtons, helpW);
      this.placeHelp(x + this.setupLabel.width + 8 + HELP_R, labelY + 10, x, inner);
      placeSetting(this.modeLabel, this.modeButtons);
      placeColors();
      placeSetting(this.botsLabel, this.botButtons);
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
    return y + BTN_H - top;
  }

  /** The ? centred on (cx, cy), and its tooltip under it, kept inside the panel's inner width from `left`. */
  private placeHelp(cx: number, cy: number, left: number, inner: number) {
    this.setupHelpRing.clear().fillStyle(0xd4ccff).fillCircle(cx, cy, HELP_R);
    this.setupHelp.setPosition(cx, cy + 1);
    const w = Math.min(TIP_W, inner);
    this.tipText.setWordWrapWidth(w - TIP_PAD * 2);
    const tx = Math.min(Math.max(left, cx - w / 2), left + inner - w);
    const ty = cy + HELP_R + 8;
    this.tipBg.setPosition(tx, ty).setSize(w, this.tipText.height + TIP_PAD * 2);
    this.tipText.setPosition(tx + TIP_PAD, ty + TIP_PAD);
  }

  private layoutRow(buttons: Button[], x: number, y: number, w: number) {
    const bw = (w - GAP * (buttons.length - 1)) / buttons.length;
    buttons.forEach((b, i) => layoutButton(b, x + i * (bw + GAP), y, bw));
  }
}
