import type * as Phaser from "phaser";

// Profile pictures: made small here before they're uploaded, then shown round on the board's badges.

/** The side of the square picture that's uploaded. */
const SIDE = 128;
/** The server and the Storage bucket refuse anything heavier. */
const MAX_BYTES = 65_536;

/**
 * A 128x128 picture from the chosen file, cropped to its middle square: WebP, or PNG where the browser can't make
 * WebP (older Safari). Lower quality is tried until it fits under the server's limit.
 */
export async function avatarBlob(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("couldn't read that picture; try a JPEG, PNG or WebP");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIDE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIDE, SIDE);
  bitmap.close();
  const encode = (type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  for (const quality of [0.85, 0.7, 0.5]) {
    let blob = await encode("image/webp", quality);
    // a browser that can't encode WebP hands back a PNG instead
    if (!blob || blob.type !== "image/webp") blob = await encode("image/png");
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("couldn't make that picture small enough");
}

const loading = new Map<string, Promise<string | null>>();

/**
 * A round texture of the picture at `url`, made once and kept by the game (textures outlive scenes): its key, or
 * null if the picture can't be loaded. The picture must allow cross-origin use, as Supabase Storage and the game
 * server do, or the browser won't let the game draw it.
 */
export function avatarTexture(scene: Phaser.Scene, url: string): Promise<string | null> {
  const key = `avatar:${url}`;
  if (scene.textures.exists(key)) return Promise.resolve(key);
  let pending = loading.get(key);
  if (!pending) {
    pending = new Promise<string | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const textures = scene.sys.game.textures;
        if (textures.exists(key)) return resolve(key);
        const canvas = textures.createCanvas(key, SIDE, SIDE);
        if (!canvas) return resolve(null);
        const ctx = canvas.getContext();
        ctx.beginPath();
        ctx.arc(SIDE / 2, SIDE / 2, SIDE / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, 0, 0, SIDE, SIDE);
        canvas.refresh();
        resolve(key);
      };
      // a missing or broken picture just means the badge keeps its letter
      img.onerror = () => {
        loading.delete(key);
        resolve(null);
      };
      img.src = url;
    });
    loading.set(key, pending);
  }
  return pending;
}
