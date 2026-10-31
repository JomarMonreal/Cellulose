/** still: never changes; oscillator: repeats in place; spaceship: repeats while moving. */
export type PatternKind = "still" | "oscillator" | "spaceship";

export type Pattern = {
  name: string;
  kind: PatternKind;
  /** Live cells as [row, col], top-left at 0,0. */
  cells: [number, number][];
  /** Spaceships only: the direction they travel, as [dRow, dCol]. */
  dir?: [number, number];
};

/** Rows of "O" (alive) and "." (dead) into [row, col] cells. */
function parse(rows: string[]): [number, number][] {
  const cells: [number, number][] = [];
  rows.forEach((line, r) => [...line].forEach((ch, c) => ch === "O" && cells.push([r, c])));
  return cells;
}

// classic Conway's Life patterns (see conwaylife.com/wiki)
export const PATTERNS: Pattern[] = [
  { name: "Block", kind: "still", cells: parse(["OO", "OO"]) },
  { name: "Tub", kind: "still", cells: parse([".O.", "O.O", ".O."]) },
  { name: "Boat", kind: "still", cells: parse(["OO.", "O.O", ".O."]) },
  { name: "Beehive", kind: "still", cells: parse([".OO.", "O..O", ".OO."]) },
  { name: "Loaf", kind: "still", cells: parse([".OO.", "O..O", ".O.O", "..O."]) },
  { name: "Blinker", kind: "oscillator", cells: parse(["OOO"]) },
  { name: "Toad", kind: "oscillator", cells: parse([".OOO", "OOO."]) },
  { name: "Beacon", kind: "oscillator", cells: parse(["OO..", "O...", "...O", "..OO"]) },
  { name: "Glider", kind: "spaceship", cells: parse([".O.", "..O", "OOO"]), dir: [1, 1] },
  { name: "LWSS", kind: "spaceship", cells: parse([".O..O", "O....", "O...O", "OOOO."]), dir: [0, -1] },
];

export type Orientation = { cells: [number, number][]; rows: number; cols: number; dir?: [number, number] };

/** All 8 rotations/reflections of a pattern, each shifted so its top-left is at 0,0. */
export function orientations(p: Pattern): Orientation[] {
  const result: Orientation[] = [];
  for (const transpose of [false, true]) {
    for (const flipR of [false, true]) {
      for (const flipC of [false, true]) {
        const map = ([r, c]: [number, number]): [number, number] => {
          if (transpose) [r, c] = [c, r];
          return [flipR ? -r : r, flipC ? -c : c];
        };
        const moved = p.cells.map(map);
        const minR = Math.min(...moved.map(([r]) => r));
        const minC = Math.min(...moved.map(([, c]) => c));
        const cells = moved.map(([r, c]): [number, number] => [r - minR, c - minC]);
        result.push({
          cells,
          rows: Math.max(...cells.map(([r]) => r)) + 1,
          cols: Math.max(...cells.map(([, c]) => c)) + 1,
          dir: p.dir && map(p.dir),
        });
      }
    }
  }
  return result;
}
