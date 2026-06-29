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
  type VenomSpitterAsset,
} from "./assetFactory";
import { exitGateToWorld, key, tileToWorld, worldToTile, type ExitDirection, type LevelData, type TileCoord } from "./level";
import { FogOfWar } from "./fogOfWar";
import { renderLevel as renderLevelToRoot, type LevelEdgeVisibility } from "./levelRenderer";
import { createSceneMaterials, type GameplayMaterials } from "./materials";
import { createPlayerLocalAmbient } from "./playerLocalAmbient";
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
  createVenomSpitterAsset: () => VenomSpitterAsset;
  createPickupAsset: (kind: ResourceKind) => PickupAsset;
  createEnvironmentAsset: (kind: EnvironmentAssetKind) => EnvironmentAsset;
  createExitPortalAsset: () => import("./assetFactory").ExitPortalAsset;
  updateFog: (playerPosition: THREE.Vector3, dt: number, instant?: boolean) => void;
  updatePlayerLocalAmbient: (playerPosition: THREE.Vector3) => void;
  isTileExplored: (position: THREE.Vector3) => boolean;
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
  const playerLocalAmbient = createPlayerLocalAmbient();
  playerLocalAmbient.applyToMaterial(materials.level.floor);
  playerLocalAmbient.applyToMaterial(materials.level.edge);
  playerLocalAmbient.applyToMaterial(materials.gameplay.enemy);
  playerLocalAmbient.applyToMaterial(materials.gameplay.gate);

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

  let fogOfWar: FogOfWar | undefined;
  let levelEdgeVisibility: LevelEdgeVisibility | undefined;
  let exploredTileKeys = new Set<string>();
  let staticVisibilityObjects: Array<{ root: THREE.Object3D; tile: TileCoord }> = [];

  const updateStaticObjectVisibility = (): void => {
    for (const object of staticVisibilityObjects) {
      object.root.visible = exploredTileKeys.has(key(object.tile));
    }
  };

  const createLeanHunterRig = (): LeanHunterRig => {
    const rig = assetFactory.createLeanHunterRig();
    playerLocalAmbient.applyToObject(rig.root);
    return rig;
  };
  const createEliteEnemyAsset = (): EliteEnemyAsset => {
    const asset = assetFactory.createEliteEnemyAsset();
    playerLocalAmbient.applyToObject(asset.root);
    return asset;
  };
  const createVenomSpitterAsset = (): VenomSpitterAsset => {
    const asset = assetFactory.createVenomSpitterAsset();
    playerLocalAmbient.applyToObject(asset.root);
    return asset;
  };
  const createPickupAsset = (kind: ResourceKind): PickupAsset => {
    const asset = assetFactory.createPickupAsset(kind);
    playerLocalAmbient.applyToObject(asset.root);
    return asset;
  };
  const createEnvironmentAsset = (kind: EnvironmentAssetKind): EnvironmentAsset => {
    const asset = assetFactory.createEnvironmentAsset(kind);
    playerLocalAmbient.applyToObject(asset.root);
    return asset;
  };
  const createExitPortalAsset = (): import("./assetFactory").ExitPortalAsset => {
    const asset = assetFactory.createExitPortalAsset();
    playerLocalAmbient.applyToObject(asset.root);
    return asset;
  };

  const renderLevel = (level: LevelData): void => {
    fogOfWar?.dispose();
    exploredTileKeys = new Set();
    staticVisibilityObjects = [];
    levelEdgeVisibility = renderLevelToRoot(levelRoot, level, materials.level);
    const exitPortal = createExitPortalAsset();
    const exitPosition = exitGateToWorld(level.end, level.exitDirection);
    exitPortal.root.position.set(exitPosition.x, 0, exitPosition.z);
    exitPortal.root.rotation.y = exitGateRotation(level.exitDirection);
    levelRoot.add(exitPortal.root);
    staticVisibilityObjects.push({ root: exitPortal.root, tile: level.end });
    for (const object of level.environmentalObjects) {
      const asset = createEnvironmentAsset(object.kind);
      const position = tileToWorld(object.tile);
      asset.root.position.x = position.x;
      asset.root.position.z = position.z;
      asset.root.rotation.y = object.rotation;
      levelRoot.add(asset.root);
      staticVisibilityObjects.push({ root: asset.root, tile: object.tile });
    }
    fogOfWar = new FogOfWar(level, (exploredKeys) => {
      exploredTileKeys = new Set(exploredKeys);
      levelEdgeVisibility?.updateExploredTiles(exploredKeys);
      updateStaticObjectVisibility();
    });
  };

  const exitGateRotation = (direction: ExitDirection): number => {
    switch (direction) {
      case "east":
        return Math.PI / 2;
      case "south":
        return Math.PI;
      case "west":
        return -Math.PI / 2;
      case "north":
        return 0;
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
    createLeanHunterRig,
    createEliteEnemyAsset,
    createVenomSpitterAsset,
    createPickupAsset,
    createEnvironmentAsset,
    createExitPortalAsset,
    updateFog: (playerPosition, dt, instant = false) => fogOfWar?.update(playerPosition, dt, instant),
    updatePlayerLocalAmbient: playerLocalAmbient.update,
    isTileExplored: (position) => exploredTileKeys.has(key(worldToTile(position))),
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

  const armorFlashlight = new THREE.SpotLight(0xa8fff4, 48, 28, 0.62, 0.48, 1.7);
  armorFlashlight.position.set(0, 1.35, -0.28);
  armorFlashlight.target.position.set(0, 0.8, -14);
  player.add(armorFlashlight);
  player.add(armorFlashlight.target);
}
