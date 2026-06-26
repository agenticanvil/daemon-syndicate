import * as THREE from "three";
import { createEliteEnemyAsset, type EliteEnemyAsset } from "./assets/enemies/eliteEnemy/eliteEnemyAsset";
import { loadLeanHunterRig, type LeanHunterRig } from "./assets/enemies/leanHunterAsset";
import {
  createIndustrialCrateAsset,
  type EnvironmentAssetKind,
  type IndustrialCrateAsset,
} from "./assets/environment/industrialCrate/industrialCrateAsset";
import { createAmmoPickupAsset, type AmmoPickupAsset } from "./assets/pickups/ammoPickup/ammoPickupAsset";
import { createEnergyPickupAsset, type EnergyPickupAsset } from "./assets/pickups/energyPickup/energyPickupAsset";
import { createHealthPickupAsset, type HealthPickupAsset } from "./assets/pickups/healthPickup/healthPickupAsset";
import { loadPlayerRig, type PlayerRig } from "./playerAsset";
import type { ResourceKind } from "./types";

export type PickupAsset = AmmoPickupAsset | EnergyPickupAsset | HealthPickupAsset;
export type EnvironmentAsset = IndustrialCrateAsset;

export type AssetFactory = {
  createPlayerRig: () => PlayerRig;
  createLeanHunterRig: () => LeanHunterRig;
  createEliteEnemyAsset: () => EliteEnemyAsset;
  createPickupAsset: (kind: ResourceKind) => PickupAsset;
  createEnvironmentAsset: (kind: EnvironmentAssetKind) => EnvironmentAsset;
};

export function createAssetFactory(loader: THREE.TextureLoader, anisotropy: number): AssetFactory {
  return {
    createPlayerRig: () => loadPlayerRig(loader, anisotropy),
    createLeanHunterRig: () => loadLeanHunterRig(loader, anisotropy),
    createEliteEnemyAsset: () => createEliteEnemyAsset(loader, anisotropy),
    createPickupAsset: (kind) => {
      if (kind === "ammo") return createAmmoPickupAsset();
      if (kind === "energy") return createEnergyPickupAsset();
      return createHealthPickupAsset();
    },
    createEnvironmentAsset: () => createIndustrialCrateAsset(loader, anisotropy),
  };
}

export type { EliteEnemyAsset, EnvironmentAssetKind, LeanHunterRig, PlayerRig };
