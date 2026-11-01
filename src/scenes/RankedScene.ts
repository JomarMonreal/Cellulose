import * as Phaser from "phaser";
import { type Mode, MODES } from "../modes";
import Online from "../net/Online";
import type { MatchKind } from "../net/protocol";
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
} from "../ui";

const PAD = 24;
const GAP = 12;
const MODE_KEY = "cellulose:rankedMode";

/**
 * Public matchmaking, ranked or classic. Ranked shows your rating and tier in each mode and needs an account;
 * classic is the same 4-player match with nothing at stake, open to guests. While waiting you can play with
 * bots; the game switches to the match once it's found. Signing out goes back to the sign-in screen.
 */
export default class RankedScene extends Phaser.Scene {
  constructor() {
    super("RankedScene");
  }

  private online!: Online;
  private kind!: MatchKind;
  private mode!: Mode;
  private error!: string;
  // a request is on its way; ignore clicks until it's answered
  private busy!: boolean;

  private panel!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private statusSpinner!: Phaser.GameObjects.Graphics;
  private errorText!: Phaser.GameObjects.Text;
  private backButton!: Button;
  private logoutText!: Phaser.GameObjects.Text;
  private ratings!: Phaser.GameObjects.Text;
  private modeLabel!: Phaser.GameObjects.Text;
  private modeButtons!: Button[];
  private findButton!: Button;
  private queueText!: Phaser.GameObjects.Text;
  private queueSpinner!: Phaser.GameObjects.Graphics;
  private botsButton!: Button;

  init(data: { error?: string; kind?: MatchKind }) {
    this.online = Online.get();
    this.kind = data?.kind ?? "ranked";
    const saved = localStorage.getItem(MODE_KEY);
    this.mode = MODES.some((m) => m.id === saved) ? (saved as Mode) : "strongest500";
    this.error = data?.error ?? "";
    this.busy = false;
  }

  /** Ranked needs an account; classic just needs someone playing (a guest will do). */
  private get allowed() {
    return this.kind === "ranked" ? !!this.online.profile : !!this.online.player;
  }

  create() {
    if (!this.allowed) return this.scene.start("AuthScene", this.kind === "ranked" ? { message: "Sign in to play ranked.", then: "RankedScene" } : undefined);
    const font = fontFamily();
    const display = displayFont();
    const labelStyle = { fontFamily: display, fontSize: "16px", fontStyle: "bold", color: "#d4ccff" };

    this.panel = this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0);
    this.title = this.add.text(0, 0, this.kind === "ranked" ? "Ranked" : "Classic", {
      fontFamily: display,
      fontSize: "32px",
      fontStyle: "bold",
      color: "#f8f5ff",
    });
    this.status = this.add.text(0, 0, "", { fontFamily: font, fontSize: "14px", color: "#d4ccff" });
    this.statusSpinner = makeSpinner(this);
    this.errorText = this.add.text(0, 0, "", { fontFamily: font, fontSize: "15px", fontStyle: "bold", color: "#ff4d5e" });
    this.backButton = makeButton(this, "Back", SECONDARY, () => this.scene.start("HomeScene"));

