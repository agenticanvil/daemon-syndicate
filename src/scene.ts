import * as THREE from "three";
import { ARENA_SIZE, LEVEL_HEIGHT, LEVEL_WIDTH, TILE_SIZE } from "./constants";
import { loadLeanHunterRig, type LeanHunterRig } from "./assets/enemies/leanHunterAsset";
import { exitGateToWorld, key, neighbors, tileToWorld, type LevelData } from "./level";
import { loadPlayerRig, type PlayerRig } from "./playerAsset";

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
  materials: {
    enemy: THREE.MeshStandardMaterial;
    eliteEnemy: THREE.MeshStandardMaterial;
    projectile: THREE.MeshBasicMaterial;
    nova: THREE.MeshBasicMaterial;
    healthPickup: THREE.MeshStandardMaterial;
    ammoPickup: THREE.MeshStandardMaterial;
    energyPickup: THREE.MeshStandardMaterial;
    gate: THREE.MeshStandardMaterial;
  };
  resize: () => void;
};

export function createGameScene(app: HTMLDivElement): GameScene {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  app.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080a);
  scene.fog = new THREE.Fog(0x05080a, 28, 72);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  camera.position.set(25, 26, 25);
  camera.lookAt(0, 0, 0);

  const levelRoot = new THREE.Group();
  scene.add(levelRoot);

  const loader = new THREE.TextureLoader();
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const floorTexture = loader.load("/assets/facility-floor.png");
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  floorTexture.wrapS = THREE.RepeatWrapping;
  floorTexture.wrapT = THREE.RepeatWrapping;
  floorTexture.repeat.set(1, 1);
  floorTexture.anisotropy = anisotropy;

  const floorMaterial = new THREE.MeshStandardMaterial({
    map: floorTexture,
    roughness: 0.78,
    metalness: 0.42,
  });

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(LEVEL_WIDTH * TILE_SIZE * 1.4, LEVEL_HEIGHT * TILE_SIZE * 1.4, 1, 1),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const playerRig = loadPlayerRig(loader, anisotropy);
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

  const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x111b1e, roughness: 0.86, metalness: 0.32 });
  const voidMaterial = new THREE.MeshBasicMaterial({ color: 0x010304 });
  const rimMaterial = new THREE.MeshBasicMaterial({ color: 0x2ddbd2, transparent: true, opacity: 0.36 });
  const materials = {
    enemy: new THREE.MeshStandardMaterial({
      color: 0x8cff55,
      emissive: 0x143b08,
      roughness: 0.48,
      metalness: 0.25,
    }),
    eliteEnemy: new THREE.MeshStandardMaterial({
      color: 0xff5f5f,
      emissive: 0x3a0707,
      roughness: 0.42,
      metalness: 0.32,
    }),
    projectile: new THREE.MeshBasicMaterial({ color: 0x9bf0df }),
    nova: new THREE.MeshBasicMaterial({
      color: 0x67ddff,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    }),
    healthPickup: new THREE.MeshStandardMaterial({ color: 0xff5668, emissive: 0x290406 }),
    ammoPickup: new THREE.MeshStandardMaterial({ color: 0xffc857, emissive: 0x2a1801 }),
    energyPickup: new THREE.MeshStandardMaterial({ color: 0x65d7ff, emissive: 0x052439 }),
    gate: new THREE.MeshStandardMaterial({
      color: 0x9bf0df,
      emissive: 0x0f5f58,
      roughness: 0.2,
      metalness: 0.55,
    }),
  };

  function renderLevel(level: LevelData): void {
    levelRoot.clear();

    const voidPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(LEVEL_WIDTH * TILE_SIZE * 1.8, LEVEL_HEIGHT * TILE_SIZE * 1.8),
      voidMaterial,
    );
    voidPlane.rotation.x = -Math.PI / 2;
    voidPlane.position.y = -0.22;
    levelRoot.add(voidPlane);

    const tileGeometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
    const floorTiles = new THREE.InstancedMesh(tileGeometry, floorMaterial, level.walkable.size);
    floorTiles.receiveShadow = true;

    let tileIndex = 0;
    const matrix = new THREE.Matrix4();
    for (const tileKey of level.walkable) {
      const [x, y] = tileKey.split(",").map(Number);
      const position = tileToWorld({ x, y });
      matrix.makeRotationX(-Math.PI / 2);
      matrix.setPosition(position.x, 0, position.z);
      floorTiles.setMatrixAt(tileIndex, matrix);
      tileIndex += 1;
    }
    levelRoot.add(floorTiles);

    const edgeGeometry = new THREE.BoxGeometry(TILE_SIZE, 0.8, 0.22);
    const rimGeometry = new THREE.BoxGeometry(TILE_SIZE, 0.04, 0.08);
    const edgeTransforms: THREE.Matrix4[] = [];
    const rimTransforms: THREE.Matrix4[] = [];

    for (const tileKey of level.walkable) {
      const tile = tileKey.split(",").map(Number);
      const current = { x: tile[0], y: tile[1] };
      for (const neighbor of neighbors(current)) {
        if (level.walkable.has(key(neighbor))) continue;
        const dirX = neighbor.x - current.x;
        const dirY = neighbor.y - current.y;
        const base = tileToWorld(current);
        const edge = new THREE.Matrix4();
        const rim = new THREE.Matrix4();
        const horizontal = dirY !== 0;
        const rotation = horizontal ? 0 : Math.PI / 2;
        edge.makeRotationY(rotation);
        rim.makeRotationY(rotation);
        edge.setPosition(base.x + dirX * TILE_SIZE * 0.5, -0.36, base.z + dirY * TILE_SIZE * 0.5);
        rim.setPosition(base.x + dirX * TILE_SIZE * 0.5, 0.06, base.z + dirY * TILE_SIZE * 0.5);
        edgeTransforms.push(edge);
        rimTransforms.push(rim);
      }
    }

    const edges = new THREE.InstancedMesh(edgeGeometry, edgeMaterial, edgeTransforms.length);
    const rims = new THREE.InstancedMesh(rimGeometry, rimMaterial, rimTransforms.length);
    edgeTransforms.forEach((transform, index) => edges.setMatrixAt(index, transform));
    rimTransforms.forEach((transform, index) => rims.setMatrixAt(index, transform));
    levelRoot.add(edges, rims);

    addStartPad(levelRoot, level.start);
    addGate(levelRoot, level.end, 0x9bf0df, true, level.exitDirection);
  }

  function resize(): void {
    const aspect = window.innerWidth / window.innerHeight;
    const viewSize = window.innerWidth < 760 ? 28 : 24;
    camera.left = (-viewSize * aspect) / 2;
    camera.right = (viewSize * aspect) / 2;
    camera.top = viewSize / 2;
    camera.bottom = -viewSize / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  resize();

  function createLeanHunterRig(): LeanHunterRig {
    return loadLeanHunterRig(loader, anisotropy);
  }

  return {
    renderer,
    scene,
    camera,
    floor,
    player,
    playerRig,
    playerBody,
    reticle,
    renderLevel,
    createLeanHunterRig,
    materials,
    resize,
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

function addGate(
  root: THREE.Group,
  tile: { x: number; y: number },
  color: number,
  active: boolean,
  direction: "north" | "east" = "north",
): void {
  const position = exitGateToWorld(tile, direction);
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: active ? 0.38 : 0.14,
    roughness: 0.22,
    metalness: 0.5,
  });
  const arch = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.4, 0.28), material);
  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(1.45, 1.9),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: active ? 0.42 : 0.18, side: THREE.DoubleSide }),
  );
  arch.position.y = 1.2;
  field.position.y = 1.05;
  field.position.z = -0.02;
  if (direction === "east") {
    group.rotation.y = Math.PI / 2;
  }
  group.position.set(position.x, 0, position.z);
  group.add(arch, field);
  root.add(group);
}

function addStartPad(root: THREE.Group, tile: { x: number; y: number }): void {
  const position = tileToWorld(tile);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.68, 0.92, 32),
    new THREE.MeshBasicMaterial({ color: 0x65d7ff, transparent: true, opacity: 0.62, side: THREE.DoubleSide }),
  );
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 32),
    new THREE.MeshBasicMaterial({ color: 0x65d7ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  core.rotation.x = -Math.PI / 2;
  ring.position.set(position.x, 0.08, position.z);
  core.position.set(position.x, 0.075, position.z);
  root.add(ring, core);
}
