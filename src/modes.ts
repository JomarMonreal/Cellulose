import type { Mode } from "./net/protocol";

export type { Mode };

/** Every mode, in the order the lobbies list them. */
export const MODES: { id: Mode; name: string; rule: string }[] = [
  { id: "strongest500", name: "Strongest 500", rule: "Most land after 500 generations wins." },
  { id: "ctf", name: "Capture the flag", rule: "A rival's land over your flag knocks you out. Last colony standing wins." },
];

export const modeName = (mode: Mode) => MODES.find((m) => m.id === mode)!.name;
