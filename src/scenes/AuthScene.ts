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
  type ButtonStyle,
} from "../ui";

const PAD = 24;
const GAP = 12;
const LOGO_GAP = 24;
// ways to support the game: PayPal opens in a new tab; GCash and Maya show their QR cards to scan
const PAYPAL_URL = "https://paypal.me/JomarMonreal";
// under the donate buttons, for questions about the game; clicking it opens the player's mail app
const CONTACT_EMAIL = "noromon2035@gmail.com";
// PayPal's mark, from Simple Icons (public/paypal.svg)
const PAYPAL_LOGO = "paypal-logo";
/**
 * The QR cards in public/, each with where its app's round logo sits on the card (a circle in that square, in the
 * image's own pixels), cut out for the button's icon.
 */
const QR_CARDS = {
  gcash: { label: "GCash", file: "gcash.jpg", logo: { x: 95, y: 50, size: 155 } },
  maya: { label: "Maya", file: "maya.jpg", logo: { x: 455, y: 35, size: 170 } },
} as const;
type QrCard = keyof typeof QR_CARDS;
const QR_ORDER: QrCard[] = ["gcash", "maya"];
const qrKey = (card: QrCard) => `${card}-qr`;
const logoKey = (card: QrCard) => `${card}-logo`;
// below this button width, PayPal gets a row of its own and the QR buttons share the next
const MIN_DONATE_W = 120;
const ICON_SIZE = 26;
const ICON_GAP = 10;
// the logo's violet, brighter than the sign-in buttons' purple so they don't read as sign-in buttons
const DONATE: ButtonStyle = { fill: 0x8b3bdb, hover: 0xa35ee6, text: "#f8f5ff" };
// the QR popup draws over everything else
const QR_DEPTH = 10;

