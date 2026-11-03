import type Board from "./Board";
import type Cell from "./Cell";
import type Player from "./Player";
import { orientations, type Pattern, PATTERNS, type PatternKind } from "./patterns";

// how often each kind of pattern is picked when nothing more specific applies (affordable and it fits)
const KIND_WEIGHTS: Record<PatternKind, number> = { spaceship: 0.45, still: 0.3, oscillator: 0.25, methuselah: 0.2 };
// the middle: tiles within this fraction of the board's size from its centre
const MIDDLE_RADIUS = 0.18;
// the base: tiles within this fraction of the board's size from the bot's home corner
const BASE_RADIUS = 0.3;
// with land in the middle, the chance it plants a methuselah there
const MIDDLE_METHUSELAH = 0.7;
// behind: land under this share of the leader's; then the chance it fortifies its base
const LAGGING = 0.75;
const LAGGING_DEFEND = 0.6;

/** What to build and where: patterns of these kinds (or names), at spots inside `zone`, scored by `score`. */
type Goal = {
  patterns: Pattern[];
  zone: (r: number, c: number) => boolean;
  score: (r: number, c: number, dir?: [number, number]) => number;
};

/**
 * Places known Life patterns in its territory one cell at a time, by a simple plan:
 * - once its land reaches the middle, it mostly plants methuselahs there, which grow big from a few cells;
 * - when it's behind the leader, it often fortifies its home corner with still lifes and oscillators;
 * - otherwise it launches gliders from its corner, aimed at the middle.
 * If the plan doesn't fit or isn't affordable it falls back to any pattern, near the frontier. Spots and choices
 * are partly random. CelluloseServer's Bot plays the same way.
 */
export default class Ai {
  /** Remaining cells of the pattern being placed. */
  private queue: Cell[] = [];
  /** The board corner the bot started in, found on its first plan. */
  private home: [number, number] | null = null;

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

  /** Pick goals for the situation, then place the first one that fits. */
  private plan(): boolean {
    const cells = this.board.cells.flat();
    const own = cells.filter((c) => c.territory === this.player);
    if (!own.length) return false;
    this.home ??= nearestCorner(own, this.board.tiles);
    const land = new Map<Player, number>();
    for (const c of cells) if (c.territory) land.set(c.territory, (land.get(c.territory) ?? 0) + 1);
    const leader = Math.max(...land.values());
    const goals = this.goals(
      own.some((c) => this.inMiddle(c.row, c.col)),
      own.length < leader * LAGGING,
    );
    const affordable = (p: Pattern) => p.cells.length <= this.player.resources;
    for (const goal of goals) {
      const spot = this.bestSpot(goal.patterns.filter(affordable), own, goal);
      if (spot) {
        this.queue = spot;
        return true;
      }
    }
    return false;
  }

  /** The plans worth trying now, most wanted first; the last is always "anything, near the frontier". */
  private goals(reachesMiddle: boolean, lagging: boolean): Goal[] {
    const mid = this.board.tiles / 2;
    const [hr, hc] = this.home!;
    const toMiddle = (r: number, c: number) => Math.hypot(mid - r, mid - c);
    const toHome = (r: number, c: number) => Math.hypot(hr - r, hc - c);
    const of = (...kinds: PatternKind[]) => PATTERNS.filter((p) => kinds.includes(p.kind));
    const methuselahs: Goal = {
      patterns: shuffle(of("methuselah")),
      zone: (r, c) => this.inMiddle(r, c),
      // as near the centre as it fits
      score: (r, c) => -toMiddle(r, c) + Math.random() * 2,
    };
    const fortify: Goal = {
      patterns: shuffle(of("still", "oscillator")),
      zone: (r, c) => toHome(r, c) <= this.board.tiles * BASE_RADIUS,
      // inside the base, about 70% of the way to its edge, where land is fought over
      score: (r, c) => -Math.abs(toHome(r, c) / this.board.tiles - BASE_RADIUS * 0.7) + Math.random() * 0.05,
    };
    const gliders: Goal = {
      patterns: PATTERNS.filter((p) => p.name === "Glider"),
      zone: (r, c) => toHome(r, c) <= this.board.tiles * BASE_RADIUS,
      // facing the middle above all, then from the corner's outer edge
      score: (r, c, dir) => facing(r, c, dir, mid) * 3 - toMiddle(r, c) / this.board.tiles + Math.random() * 0.3,
    };
    const anything: Goal = {
      patterns: weightedShuffle(PATTERNS),
      zone: () => true,
      // the old way: near the centre (the frontier), spaceships facing it
      score: (r, c, dir) => 1 - toMiddle(r, c) / (mid * Math.SQRT2) + facing(r, c, dir, mid) * 2 + Math.random() * 0.4,
    };
    const goals: Goal[] = [];
    if (reachesMiddle && Math.random() < MIDDLE_METHUSELAH) goals.push(methuselahs);
    if (lagging && Math.random() < LAGGING_DEFEND) goals.push(fortify);
    goals.push(gliders, anything);
    return goals;
  }

  /** The best-scoring spot for any of `patterns` (in order) within the goal's zone, as the cells to place. */
  private bestSpot(patterns: Pattern[], own: Cell[], goal: Goal): Cell[] | null {
    for (const pattern of patterns) {
      let best: { cells: Cell[]; score: number } | null = null;
      for (const o of orientations(pattern)) {
        for (const anchor of own) {
          const [r, c] = [anchor.row + o.rows / 2, anchor.col + o.cols / 2];
          if (!goal.zone(r, c)) continue;
          const cells = this.fit(o.cells, o.rows, o.cols, anchor.row, anchor.col);
          if (!cells) continue;
          const score = goal.score(r, c, o.dir);
          if (!best || score > best.score) best = { cells, score };
        }
      }
      if (best) return best.cells;
    }
    return null;
  }

  private inMiddle(r: number, c: number) {
    const mid = this.board.tiles / 2;
    return Math.hypot(mid - r, mid - c) <= this.board.tiles * MIDDLE_RADIUS;
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
}

/** How squarely a spaceship moving `dir` from (r, c) heads for the middle: 1 straight at it, -1 away, 0 for anything else. */
function facing(r: number, c: number, dir: [number, number] | undefined, mid: number) {
  const [tr, tc] = [mid - r, mid - c];
  const dist = Math.hypot(tr, tc);
  if (!dir || dist === 0) return 0;
  return (dir[0] * tr + dir[1] * tc) / (Math.hypot(...dir) * dist);
}

/** The board corner nearest the middle of these tiles: where a player started. */
function nearestCorner(tiles: { row: number; col: number }[], size: number): [number, number] {
  const r = tiles.reduce((s, t) => s + t.row, 0) / tiles.length;
  const c = tiles.reduce((s, t) => s + t.col, 0) / tiles.length;
  return [r < size / 2 ? 0 : size - 1, c < size / 2 ? 0 : size - 1];
}

function shuffle<T>(items: T[]): T[] {
  return items
    .map((item) => ({ item, key: Math.random() }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
}

/** Patterns in random order, with kinds that weigh more tending to come first. */
function weightedShuffle<T extends { kind: PatternKind }>(items: T[]): T[] {
  return items
    .map((item) => ({ item, key: Math.random() ** (1 / KIND_WEIGHTS[item.kind]) }))
    .sort((a, b) => b.key - a.key)
    .map(({ item }) => item);
}
