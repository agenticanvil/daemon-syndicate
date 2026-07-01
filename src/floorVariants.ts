import type * as THREE from "three";
import type { Rng } from "./rng";

export type FloorVariantDefinition = {
  id: string;
  mapUrl: string;
  normalMapUrl: string;
  weight: number;
  normalScale: THREE.Vector2Tuple;
  roughness: number;
  metalness: number;
};

export const FLOOR_VARIANTS = [
  {
    id: "facility-floor",
    mapUrl: "/assets/floors/facility-floor.png",
    normalMapUrl: "/assets/floors/facility-floor-normal.png",
    weight: 4,
    normalScale: [0.28, 0.28],
    roughness: 0.78,
    metalness: 0.42,
  },
  {
    id: "cyber-panel",
    mapUrl: "/assets/floors/cyber-panel.png",
    normalMapUrl: "/assets/floors/cyber-panel-normal.png",
    weight: 3,
    normalScale: [0.3, 0.3],
    roughness: 0.76,
    metalness: 0.46,
  },
  {
    id: "maintenance-grate",
    mapUrl: "/assets/floors/maintenance-grate.png",
    normalMapUrl: "/assets/floors/maintenance-grate-normal.png",
    weight: 2,
    normalScale: [0.34, 0.34],
    roughness: 0.82,
    metalness: 0.38,
  },
  {
    id: "lab-plate",
    mapUrl: "/assets/floors/lab-plate.png",
    normalMapUrl: "/assets/floors/lab-plate-normal.png",
    weight: 2,
    normalScale: [0.22, 0.22],
    roughness: 0.7,
    metalness: 0.34,
  },
  {
    id: "corrosion-plate",
    mapUrl: "/assets/floors/corrosion-plate.png",
    normalMapUrl: "/assets/floors/corrosion-plate-normal.png",
    weight: 2,
    normalScale: [0.32, 0.32],
    roughness: 0.86,
    metalness: 0.32,
  },
] as const satisfies readonly FloorVariantDefinition[];

export type FloorVariantId = (typeof FLOOR_VARIANTS)[number]["id"];

export const DEFAULT_FLOOR_VARIANT_ID: FloorVariantId = "facility-floor";

export function chooseFloorVariant(rng: Rng): FloorVariantId {
  const totalWeight = FLOOR_VARIANTS.reduce((sum, variant) => sum + variant.weight, 0);
  let roll = rng() * totalWeight;

  for (const variant of FLOOR_VARIANTS) {
    roll -= variant.weight;
    if (roll <= 0) return variant.id;
  }

  return DEFAULT_FLOOR_VARIANT_ID;
}
