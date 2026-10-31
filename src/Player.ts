export default class Player {
  /** Cells this player can still place. */
  resources: number;
  /** Territory size at the last resource grant; growth since then earns more resources. */
  territory_at_last_grant = 0;

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
