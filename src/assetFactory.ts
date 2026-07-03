import * as THREE from "three";
import type { EnemyAsset, EnemyKind } from "./assets/enemies/enemyContent";
import type { GltfAssetLibrary } from "./gltfAssetFactory";
import type { PlayerRig } from "./playerAsset";
import type { ResourceKind } from "./resourceTypes";

export const ENVIRONMENT_ASSET_KINDS = ["industrial-crate"] as const;

export type EnvironmentAssetKind = (typeof ENVIRONMENT_ASSET_KINDS)[number];
export type PickupAsset = { root: THREE.Object3D };
export type EnvironmentAsset = { root: THREE.Object3D };
export type PortalAsset = { root: THREE.Object3D };

export type AssetFactory = {
  createPlayerRig: () => PlayerRig;
  createEnemyAsset: (kind: EnemyKind) => EnemyAsset;
  createPickupAsset: (kind: ResourceKind) => PickupAsset;
  createEnvironmentAsset: (kind: EnvironmentAssetKind) => EnvironmentAsset;
  createExitPortalAsset: () => PortalAsset;
};

export function createAssetFactory(
  _loader: THREE.TextureLoader,
  _anisotropy: number,
  gltfAssets?: GltfAssetLibrary,
): AssetFactory {
  if (!gltfAssets) throw new Error("GLB asset library is required before creating runtime assets");

  return {
    createPlayerRig: () => requiredAsset(gltfAssets.createPlayerRig(), "player/player"),
    createEnemyAsset: (kind) => requiredAsset(gltfAssets.createEnemyAsset(kind), `enemy/${kind}`),
    createPickupAsset: (kind) => {
      return requiredAsset(gltfAssets.createPickupAsset(kind), `pickup/${kind}`);
    },
    createEnvironmentAsset: (kind) => requiredAsset(gltfAssets.createEnvironmentAsset(kind), `environment/${kind}`),
    createExitPortalAsset: () => requiredAsset(gltfAssets.createExitPortalAsset(), "environment/exit-portal"),
  };
}

function requiredAsset<T>(asset: T | null, id: string): T {
  if (!asset) throw new Error(`Missing runtime GLB asset: ${id}`);
  return asset;
}

export type { EnemyAsset, PlayerRig };
