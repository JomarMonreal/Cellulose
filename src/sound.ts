import * as Phaser from "phaser";

// "Pop_9.aif" by SunnySideSound (https://freesound.org/s/67095/), CC BY 4.0; converted from AIFF to Ogg and MP3,
// since most browsers can't play AIFF, and raised 21 dB (it peaked at -22 dB; now -1 dB). Credited on the home
// screen and in the README.
const POP = "pop";
// one pop per generation at most, and never closer together than this (the playground can run 16x)
const MIN_GAP_MS = 60;
const QUIET = 0.15;
const LOUD = 0.2;
// births it takes to reach full volume
const LOUD_BIRTHS = 20;
// placing a cell yourself pops a little louder than a birth, so it reads as your doing
const PLACE_VOLUME = 0.3;
// dragging across the playground places many at once; at most one pop this often
const PLACE_GAP_MS = 40;
let lastPop = 0;
let lastPlacePop = 0;

/** Music: bass_background behind the menus, the playground and the tutorial; gameplay while a game is on. */
export type Track = "menu" | "game";
const TRACKS: Record<Track, { key: string; file: string }> = {
  menu: { key: "music-menu", file: "bass_background.mp3" },
  game: { key: "music-game", file: "gameplay.mp3" },
};
// the music's loudest, at 100% in the settings: under the sound effects
const MUSIC_MAX = 0.5;
const FADE_MS = 600;

// the player's settings, remembered in this browser
const SFX_KEY = "cellulose:sfxVolume";
const MUSIC_KEY = "cellulose:musicVolume";
// muting (the speaker button, M) silences both without losing the volumes
// (not "cellulose:muted": that's the chat's list of muted players)
const MUTED_KEY = "cellulose:audioMuted";

function read(key: string, fallback: number) {
  try {
    const v = Number(localStorage.getItem(key) ?? NaN);
    return Number.isFinite(v) ? Phaser.Math.Clamp(v, 0, 1) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage is blocked (some private modes): the setting lasts until the page closes
  }
}

let sfxVolume = read(SFX_KEY, 1);
let musicVolume = read(MUSIC_KEY, 0.6);
let muted = read(MUTED_KEY, 0) === 1;

/** Sound effects volume, 0 to 1. */
export const getSfxVolume = () => sfxVolume;
export const getMusicVolume = () => musicVolume;
export const isMuted = () => muted;

export function setSfxVolume(v: number) {
  sfxVolume = Phaser.Math.Clamp(v, 0, 1);
  write(SFX_KEY, String(sfxVolume));
}

export function setMusicVolume(v: number) {
  musicVolume = Phaser.Math.Clamp(v, 0, 1);
  write(MUSIC_KEY, String(musicVolume));
  applyMusicVolume();
}

export function setMuted(on: boolean) {
  muted = on;
  write(MUTED_KEY, on ? "1" : "0");
  applyMusicVolume();
}

/** Queue the pop, unless an earlier scene already has it. The browser picks whichever format it can play. */
export function loadSounds(scene: Phaser.Scene) {
  if (!scene.cache.audio.exists(POP)) scene.load.audio(POP, ["pop.ogg", "pop.mp3"]);
}

function pop(scene: Phaser.Scene, volume: number) {
  const v = volume * sfxVolume;
  if (muted || v <= 0 || !scene.cache.audio.exists(POP)) return;
  scene.sound.play(POP, { volume: v, detune: Phaser.Math.Between(-150, 150) });
}

/**
 * A pop for the cells born in a generation: louder the more were born, its pitch varied a little so a long run
 * doesn't drone. Browsers only allow sound after the player has clicked or pressed a key; until then it's silent.
 */
export function popForBirths(scene: Phaser.Scene, births: number) {
  if (births <= 0) return;
  const now = performance.now();
  if (now - lastPop < MIN_GAP_MS) return;
  lastPop = now;
  pop(scene, QUIET + (LOUD - QUIET) * Math.min(1, births / LOUD_BIRTHS));
}

/** A pop for a cell the player placed themselves, a little louder than a birth. */
export function popForPlace(scene: Phaser.Scene) {
  const now = performance.now();
  if (now - lastPlacePop < PLACE_GAP_MS) return;
  lastPlacePop = now;
  pop(scene, PLACE_VOLUME);
}

// the music: one track at a time, across every scene (the sound manager outlives scenes)
let wanted: Track | null = null;
let playing: { track: Track; sound: Phaser.Sound.BaseSound } | null = null;

const musicLevel = () => (muted ? 0 : musicVolume * MUSIC_MAX);

function applyMusicVolume() {
  // mid-fade, the fade itself heads for the new level
  if (playing && !fades.has(playing.sound)) (playing.sound as Phaser.Sound.WebAudioSound).setVolume(musicLevel());
}

/**
 * Play `track` on a loop from now on, fading out whatever played before. A track that isn't loaded yet is loaded
 * in the background first (so the music never holds up a screen), and nothing starts until the browser allows sound.
 */
export function playMusic(scene: Phaser.Scene, track: Track) {
  wanted = track;
  if (playing?.track === track) return;
  const { key, file } = TRACKS[track];
  if (!scene.cache.audio.exists(key)) {
    scene.load.audio(key, file);
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => wanted === track && startTrack(scene, track));
    if (!scene.load.isLoading()) scene.load.start();
    return;
  }
  startTrack(scene, track);
}

function startTrack(scene: Phaser.Scene, track: Track) {
  if (playing?.track === track) return;
  const manager = scene.sound;
  if (manager.locked) {
    manager.once(Phaser.Sound.Events.UNLOCKED, () => wanted === track && startTrack(scene, track));
    return;
  }
  const old = playing;
  if (old) fade(old.sound, 0, () => old.sound.destroy());
  const sound = manager.add(TRACKS[track].key, { loop: true, volume: 0 }) as Phaser.Sound.WebAudioSound;
  sound.play();
  playing = { track, sound };
  fade(sound, musicLevel());
}

// fades run on a plain timer rather than a scene's tweens: the scene that started one may close before it ends
const fades = new Map<Phaser.Sound.BaseSound, number>();

/** Bring a sound's volume to `to` over FADE_MS, then call `done`. A new fade on the same sound replaces the old. */
function fade(sound: Phaser.Sound.BaseSound, to: number, done?: () => void) {
  const s = sound as Phaser.Sound.WebAudioSound;
  clearInterval(fades.get(sound));
  const from = s.volume;
  const start = performance.now();
  const timer = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / FADE_MS);
    // a fade in follows the volume setting as it moves, so a slider dragged mid-fade still lands where it's set
    const target = sound === playing?.sound ? musicLevel() : to;
    s.setVolume(from + (target - from) * t);
    if (t < 1) return;
    clearInterval(timer);
    fades.delete(sound);
    done?.();
  }, 30);
  fades.set(sound, timer);
}
