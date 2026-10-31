import type Board from "./Board";
import type Cell from "./Cell";
import type Player from "./Player";
import { orientations, PATTERNS, type PatternKind } from "./patterns";

// how often each kind of pattern is picked, when affordable and it fits
const KIND_WEIGHTS: Record<PatternKind, number> = { spaceship: 0.45, still: 0.3, oscillator: 0.25 };

/**
 * Places known Life patterns in its territory one cell at a time. Spaceships are aimed at the board's
 * centre to grab land; still lifes and oscillators hold it. Spots and choices are partly random.
 */
export default class Ai {
  /** Remaining cells of the pattern being placed. */
  private queue: Cell[] = [];

  constructor(
    public readonly player: Player,
    private board: Board,
  ) {}

  /** Forget a half-placed pattern, e.g. when a placement phase ends. */
  reset() {
    this.queue = [];
  }

  /** Place the next cell, planning a new pattern when needed. False when there's nothing it can place. */
  step(place: (cell: Cell) => void): boolean {
    for (;;) {
      if (this.player.resources <= 0) return false;
      if (this.queue.length === 0 && !this.plan()) return false;
      const cell = this.queue.shift()!;
      // the spot may have changed since planning (e.g. another player's cell)
      if (cell.is_alive || cell.territory !== this.player) continue;
      place(cell);
      return true;
    }
  }

  /** Choose an affordable pattern, an orientation and a spot for it, and queue its cells. */
  private plan(): boolean {
    const own = this.board.cells.flat().filter((c) => c.territory === this.player);
    for (const pattern of weightedShuffle(PATTERNS.filter((p) => p.cells.length <= this.player.resources))) {
      let best: { cells: Cell[]; score: number } | null = null;
      for (const o of orientations(pattern)) {
        for (const anchor of own) {
          const cells = this.fit(o.cells, o.rows, o.cols, anchor.row, anchor.col);
          if (!cells) continue;
          const score = this.score(anchor.row + o.rows / 2, anchor.col + o.cols / 2, o.dir);
          if (!best || score > best.score) best = { cells, score };
        }
      }
      if (best) {
        this.queue = best.cells;
        return true;
      }
    }
    return false;
  }

  /** The board cells for the pattern at (row, col), or null if any is outside our empty territory or crowded. */
  private fit(pattern: [number, number][], rows: number, cols: number, row: number, col: number): Cell[] | null {
    // a one-tile gap around the pattern keeps neighbours from disturbing it
    for (let r = row - 1; r <= row + rows; r++) {
      for (let c = col - 1; c <= col + cols; c++) {
        if (this.board.cells[r]?.[c]?.is_alive) return null;
      }
    }
    const cells: Cell[] = [];
    for (const [dr, dc] of pattern) {
      const cell = this.board.cells[row + dr]?.[col + dc];
      if (!cell || cell.territory !== this.player) return null;
      cells.push(cell);
    }
    return cells;
  }

  /** Higher is better: nearer the board's centre (the frontier), spaceships facing it, plus some randomness. */
  private score(r: number, c: number, dir?: [number, number]): number {
    const mid = this.board.tiles / 2;
    const [tr, tc] = [mid - r, mid - c];
    const dist = Math.hypot(tr, tc);
    let score = 1 - dist / (mid * Math.SQRT2) + Math.random() * 0.4;
    if (dir && dist > 0) score += ((dir[0] * tr + dir[1] * tc) / (Math.hypot(...dir) * dist)) * 2;
    return score;
  }
}

/** Patterns in random order, with kinds that weigh more tending to come first. */
function weightedShuffle<T extends { kind: PatternKind }>(items: T[]): T[] {
  return items
    .map((item) => ({ item, key: Math.random() ** (1 / KIND_WEIGHTS[item.kind]) }))
    .sort((a, b) => b.key - a.key)
    .map(({ item }) => item);
}
