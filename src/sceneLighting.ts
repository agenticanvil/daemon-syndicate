import * as THREE from "three";

const KEY_LIGHT_OFFSET = new THREE.Vector3(13, 22, 8);

export type GameplayLighting = {
  update: (playerPosition: THREE.Vector3) => void;
};

export function addGameplayLighting(scene: THREE.Scene, playerLightAnchor: THREE.Group): GameplayLighting {
  const ambient = new THREE.HemisphereLight(0x9cf3ff, 0x07110d, 0.55);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xe6fffa, 1.55);
  keyLight.position.copy(KEY_LIGHT_OFFSET);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -26;
  keyLight.shadow.camera.right = 26;
  keyLight.shadow.camera.top = 26;
  keyLight.shadow.camera.bottom = -26;
  scene.add(keyLight);
  scene.add(keyLight.target);

  const alertLight = new THREE.PointLight(0xff3344, 18, 18);
  alertLight.position.set(-9, 5, -9);
  scene.add(alertLight);

  const armorFlashlight = new THREE.SpotLight(0xa8fff4, 48, 28, 0.62, 0.48, 1.7);
  armorFlashlight.position.set(0, 1.35, -0.28);
  armorFlashlight.target.position.set(0, 0.8, -14);
  playerLightAnchor.add(armorFlashlight);
  playerLightAnchor.add(armorFlashlight.target);

  return {
    update: (playerPosition) => {
      keyLight.target.position.copy(playerPosition);
      keyLight.position.copy(playerPosition).add(KEY_LIGHT_OFFSET);
    },
  };
}
