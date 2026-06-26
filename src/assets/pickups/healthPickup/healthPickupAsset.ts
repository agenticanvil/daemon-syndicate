import * as THREE from "three";
import type { PickupAssetSettings } from "../../../assetSettings";
import healthPickupSettings from "./healthPickup.settings.json";

export const HEALTH_PICKUP_SETTINGS = healthPickupSettings as PickupAssetSettings;

export type HealthPickupAsset = {
  root: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
};

export function createHealthPickupAsset(): HealthPickupAsset {
  const root = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 8), createHealthPickupMaterial());
  root.position.y = 0.45;
  root.castShadow = true;
  return { root };
}

function createHealthPickupMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xff5668, emissive: 0x290406 });
}
