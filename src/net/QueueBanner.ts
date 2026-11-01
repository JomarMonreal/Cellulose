import { modeName } from "../modes";
import type { QueueStatus } from "./protocol";

/**
 * A strip along the bottom of the game while waiting for a ranked or classic match, and while a found match loads.
 * Plain HTML rather than a Phaser object, so it stays put whichever scene is showing (you can play a solo game meanwhile).
 */
export default class QueueBanner {
  private el: HTMLDivElement | null = null;
  private text!: HTMLSpanElement;
  private cancel!: HTMLButtonElement;
  // a match was found and is loading; there's nothing left to cancel
  private found = false;
  private status: QueueStatus = null;
  private timer = 0;

  constructor(private onCancel: () => void) {}

  show(status: QueueStatus) {
    this.status = status;
    this.found = false;
    if (!status) {
      this.el?.remove();
      this.el = null;
      clearInterval(this.timer);
      return;
    }
    if (!this.el) this.build();
    this.render();
  }

  /** Say the match is loading until it opens (show(null) then takes the strip away). */
  matchFound() {
    this.found = true;
    if (!this.el) this.build();
    this.render();
  }

  private build() {
    const el = document.createElement("div");
    el.setAttribute("role", "status");
    Object.assign(el.style, {
      position: "absolute",
      left: "50%",
      bottom: "16px",
      transform: "translateX(-50%)",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      maxWidth: "calc(100% - 32px)",
      padding: "10px 12px 10px 18px",
      background: "#1c1633",
      border: "2px solid #ffe03d",
      color: "#f8f5ff",
      font: `bold 15px ${getComputedStyle(document.body).fontFamily}`,
      zIndex: "20",
    });
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    this.text = document.createElement("span");
    const cancel = (this.cancel = document.createElement("button"));
    cancel.textContent = "Cancel";
    Object.assign(cancel.style, { background: "#5b4b9a", color: "#f8f5ff", border: "0", padding: "8px 14px", font: "inherit", cursor: "pointer" });
    cancel.addEventListener("click", this.onCancel);
    el.append(spinner, this.text, cancel);
    // #game is positioned (style.css), so the strip sits inside the game rather than the page
    (document.getElementById("game") ?? document.body).append(el);
    this.el = el;
    this.timer = window.setInterval(() => this.render(), 1000);
  }

  private render() {
    this.cancel.hidden = this.found;
    if (this.found) {
      this.text.textContent = "Match found · loading the game…";
      return;
    }
    const s = this.status;
    if (!s) return;
    const secs = Math.floor((Date.now() - s.since) / 1000);
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    this.text.textContent = `Finding a ${s.kind} ${modeName(s.mode)} match · ${s.waiting}/${s.needed} players · ${clock}`;
  }
}
