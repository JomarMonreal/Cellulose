import * as Phaser from "phaser";
import Online from "../net/Online";
import { BTN_H, type Button, displayFont, fitHeight, fontFamily, layoutButton, makeButton, PANEL_COLOR, PRIMARY, SECONDARY, setButtonLoading, textInput } from "../ui";

const PAD = 24;
const GAP = 12;

/**
 * Account security for a signed-in player: change the password (which signs out every other device), or sign out
 * everywhere, this device too. Signing out, here or elsewhere, goes back to the sign-in screen.
 */
export default class AccountScene extends Phaser.Scene {
  constructor() {
    super("AccountScene");
  }

  private online!: Online;
  private error!: string;
  private notice!: string;
  // a request is on its way; ignore clicks until it's answered
  private busy!: boolean;

  private panel!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private currentLabel!: Phaser.GameObjects.Text;
  private currentInput!: Phaser.GameObjects.DOMElement;
  private nextLabel!: Phaser.GameObjects.Text;
  private nextInput!: Phaser.GameObjects.DOMElement;
  private changeButton!: Button;
  private everywhereText!: Phaser.GameObjects.Text;
  private everywhereButton!: Button;
  private message!: Phaser.GameObjects.Text;
  private backButton!: Button;

  init() {
    this.online = Online.get();
    this.error = "";
    this.notice = "";
    this.busy = false;
  }

  create() {
    if (!this.online.profile) return this.scene.start("AuthScene");
    const font = fontFamily();
    const display = displayFont();
    const labelStyle = { fontFamily: display, fontSize: "16px", fontStyle: "bold", color: "#d4ccff" };
    const textStyle = { fontFamily: font, fontSize: "15px", color: "#d4ccff", lineSpacing: 4 };

    this.panel = this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0);
    this.title = this.add.text(0, 0, "Account", { fontFamily: display, fontSize: "32px", fontStyle: "bold", color: "#f8f5ff" });
    this.status = this.add.text(0, 0, `Signed in as ${this.online.profile.username}`, { fontFamily: font, fontSize: "14px", color: "#d4ccff" });

    this.currentLabel = this.add.text(0, 0, "Current password", labelStyle);
    const current = textInput(font, "Current password", 72, "", "password");
    current.placeholder = "";
    current.autocomplete = "current-password";
    current.addEventListener("keydown", (e) => e.key === "Enter" && next.focus());
    this.currentInput = this.add.dom(0, 0, current).setOrigin(0);
    this.nextLabel = this.add.text(0, 0, "New password", labelStyle);
    const next = textInput(font, "New password", 72, "", "password");
    next.placeholder = "";
    next.autocomplete = "new-password";
    next.addEventListener("keydown", (e) => e.key === "Enter" && this.changePassword());
    this.nextInput = this.add.dom(0, 0, next).setOrigin(0);
    this.changeButton = makeButton(this, "Change password", PRIMARY, () => this.changePassword());

    this.everywhereText = this.add.text(0, 0, "Changing the password signs you out on every other device. To sign out on all of them, this one too:", textStyle);
    this.everywhereButton = makeButton(this, "Sign out everywhere", SECONDARY, () => this.signOutEverywhere());
    this.message = this.add.text(0, 0, "", { fontFamily: font, fontSize: "15px", fontStyle: "bold", color: "#ff4d5e" });
    this.backButton = makeButton(this, "Back", SECONDARY, () => this.scene.start("HomeScene"));

    const onAuth = () => (this.online.profile ? this.refresh() : this.scene.start("AuthScene"));
    this.online.on("auth", onAuth);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.online.off("auth", onAuth);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
    this.refresh();
    current.focus();
  }

  private async changePassword() {
    if (this.busy) return;
    const current = this.currentInput.node as HTMLInputElement;
    const next = this.nextInput.node as HTMLInputElement;
    if (!current.value || !next.value) return this.show("Enter your current password and a new one", false);
    this.busy = true;
    setButtonLoading(this.changeButton, true);
    const r = await this.online.changePassword(current.value, next.value);
    this.busy = false;
    if (!this.scene.isActive()) return;
    setButtonLoading(this.changeButton, false);
    if (!r.ok) return this.show(r.reason ?? "Something went wrong", false);
    current.value = "";
    next.value = "";
    this.show("Password changed. Other devices are signed out.", true);
  }

  private async signOutEverywhere() {
    if (this.busy) return;
    this.busy = true;
    setButtonLoading(this.everywhereButton, true);
    // success emits "auth" with no profile, which goes to the sign-in screen
    const r = await this.online.logoutAll();
    this.busy = false;
    if (!this.scene.isActive()) return;
    setButtonLoading(this.everywhereButton, false);
    if (!r.ok) this.show(r.reason ?? "Something went wrong", false);
  }

  /** A line under the buttons: an error in red, or good news in green. */
  private show(text: string, good: boolean) {
    this.error = good ? "" : text;
    this.notice = good ? text : "";
    this.refresh();
  }

  private refresh() {
    this.message.setText(this.error || this.notice).setColor(this.error ? "#ff4d5e" : "#3ddc84");
    this.layout(this.scale.gameSize);
  }

  /** A centred panel: the password form, then sign out everywhere, then any message and Back. */
  private layout({ width, height }: Phaser.Structs.Size) {
    const pw = Math.min(480, width - PAD * 2);
    const inner = pw - 64;
    for (const t of [this.status, this.everywhereText, this.message]) t.setWordWrapWidth(inner);
    const messageH = this.message.text ? this.message.height + 16 : 0;
    const ph =
      32 + this.title.height + 8 + this.status.height + 24 + (24 + BTN_H + 24) * 2 + BTN_H + 32 + this.everywhereText.height + GAP + BTN_H + 24 + messageH + BTN_H + 32;
    fitHeight(this, ph + PAD * 2);
    const px = (width - pw) / 2;
    const x = px + 32;
    let y = Math.max(PAD, (height - ph) / 2);
    this.panel.setPosition(px, y).setSize(pw, ph);

    y += 32;
    this.title.setPosition(x, y);
    y += this.title.height + 8;
    this.status.setPosition(x, y);
    y += this.status.height + 24;
    for (const [label, input] of [
      [this.currentLabel, this.currentInput],
      [this.nextLabel, this.nextInput],
    ] as const) {
      label.setPosition(x, y);
      y += 24;
      input.setPosition(x, y);
      (input.node as HTMLInputElement).style.width = `${inner}px`;
      y += BTN_H + 24;
    }
    layoutButton(this.changeButton, x, y, inner);
    y += BTN_H + 32;
    this.everywhereText.setPosition(x, y);
    y += this.everywhereText.height + GAP;
    layoutButton(this.everywhereButton, x, y, inner);
    y += BTN_H + 24;
    if (this.message.text) {
      this.message.setPosition(x, y);
      y += this.message.height + 16;
    }
    layoutButton(this.backButton, x, y, inner);
  }
}
