import * as Phaser from "phaser";
import { avatarBlob, avatarTexture } from "../avatars";
import Online from "../net/Online";
import { BTN_H, type Button, displayFont, fitHeight, fontFamily, layoutButton, makeButton, PANEL_COLOR, PRIMARY, SECONDARY, setButtonLoading, textInput } from "../ui";

const PAD = 24;
const GAP = 12;
// the picture's preview, and the disc behind it (or behind the initial, with no picture)
const PREVIEW = 72;
const NO_PICTURE = 0x8b3bdb;

/**
 * A signed-in player's account: their profile picture (shown on their badge in games; without one, the badge shows
 * their name's first letter), changing the password (which signs out every other device), or signing out
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
  private pictureLabel!: Phaser.GameObjects.Text;
  private pictureDisc!: Phaser.GameObjects.Graphics;
  private pictureInitial!: Phaser.GameObjects.Text;
  private picture!: Phaser.GameObjects.Image;
  private pictureHint!: Phaser.GameObjects.Text;
  private changePictureButton!: Button;
  private removePictureButton!: Button;
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

    this.pictureLabel = this.add.text(0, 0, "Profile picture", labelStyle);
    this.pictureDisc = this.add.graphics();
    this.pictureInitial = this.add
      .text(0, 0, this.online.profile.username[0].toUpperCase(), { fontFamily: display, fontSize: "32px", color: "#f8f5ff" })
      .setOrigin(0.5);
    this.picture = this.add.image(0, 0, "__DEFAULT").setVisible(false);
    this.pictureHint = this.add.text(0, 0, "Shown on your badge in games. It's cropped to a square.", { ...textStyle, fontSize: "13px" });
    // a file picker that never needs to be on the page; the button opens it
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/*";
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      picker.value = "";
      if (file) void this.setPicture(file);
    });
    this.changePictureButton = makeButton(this, "Change", PRIMARY, () => !this.busy && picker.click());
    this.removePictureButton = makeButton(this, "Remove", SECONDARY, () => void this.removePicture());

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

  /** Shrink the chosen file to a 128x128 picture and upload it. */
  private async setPicture(file: File) {
    if (this.busy) return;
    this.busy = true;
    setButtonLoading(this.changePictureButton, true);
    let r: { ok: boolean; reason?: string };
    try {
      r = await this.online.uploadAvatar(await avatarBlob(file));
    } catch (err) {
      r = { ok: false, reason: (err as Error).message };
    }
    this.busy = false;
    if (!this.scene.isActive()) return;
    setButtonLoading(this.changePictureButton, false);
    this.show(r.ok ? "Picture changed." : (r.reason ?? "Something went wrong"), r.ok);
  }

  private async removePicture() {
    if (this.busy || !this.online.profile?.avatar) return;
    this.busy = true;
    setButtonLoading(this.removePictureButton, true);
    const r = await this.online.removeAvatar();
    this.busy = false;
    if (!this.scene.isActive()) return;
    setButtonLoading(this.removePictureButton, false);
    this.show(r.ok ? "Picture removed." : (r.reason ?? "Something went wrong"), r.ok);
  }

  /** The preview: the picture once it's loaded, or the initial on a disc. */
  private showPicture() {
    const url = this.online.pictureUrl(this.online.profile?.avatar);
    const has = !!url;
    this.removePictureButton.rect.setAlpha(has ? 1 : 0.4);
    this.removePictureButton.label.setAlpha(has ? 1 : 0.4);
    if (!url) {
      this.picture.setVisible(false);
      this.pictureInitial.setVisible(true);
      return;
    }
    void avatarTexture(this, url).then((key) => {
      // the scene may have closed, or the picture changed again, while this one loaded
      if (!this.scene.isActive() || url !== this.online.pictureUrl(this.online.profile?.avatar)) return;
      this.picture.setVisible(!!key);
      this.pictureInitial.setVisible(!key);
      if (key) this.picture.setTexture(key).setDisplaySize(PREVIEW - 6, PREVIEW - 6);
    });
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
    this.showPicture();
    this.layout(this.scale.gameSize);
  }

  /** A centred panel: the picture, the password form, then sign out everywhere, then any message and Back. */
  private layout({ width, height }: Phaser.Structs.Size) {
    const pw = Math.min(480, width - PAD * 2);
    const inner = pw - 64;
    for (const t of [this.status, this.everywhereText, this.message, this.pictureHint]) t.setWordWrapWidth(inner);
    const pictureH = 24 + PREVIEW + 10 + this.pictureHint.height + 28;
    const messageH = this.message.text ? this.message.height + 16 : 0;
    const ph =
      32 + this.title.height + 8 + this.status.height + 24 + pictureH + (24 + BTN_H + 24) * 2 + BTN_H + 32 + this.everywhereText.height + GAP + BTN_H + 24 + messageH + BTN_H + 32;
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
    // the preview, with Change and Remove beside it
    this.pictureLabel.setPosition(x, y);
    y += 24;
    const [cx, cy] = [x + PREVIEW / 2, y + PREVIEW / 2];
    this.pictureDisc.clear().fillStyle(NO_PICTURE).fillCircle(cx, cy, PREVIEW / 2).lineStyle(3, 0xffe03d).strokeCircle(cx, cy, PREVIEW / 2);
    this.pictureInitial.setPosition(cx, cy);
    this.picture.setPosition(cx, cy);
    const bx = x + PREVIEW + 16;
    const bw = (inner - PREVIEW - 16 - GAP) / 2;
    layoutButton(this.changePictureButton, bx, y + (PREVIEW - BTN_H) / 2, bw);
    layoutButton(this.removePictureButton, bx + bw + GAP, y + (PREVIEW - BTN_H) / 2, bw);
    y += PREVIEW + 10;
    this.pictureHint.setPosition(x, y);
    y += this.pictureHint.height + 28;
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
