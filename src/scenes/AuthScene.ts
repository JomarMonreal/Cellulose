import * as Phaser from "phaser";
import Online from "../net/Online";
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
  textInput,
} from "../ui";

const PAD = 24;
const GAP = 12;
const LOGO_GAP = 24;

/**
 * The first screen: log in, sign up, or play as a guest (everything but ranked). A sign-in saved from an
 * earlier visit is resumed as soon as the server connects, and any sign-in goes straight on to the home
 * screen, or to `then` when another screen sent us here (e.g. a guest choosing ranked).
 */
export default class AuthScene extends Phaser.Scene {
  constructor() {
    super("AuthScene");
  }

  private online!: Online;
  private error!: string;
  // a request is on its way; ignore clicks until it's answered
  private busy!: boolean;

  private logo!: Phaser.GameObjects.Image;
  private panel!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private statusSpinner!: Phaser.GameObjects.Graphics;
  private errorText!: Phaser.GameObjects.Text;
  private userLabel!: Phaser.GameObjects.Text;
  private userInput!: Phaser.GameObjects.DOMElement;
  private passLabel!: Phaser.GameObjects.Text;
  private passInput!: Phaser.GameObjects.DOMElement;
  private loginButton!: Button;
  private signupButton!: Button;
  private guestButton!: Button;
  /** Why sign-in was asked for, shown in place of the usual prompt. */
  private message!: string | undefined;
  /** Where a sign-in goes next. Playing as a guest always goes home, since `then` may need an account. */
  private then!: string;

  init(data?: { message?: string; then?: string }) {
    this.online = Online.get();
    this.error = "";
    this.busy = false;
    this.message = data?.message;
    this.then = data?.then ?? "HomeScene";
  }

  /** Signed in, or chose to play as a guest: move on. */
  private next() {
    if (this.online.profile) this.scene.start(this.then);
    else if (this.online.guest) this.scene.start("HomeScene");
  }

  preload() {
    this.load.image("logo", "logo.png");
  }

  create() {
    if (this.online.player) return this.next();

    const font = fontFamily();
    const display = displayFont();
    const labelStyle = { fontFamily: display, fontSize: "16px", fontStyle: "bold", color: "#d4ccff" };

    this.logo = this.add.image(0, 0, "logo").setOrigin(0.5, 0);
    this.panel = this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0);
    this.title = this.add.text(0, 0, "Sign in to play", { fontFamily: display, fontSize: "32px", fontStyle: "bold", color: "#f8f5ff" });
    this.status = this.add.text(0, 0, "", { fontFamily: font, fontSize: "14px", color: "#d4ccff" });
    this.statusSpinner = makeSpinner(this);
    this.errorText = this.add.text(0, 0, "", { fontFamily: font, fontSize: "15px", fontStyle: "bold", color: "#ff4d5e" });

    this.userLabel = this.add.text(0, 0, "Username", labelStyle);
    // the labels above say what each field is, so the placeholders don't repeat it
    const user = textInput(font, "Username", 20);
    user.placeholder = "";
    // let password managers recognise the form, and keep phones from capitalising usernames
    Object.assign(user, { autocomplete: "username", autocapitalize: "none", spellcheck: false });
    user.addEventListener("keydown", (e) => e.key === "Enter" && pass.focus());
    this.userInput = this.add.dom(0, 0, user).setOrigin(0);
    this.passLabel = this.add.text(0, 0, "Password", labelStyle);
    const pass = textInput(font, "Password", 72, "", "password");
    pass.placeholder = "";
    pass.autocomplete = "current-password";
    pass.addEventListener("keydown", (e) => e.key === "Enter" && this.auth("login"));
    this.passInput = this.add.dom(0, 0, pass).setOrigin(0);
    this.loginButton = makeButton(this, "Log in", PRIMARY, () => this.auth("login"));
    this.signupButton = makeButton(this, "Sign up", SECONDARY, () => this.auth("signup"));
    // no account needed, and no server either for playing with bots
    this.guestButton = makeButton(this, "Play as guest", SECONDARY, () => !this.busy && this.online.playAsGuest());

