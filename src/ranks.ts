import type * as Phaser from "phaser";

/** The rank tiers from lowest to highest, as the server names them, each with its creature's art in public/. */
export const RANKS = [
  { name: "Species", art: "amoeba" },
  { name: "Genus", art: "jellyfish" },
  { name: "Family", art: "fish" },
  { name: "Order", art: "frog" },
  { name: "Class", art: "lizard" },
  { name: "Phylum", art: "trex" },
  { name: "Kingdom", art: "mamoth" },
  { name: "Domain", art: "human" },
];

/** Big art for a rank card, and small for a row of every rank. */
export const rankArt = (i: number, small = false) => `rank-${RANKS[i].art}${small ? "-sm" : ""}`;

/** Where a tier name sits in RANKS; an unknown one counts as the lowest. */
export const rankIndex = (tier: string) => Math.max(0, RANKS.findIndex((r) => r.name.toLowerCase() === tier.toLowerCase()));

/** Queue every rank's art, in both sizes, unless an earlier visit already has it. */
export function loadRankArt(scene: Phaser.Scene) {
  RANKS.forEach((r, i) => {
    for (const [small, size] of [
      [false, 360],
      [true, 64],
    ] as const) {
      const key = rankArt(i, small);
      if (!scene.textures.exists(key)) scene.load.svg(key, `${r.art}.svg`, { width: size, height: size });
    }
  });
}
