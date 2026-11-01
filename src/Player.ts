/** The colours a player can pick in the lobby; the AIs take the ones left over, in this order. */
export const PALETTE = [
  { name: "Blue", color: 0x3d9bff },
  { name: "Red", color: 0xff4d5e },
  { name: "Green", color: 0x3ddc84 },
  { name: "Orange", color: 0xff9a3d },
];

export default class Player {
  /** Cells this player can still place. */
  resources: number;
  /** Territory size at the last resource grant; growth since then earns more resources. */
  territory_at_last_grant = 0;
  /** Capture the flag: the generation this player's flag was taken, or null while it stands. */
  captured_at: number | null = null;

  constructor(
    public name: string,
    /** Colour of this player's live cells and territory border. */
    public main_color: number,
    public is_ai: boolean,
    resources: number,
  ) {
    this.resources = resources;
  }
}