    const onAuth = () => (this.online.player ? this.next() : this.refresh());
    this.online.on("status", this.refresh, this).on("auth", onAuth);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.online.off("status", this.refresh, this).off("auth", onAuth);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.refresh();
    // ready to type, unless a saved sign-in is about to skip this screen
    if (!this.online.hasSession) user.focus();
  }

  private async auth(kind: "login" | "signup") {
    if (this.busy) return;
    const username = (this.userInput.node as HTMLInputElement).value.trim();
    const password = (this.passInput.node as HTMLInputElement).value;
    if (!username || !password) return this.showError("Enter a username and password");
    this.busy = true;
    this.error = "";
    const button = kind === "login" ? this.loginButton : this.signupButton;
    setButtonLoading(button, true);
    // tells password managers whether to fill a saved password or offer to save a new one
    (this.passInput.node as HTMLInputElement).autocomplete = kind === "login" ? "current-password" : "new-password";
    const r = await (kind === "login" ? this.online.login(username, password) : this.online.signup(username, password));
    this.busy = false;
    if (this.scene.isActive()) setButtonLoading(button, false);
    // a success has already moved on to the home screen
    if (!r.ok && this.scene.isActive()) this.showError(r.reason ?? "Something went wrong");
  }

  private showError(message: string) {
    this.error = message;
    this.refresh();
  }

  /** Still connecting, or resuming a saved sign-in. */
  private get loading() {
    return !this.online.connected || this.online.hasSession;
  }

  private refresh() {
    const { online } = this;
    this.status.setText(
      online.connectionStatus ?? (online.hasSession ? "Signing you back in…" : (this.message ?? "Log in, or sign up for a new account.")),
    );
    this.errorText.setText(this.error);
    this.layout(this.scale.gameSize);
  }

  /** The logo over a centred panel holding the form; the logo shrinks on short or narrow screens. */
  private layout({ width, height }: Phaser.Structs.Size) {
    const pw = Math.min(480, width - PAD * 2);
    const inner = pw - 64;
    const indent = this.loading ? SPINNER_INDENT : 0;
    this.status.setWordWrapWidth(inner - indent);
    this.errorText.setWordWrapWidth(inner);
    const errorH = this.error ? this.errorText.height + 16 : 0;

    const ph = 32 + this.title.height + 8 + this.status.height + 24 + (24 + BTN_H + 24) * 2 + BTN_H + GAP + BTN_H + errorH + 32;
    // the logo only shows if there's room; the panel always has to fit
    fitHeight(this, ph + PAD * 2);
    const logoH = Phaser.Math.Clamp(Math.min(height - ph - PAD * 2 - LOGO_GAP, width * 0.4), 0, 160);
    this.logo.setVisible(logoH >= 48).setDisplaySize(logoH * (this.logo.width / this.logo.height), logoH);
    const totalH = ph + (this.logo.visible ? logoH + LOGO_GAP : 0);

    let y = Math.max(PAD, (height - totalH) / 2);
    if (this.logo.visible) {
      this.logo.setPosition(width / 2, y);
      y += logoH + LOGO_GAP;
    }
    const px = (width - pw) / 2;
    const x = px + 32;
    this.panel.setPosition(px, y).setSize(pw, ph);

    y += 32;
    this.title.setPosition(x, y);
    y += this.title.height + 8;
    this.status.setPosition(x + indent, y);
    this.statusSpinner.setVisible(this.loading).setPosition(x + SPINNER_SIZE / 2, y + 9);
    y += this.status.height + 24;
    for (const [label, input] of [
      [this.userLabel, this.userInput],
      [this.passLabel, this.passInput],
    ] as const) {
      label.setPosition(x, y);
      y += 24;
      input.setPosition(x, y);
      (input.node as HTMLInputElement).style.width = `${inner}px`;
      y += BTN_H + 24;
    }
    const bw = (inner - GAP) / 2;
    layoutButton(this.loginButton, x, y, bw);
    layoutButton(this.signupButton, x + bw + GAP, y, bw);
    y += BTN_H + GAP;
    layoutButton(this.guestButton, x, y, inner);
    y += BTN_H + 16;
    if (this.error) this.errorText.setPosition(x, y);
  }
}
