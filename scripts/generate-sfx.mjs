import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 32_000;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets", "sfx");
const TWO_PI = Math.PI * 2;

const sounds = {
  "primary-fire": { duration: 0.18, render: primaryFire },
  "primary-impact": { duration: 0.22, render: primaryImpact },
  nova: { duration: 0.85, render: nova },
  dash: { duration: 0.24, render: dash },
  "player-hit": { duration: 0.36, render: playerHit },
  "enemy-hit": { duration: 0.16, render: enemyHit },
  "enemy-death": { duration: 0.52, render: enemyDeath },
  "pickup-health": { duration: 0.38, render: pickupHealth },
  "pickup-ammo": { duration: 0.3, render: pickupAmmo },
  "pickup-energy": { duration: 0.4, render: pickupEnergy },
  "level-transition": { duration: 0.72, render: levelTransition },
  "upgrade-select": { duration: 0.46, render: upgradeSelect },
  "ui-click": { duration: 0.1, render: uiClick },
  "game-over": { duration: 0.95, render: gameOver },
};

await mkdir(OUT_DIR, { recursive: true });

for (const [name, sound] of Object.entries(sounds)) {
  const samples = renderSound(sound.duration, sound.render);
  const wav = encodeWav(samples);
  await writeFile(join(OUT_DIR, `${name}.wav`), wav);
}

console.log(`Generated ${Object.keys(sounds).length} SFX in ${OUT_DIR}`);

