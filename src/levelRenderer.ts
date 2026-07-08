import * as THREE from "three";
import { LEVEL_HEIGHT, LEVEL_WIDTH, TILE_SIZE } from "./constants";
import { DEFAULT_FLOOR_VARIANT_ID, FLOOR_VARIANTS, type FloorVariantId } from "./floorVariants";
import { key, neighbors, tileToWorld, type LevelData, type TileCoord } from "./level";

export type LevelRenderMaterials = {
  floors: Record<FloorVariantId, THREE.MeshStandardMaterial>;
  edge: THREE.MeshStandardMaterial;
  void: THREE.MeshBasicMaterial;
  rim: THREE.MeshBasicMaterial;
};

type FloorBatch = {
  mesh: THREE.InstancedMesh;
  transforms: THREE.Matrix4[];
};

type FogBatch = {
  mesh: THREE.InstancedMesh;
  curtainMesh: THREE.InstancedMesh;
  ownerKeys: string[];
  ownerTiles: TileCoord[];
  transforms: THREE.Matrix4[];
  curtainTransforms: THREE.Matrix4[];
  walkableKeys: ReadonlySet<string>;
  edgeFadeFlags: THREE.InstancedBufferAttribute;
};

export type LevelEdgeVisibility = {
  updateExploredTiles: (exploredKeys: ReadonlySet<string>) => void;
};

const LEVEL_RENDER_DISPOSABLES_KEY = "daemonSyndicateLevelRenderDisposables";
const LEVEL_RENDER_OWNED_MATERIAL_KEY = "daemonSyndicateLevelRendererOwnedMaterial";
const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
const FOG_FADE_WIDTH = 0.15;
const FOG_EDGE_STRIDE = 4;
const FOG_TOP_HEIGHT = 0.035;
const FOG_CURTAIN_TOP = 0.085;
const FOG_CURTAIN_HEIGHT = 0.5;
const FOG_EDGE_DIRECTIONS: TileCoord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function renderLevel(root: THREE.Group, level: LevelData, materials: LevelRenderMaterials): LevelEdgeVisibility {
  disposePreviousLevelRender(root);
  root.clear();
  const disposables: THREE.Object3D[] = [];

  const voidPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(LEVEL_WIDTH * TILE_SIZE * 1.8, LEVEL_HEIGHT * TILE_SIZE * 1.8),
    materials.void,
  );
  voidPlane.rotation.x = -Math.PI / 2;
  voidPlane.position.y = -0.22;
  root.add(voidPlane);
  disposables.push(voidPlane);

  const tileGeometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
  const floorTransformsByVariant = new Map<FloorVariantId, THREE.Matrix4[]>();
  for (const tileKey of level.walkable) {
    const [x, y] = tileKey.split(",").map(Number);
    const variant = level.floorVariants?.get(tileKey) ?? DEFAULT_FLOOR_VARIANT_ID;
    const position = tileToWorld({ x, y });
    const matrix = new THREE.Matrix4();
    matrix.makeRotationX(-Math.PI / 2);
    matrix.setPosition(position.x, 0, position.z);
    const transforms = floorTransformsByVariant.get(variant) ?? [];
    transforms.push(matrix);
    floorTransformsByVariant.set(variant, transforms);
  }

  const floorBatches: FloorBatch[] = [];
  for (const variant of FLOOR_VARIANTS) {
    const transforms = floorTransformsByVariant.get(variant.id);
    if (!transforms || transforms.length === 0) continue;

    const floorTiles = new THREE.InstancedMesh(tileGeometry, materials.floors[variant.id], transforms.length);
    floorTiles.receiveShadow = true;
    floorTiles.frustumCulled = false;
    floorBatches.push({
      mesh: floorTiles,
      transforms,
    });
    root.add(floorTiles);
    disposables.push(floorTiles);
  }

  const fogBatch = createFogBatch([...level.walkable], level.walkable);
  root.add(fogBatch.curtainMesh, fogBatch.mesh);
  disposables.push(fogBatch.curtainMesh, fogBatch.mesh);

  const edgeGeometry = new THREE.BoxGeometry(TILE_SIZE, 0.8, 0.22);
  const rimGeometry = new THREE.BoxGeometry(TILE_SIZE, 0.04, 0.08);
  const edgeTransforms: THREE.Matrix4[] = [];
  const rimTransforms: THREE.Matrix4[] = [];
  const edgeOwnerTiles: TileCoord[] = [];

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
      edgeOwnerTiles.push(current);
    }
  }

  const edges = new THREE.InstancedMesh(edgeGeometry, materials.edge, edgeTransforms.length);
  const rims = new THREE.InstancedMesh(rimGeometry, materials.rim, rimTransforms.length);
  edges.frustumCulled = false;
  rims.frustumCulled = false;
  root.add(edges, rims);
  disposables.push(edges, rims);

  disposables.push(...addStartPad(root, level.start));
  root.userData[LEVEL_RENDER_DISPOSABLES_KEY] = disposables;

  const updateExploredTiles = (exploredKeys: ReadonlySet<string>): void => {
    floorBatches.forEach((batch) => {
      batch.transforms.forEach((floorTransform, index) => {
        batch.mesh.setMatrixAt(index, floorTransform);
      });
      batch.mesh.instanceMatrix.needsUpdate = true;
    });
    updateFogBatch(fogBatch, exploredKeys);
    edgeTransforms.forEach((edgeTransform, index) => {
      const visible = isConnectedExploredTile(edgeOwnerTiles[index], exploredKeys);
      edges.setMatrixAt(index, visible ? edgeTransform : HIDDEN_MATRIX);
      rims.setMatrixAt(index, visible ? rimTransforms[index] : HIDDEN_MATRIX);
    });
    edges.instanceMatrix.needsUpdate = true;
    rims.instanceMatrix.needsUpdate = true;
  };
  updateExploredTiles(new Set());

  return { updateExploredTiles };
}