/**
 * The first screen: log in, sign up, or play as a guest (everything but ranked). A sign-in saved from an
 * earlier visit is resumed as soon as the server connects, and any sign-in goes straight on to the home
 * screen, or to `then` when another screen sent us here (e.g. a guest choosing ranked). At the bottom, a note from
 * the developer, with PayPal, GCash and Maya buttons for donations.
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
  private donateText!: Phaser.GameObjects.Text;
  private contactText!: Phaser.GameObjects.Text;
  private paypalButton!: Button;
  private paypalIcon!: Phaser.GameObjects.Image;
  private qrButtons!: { card: QrCard; button: Button; icon: Phaser.GameObjects.Image }[];
  // a QR card popup, while it's open
  private qr?: { card: QrCard; shade: Phaser.GameObjects.Rectangle; image: Phaser.GameObjects.Image; button: Button };
  /** Why sign-in was asked for, shown in place of the usual prompt. */
  private message!: string | undefined;
  /** Where a sign-in goes next. Playing as a guest always goes home, since `then` may need an account. */
  private then!: string;

  init(data?: { message?: string; then?: string }) {
    this.online = Online.get();
    // signed out because the account signed in elsewhere: say so, once
    this.error = this.online.signedOutBecause ?? "";
    this.online.signedOutBecause = null;
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
    for (const card of QR_ORDER) if (!this.textures.exists(qrKey(card))) this.load.image(qrKey(card), QR_CARDS[card].file);
    if (!this.textures.exists(PAYPAL_LOGO)) this.load.svg(PAYPAL_LOGO, "paypal.svg", { width: 64, height: 64 });
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
    this.donateText = this.add.text(
      0,
      0,
      `Cellulose is made by Noromon, a solo indie game developer. The server runs on my own computer for now, and donations go toward upgrading it.`,
      { fontFamily: font, fontSize: "14px", color: "#d4ccff", lineSpacing: 4 },
    );
    this.contactText = this.add
      .text(0, 0, `Contact Me: ${CONTACT_EMAIL}`, { fontFamily: font, fontSize: "14px", color: "#d4ccff" })
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.contactText.setColor("#ffe03d"))
      .on("pointerout", () => this.contactText.setColor("#d4ccff"))
      .on("pointerdown", () => (window.location.href = `mailto:${CONTACT_EMAIL}`));
    // opened in a new tab, with no way back into this page
    this.paypalButton = makeButton(this, "PayPal", DONATE, () => window.open(PAYPAL_URL, "_blank", "noopener,noreferrer"));
    this.paypalIcon = this.add.image(0, 0, PAYPAL_LOGO).setDisplaySize(ICON_SIZE, ICON_SIZE);
    this.qrButtons = QR_ORDER.map((card) => ({
      card,
      button: makeButton(this, QR_CARDS[card].label, DONATE, () => this.openQr(card)),
      icon: this.add.image(0, 0, this.cardLogo(card)).setDisplaySize(ICON_SIZE, ICON_SIZE),
    }));
    this.qr = undefined;
    this.input.keyboard?.on("keydown-ESC", () => this.closeQr());

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
    this.donateText.setWordWrapWidth(inner);
    const errorH = this.error ? this.errorText.height + 16 : 0;
    // PayPal, GCash and Maya in a row, or (narrow) PayPal above the other two
    const oneRow = (inner - GAP * 2) / 3 >= MIN_DONATE_W;
    const donateH = 28 + this.donateText.height + GAP + BTN_H + (oneRow ? 0 : GAP + BTN_H) + 16 + this.contactText.height;

    const ph = 32 + this.title.height + 8 + this.status.height + 24 + (24 + BTN_H + 24) * 2 + BTN_H + GAP + BTN_H + errorH + donateH + 32;
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
    if (this.error) {
      this.errorText.setPosition(x, y);
      y += this.errorText.height + 16;
    }
    y += 12;
    this.donateText.setPosition(x, y);
    y += this.donateText.height + GAP;
    if (oneRow) {
      const w3 = (inner - GAP * 2) / 3;
      layoutButton(this.paypalButton, x, y, w3);
      this.qrButtons.forEach(({ button }, i) => layoutButton(button, x + (i + 1) * (w3 + GAP), y, w3));
    } else {
      layoutButton(this.paypalButton, x, y, inner);
      y += BTN_H + GAP;
      this.qrButtons.forEach(({ button }, i) => layoutButton(button, x + i * (bw + GAP), y, bw));
    }
    withIcon(this.paypalButton, this.paypalIcon);
    for (const { button, icon } of this.qrButtons) withIcon(button, icon);
    this.contactText.setPosition(x, y + BTN_H + 16);
    if (this.qr) this.layoutQr(width, height);
  }

  /** A QR card's round app logo, cut out of the card once and kept as its own texture. */
  private cardLogo(card: QrCard) {
    const key = logoKey(card);
    if (this.textures.exists(key)) return key;
    const size = 96;
    const canvas = this.textures.createCanvas(key, size, size)!;
    const ctx = canvas.getContext();
    const { x, y, size: area } = QR_CARDS[card].logo;
    // a circle clip trims the card's background from the corners
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this.textures.get(qrKey(card)).getSourceImage() as CanvasImageSource, x, y, area, area, 0, 0, size, size);
    canvas.refresh();
    return key;
  }

  /** A QR card over a dimmed screen, to scan with that app. Clicking anywhere, Close or Escape shuts it. */
  private openQr(card: QrCard) {
    if (this.qr) return;
    const shade = this.add.rectangle(0, 0, 1, 1, 0x120e22, 0.85).setOrigin(0).setInteractive().on("pointerdown", () => this.closeQr());
    const image = this.add.image(0, 0, qrKey(card)).setOrigin(0.5, 0);
    const button = makeButton(this, "Close", PRIMARY, () => this.closeQr());
    for (const o of [shade, image, button.rect, button.label]) o.setDepth(QR_DEPTH);
    this.qr = { card, shade, image, button };
    // the username and password fields are HTML, which would sit on top of the popup
    this.userInput.setVisible(false);
    this.passInput.setVisible(false);
    this.layoutQr(this.scale.width, this.scale.height);
  }

  private closeQr() {
    if (!this.qr) return;
    const { shade, image, button } = this.qr;
    for (const o of [shade, image, button.rect, button.label]) o.destroy();
    this.qr = undefined;
    this.userInput.setVisible(true);
    this.passInput.setVisible(true);
  }

  /** The QR as big as fits (it's tall: a card around the code), with Close under it. */
  private layoutQr(width: number, height: number) {
    const { card, shade, image, button } = this.qr!;
    shade.setSize(width, height);
    (shade.input!.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, width, height);
    const source = this.textures.get(qrKey(card)).getSourceImage();
    const ratio = source.height / source.width;
    const w = Math.min(420, width - PAD * 2, (height - PAD * 3 - BTN_H) / ratio);
    const h = w * ratio;
    const top = Math.max(PAD, (height - h - PAD - BTN_H) / 2);
    image.setDisplaySize(w, h).setPosition(width / 2, top);
    layoutButton(button, width / 2 - w / 2, top + h + PAD, w);
  }
}

/** Put `icon` before the button's label, the pair centred in the button. Call it after layoutButton. */
function withIcon({ rect, label }: Button, icon: Phaser.GameObjects.Image) {
  // layoutButton fitted the label alone; on a narrow button it shrinks a little more to make room for the icon
  let size = parseFloat(String(label.style.fontSize));
  while (ICON_SIZE + ICON_GAP + label.width > rect.width - 20 && size > 12) label.setFontSize(--size);
  const pairW = ICON_SIZE + ICON_GAP + label.width;
  const left = rect.x + (rect.width - pairW) / 2;
  icon.setPosition(left + ICON_SIZE / 2, rect.y + rect.height / 2).setDepth(label.depth);
  label.setX(left + ICON_SIZE + ICON_GAP + label.width / 2);
}
