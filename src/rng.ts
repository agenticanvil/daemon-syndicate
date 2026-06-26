export type Rng = () => number;

export function seededRandom(seed: string): Rng {
  let state = 0;
  for (let i = 0; i < seed.length; i += 1) {
    state = Math.imul(31, state) + seed.charCodeAt(i);
  }

  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}
