import { PALETTE } from "../Player";
import { displayFont, fontFamily, textInput } from "../ui";
import type Online from "./Online";

const CHAT_INPUT_H = 40;
const CHAT_MAX = 200;
// players muted in chat (by name, lowercased) and whether chat is muted altogether, remembered in this browser
const MUTED_KEY = "cellulose:muted";
const CHAT_OFF_KEY = "cellulose:chatOff";

/**
 * A room's chat, as HTML for a Phaser DOM element: a label with a "Mute all" switch, the log, and a field to type in.
 * Used in the friends lobby and in games. Without a connection (offline games) there's nobody to talk to, so it
 * says so. Call render() whenever Online reports a "chat" event.
 */
export default class ChatBox {
  /** The outer element, to hand to scene.add.dom. Size it with its style's width and height. */
  readonly element: HTMLDivElement;
  readonly input: HTMLInputElement;
  private log: HTMLDivElement;
  private toggle: HTMLButtonElement;

  constructor(
    private online: Online | null,
    /** Called with the reason a line was refused (e.g. sending too fast). */
    private onError: (reason: string) => void,
    /** Text shown when nobody has said anything yet. */
    private emptyNote = "No messages yet. Say hi! Click a name to mute that player.",
  ) {
    const font = fontFamily();
    // Phaser sets the outer element's display on every frame (to show or hide it), so the flex column goes inside it
    this.element = document.createElement("div");
    const box = document.createElement("div");
    Object.assign(box.style, {
      boxSizing: "border-box",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      paddingTop: "14px",
      borderTop: "2px solid #2b2448",
    });
    // "Chat", and on the right a switch that hides everyone's lines
    const label = document.createElement("div");
    Object.assign(label.style, { display: "flex", justifyContent: "space-between", alignItems: "baseline" });
    const title = document.createElement("span");
    title.textContent = "Chat";
    Object.assign(title.style, { fontFamily: displayFont(), fontSize: "16px", color: "#d4ccff" });
    const toggle = document.createElement("button");
    toggle.type = "button";
    Object.assign(toggle.style, {
      background: "none",
      border: "none",
      padding: "0",
      cursor: "pointer",
      color: "#9a8ae0",
      fontFamily: font,
      fontSize: "13px",
      fontWeight: "bold",
    });
    toggle.addEventListener("click", () => {
      store(CHAT_OFF_KEY, !readStored<boolean>(CHAT_OFF_KEY, false));
      this.render();
    });
    toggle.hidden = !online;
    label.append(title, toggle);
    const log = document.createElement("div");
    log.setAttribute("role", "log");
    log.setAttribute("aria-label", "Chat messages");
    Object.assign(log.style, {
      flex: "1",
      minHeight: "0",
      overflowY: "auto",
      padding: "8px 10px",
      background: "#15112a",
      color: "#f8f5ff",
      fontFamily: font,
      fontSize: "14px",
      lineHeight: "1.35",
      overflowWrap: "anywhere",
    });
    const input = textInput(font, online ? "Say something…" : "Chat is for online games", CHAT_MAX);
    Object.assign(input.style, { flex: "none", width: "100%", height: `${CHAT_INPUT_H}px`, fontSize: "15px", padding: "0 12px" });
    input.disabled = !online;
    if (!online) input.style.opacity = "0.5";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.send();
      if (e.key === "Escape") input.blur();
    });
    box.append(label, log, input);
    this.element.append(box);
    this.log = log;
    this.input = input;
    this.toggle = toggle;
    this.render();
  }

  private send() {
    const text = this.input.value.trim();
    if (!text || !this.online) return;
    this.input.value = "";
    void this.online.sendChat(text).then((r) => {
      if (r.ok) return;
      this.onError(r.reason);
      // give the line back, so it can be sent again
      if (!this.input.value) this.input.value = text;
    });
  }

  /** Show the room's chat, following the newest line unless the log was scrolled up to read. */
  render() {
    const { log, online } = this;
    const following = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    const note = (text: string) => {
      const line = document.createElement("div");
      line.textContent = text;
      Object.assign(line.style, { color: "#9a8ae0", fontStyle: "italic" });
      return line;
    };
    const messages = online?.chat ?? [];
    const off = readStored<boolean>(CHAT_OFF_KEY, false);
    const muted = new Set(mutedNames());
    this.toggle.textContent = off ? "Unmute all" : "Mute all";
    const mineFrom = (m: (typeof messages)[number]) => m.from === online?.id;
    // your own lines always show; muted players' don't
    const shown = messages.filter((m) => mineFrom(m) || (!off && !muted.has(m.name.toLowerCase())));
    const hidden = messages.length - shown.length;
    if (!online) log.replaceChildren(note("Play with friends, classic or ranked to chat with the other players."));
    else if (!messages.length) log.replaceChildren(note(off ? "Chat is muted." : this.emptyNote));
    else {
      log.replaceChildren(
        ...shown.map((m) => {
          // textContent, never HTML: these come from other players
          const line = document.createElement("div");
          const who = document.createElement("span");
          who.textContent = mineFrom(m) ? "You" : m.name;
          Object.assign(who.style, { fontWeight: "bold", color: `#${(PALETTE[m.color]?.color ?? 0xd4ccff).toString(16).padStart(6, "0")}` });
          // click someone else's name to mute them
          if (!mineFrom(m)) {
            Object.assign(who.style, { cursor: "pointer" });
            who.title = `Mute ${m.name}`;
            who.addEventListener("click", () => this.setMuted(m.name, true));
          }
          line.append(who, `: ${m.text}`);
          return line;
        }),
      );
      if (off) log.append(note(`Chat is muted${hidden ? ` (${hidden} hidden)` : ""}.`));
      // muted players are listed, each a click away from being heard again
      const mutedHere = [...new Set(messages.filter((m) => !mineFrom(m) && muted.has(m.name.toLowerCase())).map((m) => m.name))];
      if (!off && mutedHere.length) {
        const line = note("Muted: ");
        mutedHere.forEach((name, i) => {
          const undo = document.createElement("span");
          undo.textContent = name;
          undo.title = `Unmute ${name}`;
          Object.assign(undo.style, { cursor: "pointer", textDecoration: "underline" });
          undo.addEventListener("click", () => this.setMuted(name, false));
          line.append(...(i ? [", "] : []), undo);
        });
        log.append(line);
      }
    }
    const mine = messages.at(-1)?.from === online?.id;
    if (following || mine) log.scrollTop = log.scrollHeight;
  }

  /** Stop typing, e.g. when an overlay covers the chat. */
  blur() {
    if (document.activeElement === this.input) this.input.blur();
  }

  /** Mute or unmute a player's chat, by name, everywhere in this browser. */
  private setMuted(name: string, mute: boolean) {
    const muted = new Set(mutedNames());
    if (mute) muted.add(name.toLowerCase());
    else muted.delete(name.toLowerCase());
    store(MUTED_KEY, [...muted]);
    this.render();
  }
}

/** The chat's muted players, lowercased. Anything else under that key (an older build once wrote a number there) counts as none. */
function mutedNames(): string[] {
  const v = readStored<unknown>(MUTED_KEY, []);
  return Array.isArray(v) ? v.filter((n): n is string => typeof n === "string") : [];
}

/** A setting saved in this browser, or `fallback` when there's none (or storage is off, e.g. private browsing). */
function readStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage is blocked (some private modes): the setting just isn't kept
  }
}
