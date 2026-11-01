import type * as Phaser from "phaser";
import Cell from "./Cell";
import type Player from "./Player";

const ALIVE_COLOR = 0xffffff;
// empty tiles and grid lines in the site's ink and lilac, so the board sits in the page rather than on it
const EMPTY_COLOR = 0x15112a;
const GRID_COLOR = 0x2b2448;
// empty tiles in a player's territory take on this much of their colour, so you can see where you may place
const TERRITORY_TINT = 0.16;
const GRID_LINE = 1;
// territory outlines are twice as thick as the grid lines
const TERRITORY_LINE = GRID_LINE * 2;
/** How many layers of tiles around a live cell it claims as territory. */
export const CLAIM_RADIUS = 2;

export default class Board {
  /** `cells[row][col]` */
  cells: Cell[][];
  x: number;
  y: number;
  size: number;

  constructor(x: number, y: number, size: number, public readonly tiles = 50) {
    this.x = x;
    this.y = y;
    this.size = size;
    const cell = size / tiles;
    this.cells = Array.from({ length: tiles }, (_, row) =>
      Array.from({ length: tiles }, (_, col) => {
        const c = new Cell(x + col * cell, y + row * cell, cell, cell);
        c.row = row;
        c.col = col;
        return c;
      }),
    );
  }

  /** Move and scale every cell to fit a new board area, keeping colour and alive state. */
  resize(x: number, y: number, size: number) {
    this.x = x;
    this.y = y;
    this.size = size;
    const cell = size / this.tiles;
    this.cells.forEach((cols, row) =>
      cols.forEach((c, col) => {
        c.x = x + col * cell;
        c.y = y + row * cell;
        c.w = cell;
        c.h = cell;
      }),
    );
  }

  /** The cell under a screen point, or null if the point is off the board. */
  cellAt(px: number, py: number): Cell | null {
    const cell = this.size / this.tiles;
    const col = Math.floor((px - this.x) / cell);
    const row = Math.floor((py - this.y) / cell);
    return this.cells[row]?.[col] ?? null;
  }

  /**
   * Advance one generation using Conway's rules, counting every live neighbour whoever owns it.
   * A live cell with 2 or 3 neighbours survives and stays its owner's. A dead cell with exactly 3 is born
   * to whichever player owns most of those 3; if all 3 belong to different players, one of them at random.
   */
  step() {
    const next = this.cells.map((cols) =>
      cols.map((c): Player | null => {
        const parents = c.get_neighbors(this.cells).filter((n) => n.is_alive && n.owner);
        if (c.is_alive) return parents.length === 2 || parents.length === 3 ? c.owner : null;
        if (parents.length !== 3) return null;
        const [a, b, d] = parents.map((n) => n.owner!);
        if (a === b || a === d) return a;
        if (b === d) return b;
        return [a, b, d][Math.floor(Math.random() * 3)];
      }),
    );
    this.cells.forEach((cols, row) =>
      cols.forEach((c, col) => {
        c.owner = next[row][col];
        c.is_alive = c.owner !== null;
      }),
    );
  }

  /** Give `player` every tile in the rect, e.g. their starting corner. */
  setTerritory(player: Player, row: number, col: number, rows: number, cols: number) {
    for (let r = row; r < row + rows; r++) {
      for (let c = col; c < col + cols; c++) {
        const cell = this.cells[r]?.[c];
        if (cell) cell.territory = player;
      }
    }
  }

  /**
   * Each live cell claims the tiles within CLAIM_RADIUS of it. A tile goes to the player with the most live
   * cells in range; on a tie, or with none in range, it keeps its current owner.
   */
  claimTerritory() {
    const winners = this.cells.map((cols) =>
      cols.map((tile) => {
        const counts = new Map<Player, number>();
        for (let dr = -CLAIM_RADIUS; dr <= CLAIM_RADIUS; dr++) {
          for (let dc = -CLAIM_RADIUS; dc <= CLAIM_RADIUS; dc++) {
            const n = this.cells[tile.row + dr]?.[tile.col + dc];
            if (n?.is_alive && n.owner) counts.set(n.owner, (counts.get(n.owner) ?? 0) + 1);
          }
        }
        let best: Player | null = null;
        let bestCount = 0;
        let tied = false;
        for (const [p, count] of counts) {
          if (count > bestCount) [best, bestCount, tied] = [p, count, false];
          else if (count === bestCount) tied = true;
        }
        return best && !tied ? best : tile.territory;
      }),
    );
    this.cells.forEach((cols, row) => cols.forEach((c, col) => (c.territory = winners[row][col])));
  }

  territoryOf(player: Player): number {
    let count = 0;
    for (const row of this.cells) for (const c of row) if (c.territory === player) count++;
    return count;
  }

  liveCellsOf(player: Player): number {
    let count = 0;
    for (const row of this.cells) for (const c of row) if (c.is_alive && c.owner === player) count++;
    return count;
  }

  /** Draw the board, clipped to `clip` (the visible board area) so a zoomed or panned board doesn't spill out. */
  draw(g: Phaser.GameObjects.Graphics, clip: Phaser.Geom.Rectangle) {
    g.clear().lineStyle(GRID_LINE, GRID_COLOR);
    const tints = new Map<Player, number>();
    const tint = (p: Player) => {
      let t = tints.get(p);
      if (t === undefined) tints.set(p, (t = mix(EMPTY_COLOR, p.main_color, TERRITORY_TINT)));
      return t;
    };
    for (const row of this.cells) {
      for (const c of row) {
        const r = clipRect(clip, c.x, c.y, c.w, c.h);
        if (!r) continue;
        const color = c.is_alive ? (c.owner?.main_color ?? ALIVE_COLOR) : c.territory ? tint(c.territory) : EMPTY_COLOR;
        g.fillStyle(color).fillRect(...r).strokeRect(...r);
      }
    }

    // territory outlines: only edges where the neighbouring tile isn't the same player's,
    // so adjacent tiles merge into one outlined region. Drawn just inside the tile's edge.
    const t = TERRITORY_LINE;
    for (const row of this.cells) {
      for (const c of row) {
        const p = c.territory;
        if (!p) continue;
        const differs = (dr: number, dc: number) => this.cells[c.row + dr]?.[c.col + dc]?.territory !== p;
        const edges: [number, number, number, number][] = [];
        if (differs(-1, 0)) edges.push([c.x, c.y, c.w, t]);
        if (differs(1, 0)) edges.push([c.x, c.y + c.h - t, c.w, t]);
        if (differs(0, -1)) edges.push([c.x, c.y, t, c.h]);
        if (differs(0, 1)) edges.push([c.x + c.w - t, c.y, t, c.h]);
        g.fillStyle(p.main_color);
        for (const e of edges) {
          const r = clipRect(clip, ...e);
          if (r) g.fillRect(...r);
        }
      }
    }
  }
}

/** `a` blended `t` of the way towards `b`, as 0xRRGGBB. */
function mix(a: number, b: number, t: number) {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) << shift;
  return ch(16) | ch(8) | ch(0);
}

/** The part of a rect inside `clip` as [x, y, w, h], or null if none of it is. */
function clipRect(clip: Phaser.Geom.Rectangle, x: number, y: number, w: number, h: number): [number, number, number, number] | null {
  const cx = Math.max(x, clip.x);
  const cy = Math.max(y, clip.y);
  const cw = Math.min(x + w, clip.right) - cx;
  const ch = Math.min(y + h, clip.bottom) - cy;
  return cw > 0 && ch > 0 ? [cx, cy, cw, ch] : null;
}
