// The page backdrop: an infinite growth pattern (a block-laying switch engine) running forever
// on an unbounded board, with the camera following it as it travels. Cells far from the camera
// are dropped, so the trail of blocks behind it and the gliders thrown off the other way don't pile up.

// the 10-cell infinite growth pattern (conwaylife.com/wiki/Infinite_growth), flipped so the
// engine heads down and to the right; its stray gliders fly off up and to the left
const SEED = ["......O.", "....O.OO", "....O.O.", "....O...", "..O.....", "O.O....."].map((row) => [...row].reverse().join("")).reverse();

const CELL = 18; // css px
const GENS_PER_SEC = 20;
const YOUNG = 8; // generations a newborn cell stays highlighted
const CULL_MARGIN = 48; // cells kept beyond the screen's edge
// steady state shows the engine ahead of centre, leaving room for its trail behind it
const LEAD = 0.2;
const GRID = "rgba(154, 138, 224, 0.06)";
const OLD = "rgba(154, 138, 224, 0.32)";
const NEW = "rgba(255, 224, 61, 0.55)";

// cells as numeric keys; coordinates stay well inside the span for weeks of running, and we restart past LIMIT
const SPAN = 2 ** 24;
const OFF = 2 ** 23;
const LIMIT = 2 ** 22;
const key = (x: number, y: number) => (x + OFF) * SPAN + (y + OFF);
const keyX = (k: number) => Math.floor(k / SPAN) - OFF;
const keyY = (k: number) => (k % SPAN) - OFF;
const NEIGHBOURS = [-SPAN - 1, -SPAN, -SPAN + 1, -1, 1, SPAN - 1, SPAN, SPAN + 1];

export function startBackground(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  /** Live cells, mapped to the generation they were born in. */
  let live = new Map<number, number>();
  let gen = 0;
  // camera centre in cells, and where it's heading
  let camX = 0, camY = 0, targetX = 0, targetY = 0;
  let width = 0, height = 0;

  function seed() {
    live = new Map();
    gen = 0;
    SEED.forEach((row, y) => [...row].forEach((ch, x) => ch === "O" && live.set(key(x, y), 0)));
    camX = targetX = SEED[0].length / 2;
    camY = targetY = SEED.length / 2;
  }

  function step() {
    const counts = new Map<number, number>();
    for (const k of live.keys()) for (const d of NEIGHBOURS) counts.set(k + d, (counts.get(k + d) ?? 0) + 1);
    gen++;
    const next = new Map<number, number>();
    // the engine is wherever cells are being born furthest along its heading
    let front = -Infinity, sumX = 0, sumY = 0, n = 0;
    const births: number[] = [];
    const reach = Math.max(width, height) / CELL / 2 + CULL_MARGIN;
    for (const [k, c] of counts) {
      const born = live.get(k);
      if (c === 3 && born === undefined) {
        const x = keyX(k), y = keyY(k);
        if (Math.abs(x - camX) > reach || Math.abs(y - camY) > reach) continue;
        next.set(k, gen);
        births.push(k);
        front = Math.max(front, x + y);
      } else if (born !== undefined && (c === 2 || c === 3)) {
        if (Math.abs(keyX(k) - camX) > reach || Math.abs(keyY(k) - camY) > reach) continue;
        next.set(k, born);
      }
    }
    live = next;

    for (const k of births) {
      const x = keyX(k), y = keyY(k);
      if (x + y < front - 40) continue;
      sumX += x;
      sumY += y;
      n++;
    }
    if (n > 0) {
      // ease the lead in over the first stretch, while the seed is still settling into an engine
      const lead = Math.min(1, gen / 600) * LEAD;
      targetX = sumX / n - (lead * width) / CELL;
      targetY = sumY / n - (lead * height) / CELL;
    }
    if (live.size === 0 || Math.abs(camX) > LIMIT || Math.abs(camY) > LIMIT) seed();
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    // screen position of cell (0, 0)
    const ox = width / 2 - camX * CELL;
    const oy = height / 2 - camY * CELL;

    ctx.fillStyle = GRID;
    for (let x = ((ox % CELL) + CELL) % CELL; x < width; x += CELL) ctx.fillRect(Math.round(x), 0, 1, height);
    for (let y = ((oy % CELL) + CELL) % CELL; y < height; y += CELL) ctx.fillRect(0, Math.round(y), width, 1);

    for (const [k, born] of live) {
      const x = ox + keyX(k) * CELL;
      const y = oy + keyY(k) * CELL;
      if (x < -CELL || y < -CELL || x > width || y > height) continue;
      ctx.fillStyle = gen - born < YOUNG ? NEW : OLD;
      ctx.fillRect(Math.round(x) + 1, Math.round(y) + 1, CELL - 1, CELL - 1);
    }
  }

  resize();
  seed();
  window.addEventListener("resize", () => {
    resize();
    draw();
  });

  // without motion, show the pattern well into its growth and leave it there
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (let i = 0; i < 1500; i++) step();
    camX = targetX;
    camY = targetY;
    draw();
    return;
  }

  let last = performance.now();
  let pending = 0;
  function frame(now: number) {
    // a backgrounded tab pauses frames; don't race to catch up when it comes back
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    pending += dt * GENS_PER_SEC;
    for (; pending >= 1; pending--) step();
    const ease = 1 - Math.exp(-dt * 1.5);
    camX += (targetX - camX) * ease;
    camY += (targetY - camY) * ease;
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