    this.logoutText = this.add
      .text(0, 0, "Log out", { fontFamily: display, fontSize: "15px", fontStyle: "bold", color: "#d4ccff" })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.logoutText.setColor("#ffe03d"))
      .on("pointerout", () => this.logoutText.setColor("#d4ccff"))
      .on("pointerdown", () => {
        if (this.busy) return;
        this.logoutText.setText("Logging out…");
        void this.send(() => this.online.logout());
      });
    this.ratings = this.add.text(0, 0, "", { fontFamily: font, fontSize: "15px", color: "#f8f5ff", lineSpacing: 6 });
    this.modeLabel = this.add.text(0, 0, "Mode", labelStyle);
    this.modeButtons = MODES.map((m) => makeButton(this, m.name, SECONDARY, () => this.pickMode(m.id)));
    for (const b of this.modeButtons) b.label.setFontSize(17);
    this.findButton = makeButton(this, "Find match", PRIMARY, () => this.toggleQueue());
    this.queueText = this.add.text(0, 0, "", { fontFamily: font, fontSize: "15px", fontStyle: "bold", color: "#ffe03d" });
    this.queueSpinner = makeSpinner(this, SPINNER_SIZE, 0xffe03d);
    this.botsButton = makeButton(this, "Play with bots while you wait", SECONDARY, () =>
      this.scene.start("LobbyScene", { mode: this.mode }),
    );
    this.botsButton.label.setFontSize(17);

    // only signed-in players have something to log out of
    this.logoutText.setVisible(!!this.online.profile);
    this.ratings.setVisible(this.kind === "ranked");

    const onClosed = (reason: string) => this.showError(reason);
    const onAuth = () => (this.allowed ? this.refresh() : this.scene.start("AuthScene"));
    this.online.on("status", this.refresh, this).on("auth", onAuth).on("queue", this.refresh, this).on("closed", onClosed);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.online.off("status", this.refresh, this).off("auth", onAuth).off("queue", this.refresh, this).off("closed", onClosed);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    // the queue's wait time ticks over every second
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.online.queue && this.refresh() });

    if (this.online.profile) void this.online.refreshProfile();
    this.refresh();
  }

  private pickMode(mode: Mode) {
    // switching modes mid-search would mean a different queue; cancel first
    if (this.online.queue) return;
    this.mode = mode;
    localStorage.setItem(MODE_KEY, mode);
    this.refresh();
  }

  private toggleQueue() {
    this.send(() => (this.online.queue ? this.online.cancelQueue() : this.online.findMatch(this.kind, this.mode)), this.findButton);
  }

  /** Send a request, with a spinner on the button that sent it if any, showing its refusal if there is one. */
  private async send(request: () => Promise<{ ok: boolean; reason?: string }>, button?: Button) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    if (button) setButtonLoading(button, true);
    const r = await request();
    this.busy = false;
    if (!this.scene.isActive()) return;
    if (button) setButtonLoading(button, false);
    if (!r.ok) this.error = r.reason ?? "Something went wrong";
    this.refresh();
  }

  private showError(message: string) {
    this.error = message;
    this.refresh();
  }

  /** "1012 · Genus · 88 to Family" for a rating, from the tiers the server sent. */
  private describe(rating: number, tier: string) {
    const next = this.online.tiers.find((t) => t.minRating > rating);
    return next ? `${rating} · ${tier} · ${next.minRating - rating} to ${next.name}` : `${rating} · ${tier} · top tier`;
  }

  private refresh() {
    const { online } = this;
    const profile = online.profile;
    const queue = online.queue;
    // signed out: the "auth" handler is already on its way to the sign-in screen
    if (!this.allowed) return;

    this.status.setText(online.connectionStatus ?? (profile ? `Signed in as ${profile.username}` : `Playing as ${online.guest} (guest)`));
    this.errorText.setText(this.error);
    setButtonVisible(this.botsButton, !!queue);

    if (profile && this.kind === "ranked") {
      this.ratings.setText(
        MODES.map((m) => {
          const games = profile.games[m.id];
          return `${m.name}: ${this.describe(profile.rating[m.id], profile.tier[m.id])}\n      ${games} game${games === 1 ? "" : "s"}, ${profile.wins[m.id]} won`;
        }).join("\n"),
      );
    }
    this.modeButtons.forEach((b, i) => {
      setButtonStyle(b, MODES[i].id === this.mode ? PRIMARY : SECONDARY);
      b.rect.setAlpha(queue && MODES[i].id !== queue.mode ? 0.4 : 1);
    });
    this.findButton.label.setText(queue ? "Cancel search" : "Find match");
    setButtonStyle(this.findButton, queue ? SECONDARY : PRIMARY);
    if (queue) {
      const secs = Math.floor((Date.now() - queue.since) / 1000);
      // a search started on the other screen (ranked vs classic) still shows here, so it can be cancelled
      const which = queue.kind === this.kind ? "Searching" : `Searching for ${queue.kind}`;
      this.queueText.setText(`${which}: ${queue.waiting}/${queue.needed} players · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`);
    } else {
      this.queueText.setText(
        this.kind === "ranked" ? "Free-for-all against other ranked players." : "Free-for-all against other players. No ratings at stake.",
      );
    }
    this.layout(this.scale.gameSize);
  }

  /** A centred panel; rows of equal-width buttons fill its width. */
  private layout({ width, height }: Phaser.Structs.Size) {
    const queued = !!this.online.queue;
    const connected = this.online.connected;
    const pw = Math.min(480, width - PAD * 2);
    const inner = pw - 64;
    for (const t of [this.errorText, this.ratings]) t.setWordWrapWidth(inner);
    this.status.setWordWrapWidth(inner - (connected ? 0 : SPINNER_INDENT));
    this.queueText.setWordWrapWidth(inner - (queued ? SPINNER_INDENT : 0));
    const errorH = this.error ? this.errorText.height + 16 : 0;

    const head = 32 + this.title.height + 8 + this.status.height + 24;
    const ratingsH = this.ratings.visible ? this.ratings.height + 24 : 0;
    const body = ratingsH + 24 + BTN_H + 24 + BTN_H + 12 + this.queueText.height + 24 + (queued ? BTN_H + 24 : 0);
    const ph = head + body + errorH + BTN_H + 32;
    fitHeight(this, ph + PAD * 2);
    const px = (width - pw) / 2;
    const py = Math.max(PAD, (height - ph) / 2);
    const x = px + 32;
    this.panel.setPosition(px, py).setSize(pw, ph);

    let y = py + 32;
    this.title.setPosition(x, y);
    this.logoutText.setPosition(x + inner, y + 12);
    y += this.title.height + 8;
    this.status.setPosition(x + (connected ? 0 : SPINNER_INDENT), y);
    this.statusSpinner.setVisible(!connected).setPosition(x + SPINNER_SIZE / 2, y + 9);
    y += this.status.height + 24;

    this.ratings.setPosition(x, y);
    y += ratingsH;
    this.modeLabel.setPosition(x, y);
    y += 24;
    this.layoutRow(this.modeButtons, x, y, inner);
    y += BTN_H + 24;
    layoutButton(this.findButton, x, y, inner);
    y += BTN_H + 12;
    this.queueText.setPosition(x + (queued ? SPINNER_INDENT : 0), y);
    this.queueSpinner.setVisible(queued).setPosition(x + SPINNER_SIZE / 2, y + 10);
    y += this.queueText.height + 24;
    if (queued) {
      layoutButton(this.botsButton, x, y, inner);
      y += BTN_H + 24;
    }

    if (this.error) {
      this.errorText.setPosition(x, y);
      y += this.errorText.height + 16;
    }
    layoutButton(this.backButton, x, y, inner);
  }

  private layoutRow(buttons: Button[], x: number, y: number, w: number) {
    const bw = (w - GAP * (buttons.length - 1)) / buttons.length;
    buttons.forEach((b, i) => layoutButton(b, x + i * (bw + GAP), y, bw));
  }
}
