import * as THREE from "three";
import { enemyContentFor, type EnemyAsset, type EnemyKind } from "./assets/enemies/enemyContent";
import {
  createIndustrialCrateAsset,
  type EnvironmentAssetKind,
  type IndustrialCrateAsset,
} from "./assets/environment/industrialCrate/industrialCrateAsset";
import { createExitPortalAsset, type ExitPortalAsset } from "./assets/environment/exitPortal/exitPortalAsset";
import { createAmmoPickupAsset, type AmmoPickupAsset } from "./assets/pickups/ammoPickup/ammoPickupAsset";
import { createEnergyPickupAsset, type EnergyPickupAsset } from "./assets/pickups/energyPickup/energyPickupAsset";
import { createHealthPickupAsset, type HealthPickupAsset } from "./assets/pickups/healthPickup/healthPickupAsset";
import type { GltfAssetLibrary } from "./gltfAssetFactory";
import { loadPlayerRig, type PlayerRig } from "./playerAsset";
import type { ResourceKind } from "./resourceTypes";

export type PickupAsset = AmmoPickupAsset | EnergyPickupAsset | HealthPickupAsset | { root: THREE.Object3D };
export type EnvironmentAsset = IndustrialCrateAsset | { root: THREE.Object3D };
export type PortalAsset = ExitPortalAsset | { root: THREE.Object3D };

export type AssetFactory = {
  createPlayerRig: () => PlayerRig;
  createEnemyAsset: (kind: EnemyKind) => EnemyAsset;
  createPickupAsset: (kind: ResourceKind) => PickupAsset;
  createEnvironmentAsset: (kind: EnvironmentAssetKind) => EnvironmentAsset;
  createExitPortalAsset: () => PortalAsset;
};

export function createAssetFactory(
  loader: THREE.TextureLoader,
  anisotropy: number,
  gltfAssets?: GltfAssetLibrary,
): AssetFactory {
  return {
    createPlayerRig: () => gltfAssets?.createPlayerRig() ?? loadPlayerRig(loader, anisotropy),
    createEnemyAsset: (kind) => gltfAssets?.createEnemyAsset(kind) ?? enemyContentFor(kind).createAsset(loader, anisotropy),
    createPickupAsset: (kind) => {
      const gltfPickup = gltfAssets?.createPickupAsset(kind);
      if (gltfPickup) return gltfPickup;
      if (kind === "ammo") return createAmmoPickupAsset();
      if (kind === "energy") return createEnergyPickupAsset();
      return createHealthPickupAsset();
    },
    createEnvironmentAsset: (kind) => gltfAssets?.createEnvironmentAsset(kind) ?? createIndustrialCrateAsset(loader, anisotropy),
    createExitPortalAsset: () => gltfAssets?.createExitPortalAsset() ?? createExitPortalAsset(loader, anisotropy),
  };
}

export type { EnemyAsset, EnvironmentAssetKind, PlayerRig };