function createFogBatch(ownerKeys: string[], walkableKeys: ReadonlySet<string>): FogBatch {
  const fogGeometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
  const edgeFadeFlags = new THREE.InstancedBufferAttribute(new Float32Array(ownerKeys.length * FOG_EDGE_STRIDE), 4);
  fogGeometry.setAttribute("fogEdgeFade", edgeFadeFlags);

  const fogMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uFadeWidth: { value: FOG_FADE_WIDTH },
    },
    vertexShader: `
      attribute vec4 fogEdgeFade;

      varying vec2 vUv;
      varying vec4 vFogEdgeFade;

      void main() {
        vUv = uv;
        vFogEdgeFade = fogEdgeFade;

        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uFadeWidth;

      varying vec2 vUv;
      varying vec4 vFogEdgeFade;

      void main() {
        float alpha = 1.0;
        if (vFogEdgeFade.x > 0.5) alpha *= smoothstep(0.0, uFadeWidth, 1.0 - vUv.x);
        if (vFogEdgeFade.y > 0.5) alpha *= smoothstep(0.0, uFadeWidth, vUv.x);
        if (vFogEdgeFade.z > 0.5) alpha *= smoothstep(0.0, uFadeWidth, vUv.y);
        if (vFogEdgeFade.w > 0.5) alpha *= smoothstep(0.0, uFadeWidth, 1.0 - vUv.y);

        gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  markOwnedMaterial(fogMaterial);

  const mesh = new THREE.InstancedMesh(fogGeometry, fogMaterial, ownerKeys.length);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  const curtainGeometry = new THREE.PlaneGeometry(TILE_SIZE, FOG_CURTAIN_HEIGHT);
  const curtainMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
  markOwnedMaterial(curtainMaterial);
  const curtainMesh = new THREE.InstancedMesh(curtainGeometry, curtainMaterial, ownerKeys.length * FOG_EDGE_STRIDE);
  curtainMesh.frustumCulled = false;
  curtainMesh.renderOrder = 1;

  const ownerTiles = ownerKeys.map((tileKey) => {
    const [x, y] = tileKey.split(",").map(Number);
    return { x, y };
  });
  const transforms = ownerTiles.map((tile) => {
    const position = tileToWorld(tile);
    const matrix = new THREE.Matrix4();
    matrix.makeRotationX(-Math.PI / 2);
    matrix.setPosition(position.x, FOG_TOP_HEIGHT, position.z);
    return matrix;
  });
  const curtainTransforms = ownerTiles.flatMap((tile) => createFogCurtainTransforms(tile));

  updateFogBatch({ mesh, curtainMesh, ownerKeys, ownerTiles, transforms, curtainTransforms, walkableKeys, edgeFadeFlags }, new Set());
  return { mesh, curtainMesh, ownerKeys, ownerTiles, transforms, curtainTransforms, walkableKeys, edgeFadeFlags };
}

function updateFogBatch(fogBatch: FogBatch, exploredKeys: ReadonlySet<string>): void {
  fogBatch.transforms.forEach((transform, index) => {
    const ownerKey = fogBatch.ownerKeys[index];
    if (exploredKeys.has(ownerKey)) {
      fogBatch.mesh.setMatrixAt(index, HIDDEN_MATRIX);
      setFogEdgeFadeFlags(fogBatch.edgeFadeFlags, index, [0, 0, 0, 0]);
      setFogCurtains(fogBatch, index, [false, false, false, false]);
      return;
    }

    const edgeFadeFlags = fogEdgeFadeFlags(fogBatch.ownerTiles[index], exploredKeys);
    fogBatch.mesh.setMatrixAt(index, transform);
    setFogEdgeFadeFlags(fogBatch.edgeFadeFlags, index, edgeFadeFlags);
    setFogCurtains(fogBatch, index, fogCurtainFlags(fogBatch.ownerTiles[index], edgeFadeFlags, fogBatch.walkableKeys, exploredKeys));
  });

  fogBatch.mesh.instanceMatrix.needsUpdate = true;
  fogBatch.curtainMesh.instanceMatrix.needsUpdate = true;
  fogBatch.edgeFadeFlags.needsUpdate = true;
}

function createFogCurtainTransforms(tile: TileCoord): THREE.Matrix4[] {
  const position = tileToWorld(tile);
  const halfTile = TILE_SIZE * 0.5;
  const centerY = FOG_CURTAIN_TOP - FOG_CURTAIN_HEIGHT * 0.5;
  return [
    fogCurtainTransform(position.x + halfTile, centerY, position.z, Math.PI / 2),
    fogCurtainTransform(position.x - halfTile, centerY, position.z, Math.PI / 2),
    fogCurtainTransform(position.x, centerY, position.z + halfTile, 0),
    fogCurtainTransform(position.x, centerY, position.z - halfTile, 0),
  ];
}

function fogCurtainTransform(x: number, y: number, z: number, rotationY: number): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  matrix.makeRotationY(rotationY);
  matrix.setPosition(x, y, z);
  return matrix;
}

function setFogCurtains(fogBatch: FogBatch, tileIndex: number, visibleFlags: [boolean, boolean, boolean, boolean]): void {
  for (let side = 0; side < FOG_EDGE_STRIDE; side += 1) {
    const curtainIndex = tileIndex * FOG_EDGE_STRIDE + side;
    fogBatch.curtainMesh.setMatrixAt(
      curtainIndex,
      visibleFlags[side] ? fogBatch.curtainTransforms[curtainIndex] : HIDDEN_MATRIX,
    );
  }
}

function fogCurtainFlags(
  tile: TileCoord,
  edgeFadeFlags: [number, number, number, number],
  walkableKeys: ReadonlySet<string>,
  exploredKeys: ReadonlySet<string>,
): [boolean, boolean, boolean, boolean] {
  return FOG_EDGE_DIRECTIONS.map((direction, side) => {
    if (edgeFadeFlags[side] > 0) return false;
    const neighborKey = key({ x: tile.x + direction.x, y: tile.y + direction.y });
    return !walkableKeys.has(neighborKey) || exploredKeys.has(neighborKey);
  }) as [boolean, boolean, boolean, boolean];
}

function setFogEdgeFadeFlags(
  attribute: THREE.InstancedBufferAttribute,
  index: number,
  flags: [number, number, number, number],
): void {
  attribute.setXYZW(index, flags[0], flags[1], flags[2], flags[3]);
}

function fogEdgeFadeFlags(tile: TileCoord, exploredKeys: ReadonlySet<string>): [number, number, number, number] {
  return [
    isConnectedExploredTile({ x: tile.x + 1, y: tile.y }, exploredKeys) ? 1 : 0,
    isConnectedExploredTile({ x: tile.x - 1, y: tile.y }, exploredKeys) ? 1 : 0,
    isConnectedExploredTile({ x: tile.x, y: tile.y + 1 }, exploredKeys) ? 1 : 0,
    isConnectedExploredTile({ x: tile.x, y: tile.y - 1 }, exploredKeys) ? 1 : 0,
  ];
}

function isConnectedExploredTile(tile: TileCoord, exploredKeys: ReadonlySet<string>): boolean {
  return exploredKeys.has(key(tile)) && hasExploredNeighbor(tile, exploredKeys);
}

function hasExploredNeighbor(tile: TileCoord, exploredKeys: ReadonlySet<string>): boolean {
  return neighbors(tile).some((neighbor) => exploredKeys.has(key(neighbor)));
}

function addStartPad(root: THREE.Group, tile: TileCoord): THREE.Object3D[] {
  const position = tileToWorld(tile);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x65d7ff, transparent: true, opacity: 0.62, side: THREE.DoubleSide });
  const coreMaterial = new THREE.MeshBasicMaterial({ color: 0x65d7ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide });
  markOwnedMaterial(ringMaterial);
  markOwnedMaterial(coreMaterial);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.68, 0.92, 32),
    ringMaterial,
  );
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 32),
    coreMaterial,
  );
  ring.rotation.x = -Math.PI / 2;
  core.rotation.x = -Math.PI / 2;
  ring.position.set(position.x, 0.08, position.z);
  core.position.set(position.x, 0.075, position.z);
  root.add(ring, core);
  return [ring, core];
}

function disposePreviousLevelRender(root: THREE.Group): void {
  const disposables = root.userData[LEVEL_RENDER_DISPOSABLES_KEY] as THREE.Object3D[] | undefined;
  if (!disposables) return;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  for (const disposable of disposables) {
    disposable.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of meshMaterials) {
        if (material.userData[LEVEL_RENDER_OWNED_MATERIAL_KEY] === true) {
          materials.add(material);
        }
      }
    });
  }

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  delete root.userData[LEVEL_RENDER_DISPOSABLES_KEY];
}

function markOwnedMaterial(material: THREE.Material): void {
  material.userData[LEVEL_RENDER_OWNED_MATERIAL_KEY] = true;
}
