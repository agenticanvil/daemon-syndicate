import type { Rng } from "./rng";

export type FloorVariantDefinition = {
  id: string;
  mapUrl: string;
  weight: number;
  roughness: number;
  metalness: number;
};

export const FLOOR_VARIANTS = [
  {
    id: "cyber-panel",
    mapUrl: "/assets/floors/muted-cyber-floor.png",
    weight: 3,
    roughness: 0.8,
    metalness: 0.42,
  },
] as const satisfies readonly FloorVariantDefinition[];

export type FloorVariantId = (typeof FLOOR_VARIANTS)[number]["id"];

export const DEFAULT_FLOOR_VARIANT_ID: FloorVariantId = "cyber-panel";

export function chooseFloorVariant(rng: Rng): FloorVariantId {
  const totalWeight = FLOOR_VARIANTS.reduce((sum, variant) => sum + variant.weight, 0);
  let roll = rng() * totalWeight;

  for (const variant of FLOOR_VARIANTS) {
    roll -= variant.weight;
    if (roll <= 0) return variant.id;
  }

  return DEFAULT_FLOOR_VARIANT_ID;
}
