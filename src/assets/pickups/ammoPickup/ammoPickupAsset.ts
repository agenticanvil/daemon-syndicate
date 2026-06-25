import * as THREE from "three";
import ammoPickupSettings from "./ammoPickup.settings.json";

export const AMMO_PICKUP_SETTINGS = ammoPickupSettings;

export type AmmoPickupAsset = {
  root: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
};

export function createAmmoPickupAsset(): AmmoPickupAsset {
  const root = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.55), createAmmoPickupMaterial());
  root.position.y = 0.45;
  root.castShadow = true;
  return { root };
}

function createAmmoPickupMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xffc857, emissive: 0x2a1801 });
}
