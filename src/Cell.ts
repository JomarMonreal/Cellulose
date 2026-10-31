import type Player from "./Player";

export default class Cell {
  /** Position in the board's grid, set by Board. */
  row = 0;
  col = 0;
  /** Player whose cell this is while alive. */
  owner: Player | null = null;
  /** Player whose territory this tile is in; only they can place cells here. */
  territory: Player | null = null;

  constructor(
    public x: number,
    public y: number,
    public w: number,
    public h: number,
    public color: number = 0x000000,
    public is_alive: boolean = false,
  ) {}

  /** The up-to-8 cells touching this one in `grid[row][col]`. Edges don't wrap, so corner cells have 3 and edge cells have 5. */
  get_neighbors(grid: Cell[][]): Cell[] {
    const neighbors: Cell[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const neighbor = grid[this.row + dr]?.[this.col + dc];
        if (neighbor) neighbors.push(neighbor);
      }
    }
    return neighbors;
  }
}
