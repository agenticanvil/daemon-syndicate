import * as THREE from "three";

const PLAYER_READABILITY_LIGHT_LAYER = 1;
const KEY_LIGHT_OFFSET = new THREE.Vector3(13, 22, 8);
const CAMERA_SIDE_LIGHT_DISTANCE = 7.8;
const CAMERA_SIDE_LIGHT_LEFT_OFFSET = 2.6;
const CAMERA_SIDE_LIGHT_TARGET_HEIGHT = 0.9;
const CAMERA_SIDE_LIGHT_HEIGHT = 1.15;
const CAMERA_SIDE_LIGHT_TO_CAMERA = new THREE.Vector3();
const CAMERA_SIDE_LIGHT_LEFT = new THREE.Vector3();
const CAMERA_SIDE_LIGHT_TARGET = new THREE.Vector3();

export type GameplayLighting = {
  update: (playerPosition: THREE.Vector3, camera: THREE.Camera) => void;
};

export function addGameplayLighting(scene: THREE.Scene, playerLightAnchor: THREE.Group): GameplayLighting {
  enableLightingLayer(playerLightAnchor, PLAYER_READABILITY_LIGHT_LAYER);

  const ambient = new THREE.HemisphereLight(0x9cf3ff, 0x07110d, 0.55);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xe6fffa, 1.55);
  keyLight.position.copy(KEY_LIGHT_OFFSET);
  keyLight.castShadow = false;
  scene.add(keyLight);
  scene.add(keyLight.target);

  const alertLight = new THREE.PointLight(0xff3344, 18, 18);
  alertLight.position.set(-9, 5, -9);
  scene.add(alertLight);

  const armorFlashlight = new THREE.SpotLight(0xa8fff4, 48, 28, 0.62, 0.48, 1.7);
  armorFlashlight.position.set(0, 1.35, -0.28);
  armorFlashlight.target.position.set(0, 0.8, -14);
  armorFlashlight.castShadow = true;
  armorFlashlight.shadow.mapSize.set(1024, 1024);
  armorFlashlight.shadow.camera.near = 0.5;
  armorFlashlight.shadow.camera.far = 28;
  armorFlashlight.shadow.bias = -0.0002;
  armorFlashlight.shadow.normalBias = 0.03;
  playerLightAnchor.add(armorFlashlight);
  playerLightAnchor.add(armorFlashlight.target);

  const cameraSideKeyLight = new THREE.SpotLight(0xc8fff6, 7.4, 12, 0.72, 0.78, 1.35);
  cameraSideKeyLight.castShadow = false;
  cameraSideKeyLight.layers.set(PLAYER_READABILITY_LIGHT_LAYER);
  scene.add(cameraSideKeyLight);
  scene.add(cameraSideKeyLight.target);

  return {
    update: (playerPosition, camera) => {
      camera.updateMatrixWorld();

      keyLight.target.position.copy(playerPosition);
      keyLight.position.copy(playerPosition).add(KEY_LIGHT_OFFSET);

      CAMERA_SIDE_LIGHT_TARGET.copy(playerPosition).setY(playerPosition.y + CAMERA_SIDE_LIGHT_TARGET_HEIGHT);
      CAMERA_SIDE_LIGHT_TO_CAMERA.copy(camera.position).sub(CAMERA_SIDE_LIGHT_TARGET);
      CAMERA_SIDE_LIGHT_TO_CAMERA.setY(0);
      if (CAMERA_SIDE_LIGHT_TO_CAMERA.lengthSq() < 0.0001) {
        CAMERA_SIDE_LIGHT_TO_CAMERA.copy(KEY_LIGHT_OFFSET);
        CAMERA_SIDE_LIGHT_TO_CAMERA.setY(0);
      }
      CAMERA_SIDE_LIGHT_TO_CAMERA.normalize().multiplyScalar(CAMERA_SIDE_LIGHT_DISTANCE);

      CAMERA_SIDE_LIGHT_LEFT.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-1).setY(0);
      if (CAMERA_SIDE_LIGHT_LEFT.lengthSq() < 0.0001) {
        CAMERA_SIDE_LIGHT_LEFT.set(-1, 0, 0);
      }
      CAMERA_SIDE_LIGHT_LEFT.normalize().multiplyScalar(CAMERA_SIDE_LIGHT_LEFT_OFFSET);

      cameraSideKeyLight.target.position.copy(CAMERA_SIDE_LIGHT_TARGET);
      cameraSideKeyLight.position
        .copy(CAMERA_SIDE_LIGHT_TARGET)
        .add(CAMERA_SIDE_LIGHT_TO_CAMERA)
        .add(CAMERA_SIDE_LIGHT_LEFT);
      cameraSideKeyLight.position.y = playerPosition.y + CAMERA_SIDE_LIGHT_HEIGHT;
    },
  };
}

function enableLightingLayer(root: THREE.Object3D, layer: number): void {
  root.traverse((object) => object.layers.enable(layer));
}
