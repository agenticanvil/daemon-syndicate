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
import { loadPlayerRig, type PlayerRig } from "./playerAsset";
import type { ResourceKind } from "./resourceTypes";

export type PickupAsset = AmmoPickupAsset | EnergyPickupAsset | HealthPickupAsset;
export type EnvironmentAsset = IndustrialCrateAsset;

export type AssetFactory = {
  createPlayerRig: () => PlayerRig;
  createEnemyAsset: (kind: EnemyKind) => EnemyAsset;
  createPickupAsset: (kind: ResourceKind) => PickupAsset;
  createEnvironmentAsset: (kind: EnvironmentAssetKind) => EnvironmentAsset;
  createExitPortalAsset: () => ExitPortalAsset;
};

export function createAssetFactory(loader: THREE.TextureLoader, anisotropy: number): AssetFactory {
  return {
    createPlayerRig: () => loadPlayerRig(loader, anisotropy),
    createEnemyAsset: (kind) => enemyContentFor(kind).createAsset(loader, anisotropy),
    createPickupAsset: (kind) => {
      if (kind === "ammo") return createAmmoPickupAsset();
      if (kind === "energy") return createEnergyPickupAsset();
      return createHealthPickupAsset();
    },
    createEnvironmentAsset: () => createIndustrialCrateAsset(loader, anisotropy),
    createExitPortalAsset: () => createExitPortalAsset(loader, anisotropy),
  };
}

export type { EnemyAsset, EnvironmentAssetKind, PlayerRig };
