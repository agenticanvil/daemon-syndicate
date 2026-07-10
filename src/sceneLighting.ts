import * as THREE from "three";

const OVERHEAD_POOL_CAMERA_OFFSET = 3.2;
const OVERHEAD_POOL_LEFT_OFFSET = -0.45;
const OVERHEAD_POOL_HEIGHT = 5.4;
const OVERHEAD_POOL_TO_CAMERA = new THREE.Vector3();
const OVERHEAD_POOL_LEFT = new THREE.Vector3();
const OVERHEAD_POOL_TARGET = new THREE.Vector3();

export type GameplayLighting = {
  update: (playerPosition: THREE.Vector3, camera: THREE.Camera) => void;
};

export function addGameplayLighting(scene: THREE.Scene, playerLightAnchor: THREE.Group): GameplayLighting {
  const ambient = new THREE.HemisphereLight(0x75b7b9, 0x020504, 0.16);
  scene.add(ambient);

  const alertLight = new THREE.PointLight(0xff3344, 18, 18);
  alertLight.position.set(-9, 5, -9);
  scene.add(alertLight);

  const overheadPoolLight = new THREE.SpotLight(0x82aaa7, 24, 18, 1.1, 0.9, 1.4);
  overheadPoolLight.castShadow = false;
  scene.add(overheadPoolLight);
  scene.add(overheadPoolLight.target);

  const armorFlashlight = new THREE.SpotLight(0xa8fff4, 72, 38, 0.74, 0.62, 1.45);
  armorFlashlight.position.set(0, 1.35, -0.28);
  armorFlashlight.target.position.set(0, 0.8, -14);
  armorFlashlight.castShadow = true;
  armorFlashlight.shadow.mapSize.set(1024, 1024);
  armorFlashlight.shadow.camera.near = 0.12;
  armorFlashlight.shadow.camera.far = 38;
  armorFlashlight.shadow.bias = -0.00005;
  armorFlashlight.shadow.normalBias = 0.001;
  playerLightAnchor.add(armorFlashlight);
  playerLightAnchor.add(armorFlashlight.target);

  return {
    update: (playerPosition, camera) => {
      camera.updateMatrixWorld();

      OVERHEAD_POOL_TARGET.copy(playerPosition).setY(playerPosition.y + 0.12);
      OVERHEAD_POOL_TO_CAMERA.copy(camera.position).sub(OVERHEAD_POOL_TARGET);
      OVERHEAD_POOL_TO_CAMERA.setY(0);
      if (OVERHEAD_POOL_TO_CAMERA.lengthSq() < 0.0001) {
        OVERHEAD_POOL_TO_CAMERA.set(1, 0, 1);
      }
      OVERHEAD_POOL_TO_CAMERA.normalize();

      OVERHEAD_POOL_LEFT.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-1).setY(0);
      if (OVERHEAD_POOL_LEFT.lengthSq() < 0.0001) {
        OVERHEAD_POOL_LEFT.set(-1, 0, 0);
      }
      OVERHEAD_POOL_LEFT.normalize();

      overheadPoolLight.target.position.copy(OVERHEAD_POOL_TARGET);
      overheadPoolLight.position
        .copy(OVERHEAD_POOL_TARGET)
        .addScaledVector(OVERHEAD_POOL_TO_CAMERA, OVERHEAD_POOL_CAMERA_OFFSET)
        .addScaledVector(OVERHEAD_POOL_LEFT, OVERHEAD_POOL_LEFT_OFFSET);
      overheadPoolLight.position.y = playerPosition.y + OVERHEAD_POOL_HEIGHT;
    },
  };
}
