import * as THREE from "three";
import { LEVEL_HEIGHT, LEVEL_WIDTH, TILE_SIZE } from "./constants";
import { createAssetFactory, type EliteEnemyAsset, type LeanHunterRig, type PickupAsset, type PlayerRig } from "./assetFactory";
import { type LevelData } from "./level";
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
    new THREE.MeshBasicMaterial({ color: 0x91fff0, transparent: true, opacity: 0.55 }),
  );
  reticle.rotation.x = -Math.PI / 2;
  reticle.position.y = 0.04;
  scene.add(reticle);

  addLighting(scene);

  const renderLevel = (level: LevelData): void => {
    renderLevelToRoot(levelRoot, level, materials.level);
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
    materials: materials.gameplay,
    resize: renderContext.resize,
    applyGraphicsSettings: renderContext.applyGraphicsSettings,
  };
}

function addLighting(scene: THREE.Scene): void {
  const ambient = new THREE.HemisphereLight(0x9cf3ff, 0x07110d, 1.2);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xe6fffa, 2.7);
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
}
