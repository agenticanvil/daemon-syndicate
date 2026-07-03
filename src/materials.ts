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

type PreloadedFloorTextures = Partial<Record<FloorVariantId, THREE.Texture>>;

export async function preloadSceneTextures(
  loader: THREE.TextureLoader,
  anisotropy: number,
): Promise<PreloadedFloorTextures> {
  const entries = await Promise.all(
    FLOOR_VARIANTS.map(async (variant) => {
      const texture = await loader.loadAsync(variant.mapUrl);
      configureRepeatingTexture(texture, anisotropy, true);
      return [variant.id, texture] as const;
    }),
  );
  return Object.fromEntries(entries) as PreloadedFloorTextures;
}

export function createSceneMaterials(
  loader: THREE.TextureLoader,
  anisotropy: number,
  preloadedFloorTextures: PreloadedFloorTextures = {},
): SceneMaterials {
  return {
    level: {
      floors: createFloorMaterials(loader, anisotropy, preloadedFloorTextures),
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
  preloadedFloorTextures: PreloadedFloorTextures,
): Record<FloorVariantId, THREE.MeshStandardMaterial> {
  return Object.fromEntries(
    FLOOR_VARIANTS.map((variant) => {
      const map = preloadedFloorTextures[variant.id] ?? loadRepeatingTexture(loader, variant.mapUrl, anisotropy, true);

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
  configureRepeatingTexture(texture, anisotropy, useSrgbColorSpace);
  return texture;
}

function configureRepeatingTexture(
  texture: THREE.Texture,
  anisotropy: number,
  useSrgbColorSpace: boolean,
): void {
  if (useSrgbColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.anisotropy = anisotropy;
}