function renderSound(duration, render) {
  const count = Math.ceil(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  const noise = createNoise(0x5f3759df);
  for (let i = 0; i < count; i += 1) {
    const t = i / SAMPLE_RATE;
    const p = i / Math.max(1, count - 1);
    samples[i] = clamp(render(t, p, noise), -1, 1);
  }
  return samples;
}

function primaryFire(t, p, noise) {
  const sweep = chirp(t, 780, 190, 0.14);
  const click = noise() * env(p, 0.005, 0.02, 1.0, 0.08);
  return saturate((square(sweep) * 0.22 + Math.sin(sweep) * 0.32 + click * 0.18) * env(p, 0.002, 0.03, 0.8, 0.12), 1.7);
}

function primaryImpact(t, p, noise) {
  const thud = Math.sin(chirp(t, 210, 58, 0.2)) * env(p, 0.001, 0.035, 0.7, 0.16);
  const grit = bandNoise(noise, 5) * env(p, 0.001, 0.02, 0.45, 0.1);
  return saturate(thud * 0.55 + grit * 0.35, 1.5);
}

function nova(t, p, noise) {
  const rise = Math.sin(chirp(t, 70, 820, 0.72)) * env(p, 0.02, 0.18, 0.85, 0.44);
  const ring = Math.sin(chirp(t, 240, 90, 0.85)) * env(p, 0.001, 0.04, 0.7, 0.62);
  const pressure = bandNoise(noise, 11) * env(p, 0.03, 0.18, 0.45, 0.58);
  return saturate(rise * 0.3 + ring * 0.5 + pressure * 0.16, 1.55);
}

function dash(t, p, noise) {
  const phase = chirp(t, 920, 120, 0.22);
  const air = highNoise(noise) * env(p, 0.001, 0.04, 0.75, 0.18);
  return saturate((Math.sin(phase) * 0.22 + saw(phase) * 0.16 + air * 0.24) * env(p, 0.001, 0.025, 0.9, 0.19), 1.4);
}

function playerHit(t, p, noise) {
  const alarm = Math.sin(chirp(t, 180, 88, 0.34)) * env(p, 0.001, 0.02, 0.8, 0.3);
  const crack = noise() * env(p, 0.001, 0.015, 0.7, 0.08);
  return saturate(alarm * 0.5 + crack * 0.28, 1.8);
}

function enemyHit(t, p, noise) {
  const snap = Math.sin(chirp(t, 420, 120, 0.12)) * env(p, 0.001, 0.015, 0.85, 0.12);
  const grit = noise() * env(p, 0.001, 0.012, 0.6, 0.06);
  return saturate(snap * 0.35 + grit * 0.18, 1.7);
}

function enemyDeath(t, p, noise) {
  const fall = Math.sin(chirp(t, 230, 38, 0.48)) * env(p, 0.001, 0.08, 0.85, 0.46);
  const staticBurst = bandNoise(noise, 7) * env(p, 0.001, 0.045, 0.55, 0.22);
  return saturate(fall * 0.48 + staticBurst * 0.24, 1.6);
}

function pickupHealth(t, p) {
  return pickupTone(t, p, 420, 560, 700);
}

function pickupAmmo(t, p) {
  return pickupTone(t, p, 300, 450, 600) * 0.9 + square(chirp(t, 110, 160, 0.16)) * env(p, 0.001, 0.02, 0.18, 0.14);
}

function pickupEnergy(t, p) {
  return pickupTone(t, p, 520, 780, 1040) * 0.85 + Math.sin(chirp(t, 880, 1320, 0.34)) * env(p, 0.02, 0.08, 0.22, 0.28);
}

function levelTransition(t, p) {
  const low = Math.sin(chirp(t, 90, 150, 0.7)) * env(p, 0.02, 0.2, 0.7, 0.5);
  const shimmer = Math.sin(chirp(t, 620, 1220, 0.68)) * env(p, 0.04, 0.16, 0.35, 0.44);
  return saturate(low * 0.42 + shimmer * 0.22, 1.4);
}

function upgradeSelect(t, p) {
  const a = Math.sin(TWO_PI * 430 * t) * env(p, 0.001, 0.04, 0.38, 0.18);
  const b = Math.sin(TWO_PI * 645 * Math.max(0, t - 0.09)) * env(Math.max(0, p - 0.2) / 0.8, 0.001, 0.05, 0.4, 0.28);
  const c = Math.sin(TWO_PI * 860 * Math.max(0, t - 0.18)) * env(Math.max(0, p - 0.4) / 0.6, 0.001, 0.06, 0.34, 0.34);
  return saturate(a * 0.42 + b * 0.36 + c * 0.28, 1.35);
}

function uiClick(t, p) {
  return Math.sin(chirp(t, 680, 460, 0.08)) * env(p, 0.001, 0.012, 0.5, 0.06);
}

function gameOver(t, p, noise) {
  const drop = Math.sin(chirp(t, 160, 32, 0.9)) * env(p, 0.005, 0.08, 0.75, 0.84);
  const hiss = bandNoise(noise, 13) * env(p, 0.01, 0.14, 0.26, 0.72);
  return saturate(drop * 0.5 + hiss * 0.12, 1.5);
}

function pickupTone(t, p, f1, f2, f3) {
  const segment = p < 0.33 ? f1 : p < 0.66 ? f2 : f3;
  const sparkle = Math.sin(TWO_PI * segment * t) + Math.sin(TWO_PI * segment * 2.01 * t) * 0.22;
  return sparkle * env(p, 0.002, 0.06, 0.5, 0.24) * 0.34;
}

function encodeWav(samples) {
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.round(clamp(samples[i], -1, 1) * 32767);
    buffer.writeInt16LE(sample, 44 + i * bytesPerSample);
  }
  return buffer;
}

function chirp(t, from, to, duration) {
  const k = (to - from) / Math.max(duration, 0.001);
  return TWO_PI * (from * t + 0.5 * k * t * t);
}

function env(p, attack, hold, level, release) {
  if (p <= attack) return (p / Math.max(attack, 0.0001)) * level;
  if (p <= attack + hold) return level;
  const releaseProgress = (p - attack - hold) / Math.max(release, 0.0001);
  return Math.max(0, level * (1 - releaseProgress));
}

function square(phase) {
  return Math.sin(phase) >= 0 ? 1 : -1;
}

function saw(phase) {
  return 2 * (phase / TWO_PI - Math.floor(phase / TWO_PI + 0.5));
}

function saturate(value, drive) {
  return Math.tanh(value * drive);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function createNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

function bandNoise(noise, samples) {
  let total = 0;
  for (let i = 0; i < samples; i += 1) total += noise();
  return total / samples;
}

function highNoise(noise) {
  return noise() - bandNoise(noise, 5);
}
