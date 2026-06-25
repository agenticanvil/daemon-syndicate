import * as THREE from "three";
import energyPickupSettings from "./energyPickup.settings.json";

export const ENERGY_PICKUP_SETTINGS = energyPickupSettings;

export type EnergyPickupAsset = {
  root: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>;
};

export function createEnergyPickupAsset(): EnergyPickupAsset {
  const root = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), createEnergyPickupMaterial());
  root.position.y = 0.45;
  root.castShadow = true;
  return { root };
}

function createEnergyPickupMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x65d7ff, emissive: 0x052439 });
}
