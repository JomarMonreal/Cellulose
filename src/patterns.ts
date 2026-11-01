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

/** A pattern in the tutorial's guide, with what it does. */
export type GuideEntry = { name: string; cells: [number, number][]; about: string };

/** A section of the guide: one kind of pattern, coloured like a player so the sections are easy to tell apart. */
export type GuideSection = { title: string; about: string; color: number; patterns: GuideEntry[] };

const cellsOf = (name: string) => PATTERNS.find((p) => p.name === name)!.cells;

// the tutorial's patterns, by kind (see conwaylife.com/wiki). Separate from PATTERNS, which is what the AI places.
export const GUIDE: GuideSection[] = [
  {
    title: "Still lifes",
    about: "Still lifes never change. They are cheap, steady cells that keep claiming land, and walls that slow a rival down.",
    color: 0x3d9bff,
    patterns: [
      { name: "Block", cells: cellsOf("Block"), about: "The block has 4 cells. It is the simplest and toughest still life." },
      { name: "Beehive", cells: cellsOf("Beehive"), about: "The beehive has 6 cells. A small collision often settles into one." },
      { name: "Loaf", cells: cellsOf("Loaf"), about: "The loaf has 7 cells." },
      { name: "Boat", cells: cellsOf("Boat"), about: "The boat has 5 cells." },
      { name: "Tub", cells: cellsOf("Tub"), about: "The tub has 4 cells, spread out, so it claims a wide patch." },
    ],
  },
  {
    title: "Oscillators",
    about: "Oscillators repeat in place. They hold the same spot like still lifes, but their moving cells reach a little further.",
    color: 0xff4d5e,
    patterns: [
      { name: "Blinker", cells: cellsOf("Blinker"), about: "The blinker has 3 cells. It flips between a row and a column every generation." },
      { name: "Toad", cells: cellsOf("Toad"), about: "The toad has 6 cells. It repeats every 2 generations." },
      { name: "Beacon", cells: cellsOf("Beacon"), about: "The beacon has 6 cells. It is two blocks whose inner corners blink." },
      {
        name: "Pulsar",
        cells: parse([
          "..OOO...OOO..",
          ".............",
          "O....O.O....O",
          "O....O.O....O",
          "O....O.O....O",
          "..OOO...OOO..",
          ".............",
          "..OOO...OOO..",
          "O....O.O....O",
          "O....O.O....O",
          "O....O.O....O",
          ".............",
          "..OOO...OOO..",
        ]),
        about: "The pulsar has 48 cells. It repeats every 3 generations over a 13×13 area.",
      },
      {
        name: "Pentadecathlon",
        cells: parse(["..O....O..", "OO.OOOO.OO", "..O....O.."]),
        about: "The pentadecathlon has 12 cells. It repeats every 15 generations, and a row of 10 cells grows into it.",
      },
    ],
  },
  {
    title: "Spaceships",
    about: "Spaceships travel across the board. They carry your colour into new land or into a rival's.",
    color: 0x3ddc84,
    patterns: [
      { name: "Glider", cells: cellsOf("Glider"), about: "The glider has 5 cells. It moves one tile diagonally every 4 generations." },
      { name: "Lightweight spaceship", cells: cellsOf("LWSS"), about: "This ship has 9 cells. It moves straight, 2 tiles every 4 generations." },
      {
        name: "Middleweight spaceship",
        cells: parse(["..O...", "O...O.", ".....O", "O....O", ".OOOOO"]),
        about: "This ship has 11 cells. It works like the lightweight one but is a row longer.",
      },
      {
        name: "Heavyweight spaceship",
        cells: parse(["..OO...", "O....O.", "......O", "O.....O", ".OOOOOO"]),
        about: "This ship has 13 cells. It is the largest of the three.",
      },
    ],
  },
  {
    title: "Guns",
    about: "Guns stay in place and keep firing gliders. They send a stream of your cells out across the board.",
    color: 0xff9a3d,
    patterns: [
      {
        name: "Gosper glider gun",
        cells: parse([
          "........................O...........",
          "......................O.O...........",
          "............OO......OO............OO",
          "...........O...O....OO............OO",
          "OO........O.....O...OO..............",
          "OO........O...O.OO....O.O...........",
          "..........O.....O.......O...........",
          "...........O...O....................",
          "............OO......................",
        ]),
        about: "This gun has 36 cells. It was the first gun found, and it fires a new glider every 30 generations.",
      },
      {
        name: "Simkin glider gun",
        cells: parse([
          "OO.....OO........................",
          "OO.....OO........................",
          ".................................",
          "....OO...........................",
          "....OO...........................",
          ".................................",
          ".................................",
          ".................................",
          ".................................",
          "......................OO.OO......",
          ".....................O.....O.....",
          ".....................O......O..OO",
          ".....................OOO...O...OO",
          "..........................O......",
          ".................................",
          ".................................",
          ".................................",
          "....................OO...........",
          "....................O............",
          ".....................OOO.........",
          ".......................O.........",
        ]),
        about: "This gun has 36 cells. It fires a glider every 120 generations.",
      },
    ],
  },
  {
    title: "Methuselahs",
    about: "Methuselahs are a few cells that grow for a long time before they settle. They are small to place but grow big.",
    color: 0xffe03d,
    patterns: [
      { name: "R-pentomino", cells: parse([".OO", "OO.", ".O."]), about: "The R-pentomino has 5 cells. It keeps changing for 1103 generations." },
      { name: "Diehard", cells: parse(["......O.", "OO......", ".O...OOO"]), about: "Diehard has 7 cells. It grows, then dies out completely at generation 130." },
      { name: "Acorn", cells: parse([".O.....", "...O...", "OO..OOO"]), about: "The acorn has 7 cells. It grows for 5206 generations." },
    ],
  },
];

export type Orientation ={ cells: [number, number][]; rows: number; cols: number; dir?: [number, number] };

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
