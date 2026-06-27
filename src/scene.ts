import * as THREE from "three";
import { LEVEL_HEIGHT, LEVEL_WIDTH, RETICLE_FLOOR_OFFSET, TILE_SIZE } from "./constants";
import {
  createAssetFactory,
  type EliteEnemyAsset,
  type EnvironmentAsset,
  type EnvironmentAssetKind,
  type LeanHunterRig,
  type PickupAsset,
  type PlayerRig,
} from "./assetFactory";
import { exitGateToWorld, tileToWorld, type LevelData } from "./level";
import { renderLevel as renderLevelToRoot } from "./levelRenderer";
import { createSceneMaterials, type GameplayMaterials } from "./materials";
import { createRenderContext, type GraphicsSettings } from "./renderer";
import type { ResourceKind } from "./types";

export type { GraphicsSettings };

export type GameScene = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  floor: THREE.Mesh;
  player: THREE.Group;
  playerRig: PlayerRig;
  playerBody: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  reticle: THREE.Mesh;
  renderLevel: (level: LevelData) => void;
  createLeanHunterRig: () => LeanHunterRig;
  createEliteEnemyAsset: () => EliteEnemyAsset;
  createPickupAsset: (kind: ResourceKind) => PickupAsset;
  createEnvironmentAsset: (kind: EnvironmentAssetKind) => EnvironmentAsset;
  createExitPortalAsset: () => import("./assetFactory").ExitPortalAsset;
  materials: GameplayMaterials;
  resize: () => void;
  applyGraphicsSettings: (settings: GraphicsSettings) => void;
};

export function createGameScene(app: HTMLDivElement): GameScene {
  const renderContext = createRenderContext(app);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080a);
  scene.fog = new THREE.Fog(0x05080a, 28, 72);

  const levelRoot = new THREE.Group();
  scene.add(levelRoot);

  const loader = new THREE.TextureLoader();
  const anisotropy = renderContext.renderer.capabilities.getMaxAnisotropy();
  const assetFactory = createAssetFactory(loader, anisotropy);
  const materials = createSceneMaterials(loader, anisotropy);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(LEVEL_WIDTH * TILE_SIZE * 1.4, LEVEL_HEIGHT * TILE_SIZE * 1.4, 1, 1),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const playerRig = assetFactory.createPlayerRig();
  const player = playerRig.root;
  const playerBody = playerRig.body;
  scene.add(player);

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.52, 36),
    new THREE.MeshBasicMaterial({ color: 0x91fff0, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  reticle.rotation.x = -Math.PI / 2;
  reticle.position.y = RETICLE_FLOOR_OFFSET;
  reticle.renderOrder = 5;
  scene.add(reticle);

  addLighting(scene, player);

  const renderLevel = (level: LevelData): void => {
    renderLevelToRoot(levelRoot, level, materials.level);
    const exitPortal = assetFactory.createExitPortalAsset();
    const exitPosition = exitGateToWorld(level.end, level.exitDirection);
    exitPortal.root.position.set(exitPosition.x, 0, exitPosition.z);
    exitPortal.root.rotation.y = level.exitDirection === "east" ? Math.PI / 2 : 0;
    levelRoot.add(exitPortal.root);
    for (const object of level.environmentalObjects) {
      const asset = assetFactory.createEnvironmentAsset(object.kind);
      const position = tileToWorld(object.tile);
      asset.root.position.x = position.x;
      asset.root.position.z = position.z;
      asset.root.rotation.y = object.rotation;
      levelRoot.add(asset.root);
    }
  };

  return {
    get renderer() {
      return renderContext.renderer;
    },
    scene,
    camera: renderContext.camera,
    floor,
    player,
    playerRig,
    playerBody,
    reticle,
    renderLevel,
    createLeanHunterRig: assetFactory.createLeanHunterRig,
    createEliteEnemyAsset: assetFactory.createEliteEnemyAsset,
    createPickupAsset: assetFactory.createPickupAsset,
    createEnvironmentAsset: assetFactory.createEnvironmentAsset,
    createExitPortalAsset: assetFactory.createExitPortalAsset,
    materials: materials.gameplay,
    resize: renderContext.resize,
    applyGraphicsSettings: renderContext.applyGraphicsSettings,
  };
}

function addLighting(scene: THREE.Scene, player: THREE.Group): void {
  const ambient = new THREE.HemisphereLight(0x9cf3ff, 0x07110d, 0.55);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xe6fffa, 1.55);
  keyLight.position.set(13, 22, 8);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -26;
  keyLight.shadow.camera.right = 26;
  keyLight.shadow.camera.top = 26;
  keyLight.shadow.camera.bottom = -26;
  scene.add(keyLight);

  const alertLight = new THREE.PointLight(0xff3344, 18, 18);
  alertLight.position.set(-9, 5, -9);
  scene.add(alertLight);

  const armorFlashlight = new THREE.SpotLight(0xa8fff4, 36, 22, 0.45, 0.48, 1.7);
  armorFlashlight.position.set(0, 1.35, -0.28);
  armorFlashlight.target.position.set(0, 0.9, -9);
  player.add(armorFlashlight);
  player.add(armorFlashlight.target);
}
