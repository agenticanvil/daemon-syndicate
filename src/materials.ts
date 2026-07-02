import * as THREE from "three";
import { FLOOR_VARIANTS, type FloorVariantId } from "./floorVariants";
import type { LevelRenderMaterials } from "./levelRenderer";

export type GameplayMaterials = {
  enemy: THREE.MeshStandardMaterial;
  projectile: THREE.MeshBasicMaterial;
  nova: THREE.MeshBasicMaterial;
  gate: THREE.MeshStandardMaterial;
};

export type SceneMaterials = {
  level: LevelRenderMaterials;
  gameplay: GameplayMaterials;
};

export function createSceneMaterials(loader: THREE.TextureLoader, anisotropy: number): SceneMaterials {
  return {
    level: {
      floors: createFloorMaterials(loader, anisotropy),
      edge: new THREE.MeshStandardMaterial({ color: 0x111b1e, roughness: 0.86, metalness: 0.32 }),
      void: new THREE.MeshBasicMaterial({ color: 0x010304 }),
      rim: new THREE.MeshBasicMaterial({ color: 0x2ddbd2, transparent: true, opacity: 0.36 }),
    },
    gameplay: {
      enemy: new THREE.MeshStandardMaterial({
        color: 0x8cff55,
        emissive: 0x143b08,
        roughness: 0.48,
        metalness: 0.25,
      }),
      projectile: new THREE.MeshBasicMaterial({ color: 0x9bf0df }),
      nova: new THREE.MeshBasicMaterial({
        color: 0x67ddff,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
      }),
      gate: new THREE.MeshStandardMaterial({
        color: 0x9bf0df,
        emissive: 0x0f5f58,
        roughness: 0.2,
        metalness: 0.55,
      }),
    },
  };
}

function createFloorMaterials(
  loader: THREE.TextureLoader,
  anisotropy: number,
): Record<FloorVariantId, THREE.MeshStandardMaterial> {
  return Object.fromEntries(
    FLOOR_VARIANTS.map((variant) => {
      const map = loadRepeatingTexture(loader, variant.mapUrl, anisotropy, true);

      return [
        variant.id,
        new THREE.MeshStandardMaterial({
          map,
          roughness: variant.roughness,
          metalness: variant.metalness,
        }),
      ];
    }),
  ) as Record<FloorVariantId, THREE.MeshStandardMaterial>;
}

function loadRepeatingTexture(
  loader: THREE.TextureLoader,
  url: string,
  anisotropy: number,
  useSrgbColorSpace: boolean,
): THREE.Texture {
  const texture = loader.load(url);
  if (useSrgbColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.anisotropy = anisotropy;
  return texture;
}
