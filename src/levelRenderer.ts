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
  ownerKeys: string[];
  transforms: THREE.Matrix4[];
};

export type LevelEdgeVisibility = {
  updateExploredTiles: (exploredKeys: ReadonlySet<string>) => void;
};

const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

export function renderLevel(root: THREE.Group, level: LevelData, materials: LevelRenderMaterials): LevelEdgeVisibility {
  root.clear();

  const voidPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(LEVEL_WIDTH * TILE_SIZE * 1.8, LEVEL_HEIGHT * TILE_SIZE * 1.8),
    materials.void,
  );
  voidPlane.rotation.x = -Math.PI / 2;
  voidPlane.position.y = -0.22;
  root.add(voidPlane);

  const tileGeometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
  const floorTransformsByVariant = new Map<FloorVariantId, Array<{ ownerKey: string; transform: THREE.Matrix4 }>>();
  for (const tileKey of level.walkable) {
    const [x, y] = tileKey.split(",").map(Number);
    const variant = level.floorVariants?.get(tileKey) ?? DEFAULT_FLOOR_VARIANT_ID;
    const position = tileToWorld({ x, y });
    const matrix = new THREE.Matrix4();
    matrix.makeRotationX(-Math.PI / 2);
    matrix.setPosition(position.x, 0, position.z);
    const transforms = floorTransformsByVariant.get(variant) ?? [];
    transforms.push({ ownerKey: tileKey, transform: matrix });
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
      ownerKeys: transforms.map((item) => item.ownerKey),
      transforms: transforms.map((item) => item.transform),
    });
    root.add(floorTiles);
  }

  const edgeGeometry = new THREE.BoxGeometry(TILE_SIZE, 0.8, 0.22);
  const rimGeometry = new THREE.BoxGeometry(TILE_SIZE, 0.04, 0.08);
  const edgeTransforms: THREE.Matrix4[] = [];
  const rimTransforms: THREE.Matrix4[] = [];
  const edgeOwnerKeys: string[] = [];

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
      edgeOwnerKeys.push(tileKey);
    }
  }

  const edges = new THREE.InstancedMesh(edgeGeometry, materials.edge, edgeTransforms.length);
  const rims = new THREE.InstancedMesh(rimGeometry, materials.rim, rimTransforms.length);
  edges.frustumCulled = false;
  rims.frustumCulled = false;
  root.add(edges, rims);

  addStartPad(root, level.start);

  const updateExploredTiles = (exploredKeys: ReadonlySet<string>): void => {
    floorBatches.forEach((batch) => {
      batch.transforms.forEach((floorTransform, index) => {
        batch.mesh.setMatrixAt(index, exploredKeys.has(batch.ownerKeys[index]) ? floorTransform : HIDDEN_MATRIX);
      });
      batch.mesh.instanceMatrix.needsUpdate = true;
    });
    edgeTransforms.forEach((edgeTransform, index) => {
      const visible = exploredKeys.has(edgeOwnerKeys[index]);
      edges.setMatrixAt(index, visible ? edgeTransform : HIDDEN_MATRIX);
      rims.setMatrixAt(index, visible ? rimTransforms[index] : HIDDEN_MATRIX);
    });
    edges.instanceMatrix.needsUpdate = true;
    rims.instanceMatrix.needsUpdate = true;
  };
  updateExploredTiles(new Set());

  return { updateExploredTiles };
}

function addStartPad(root: THREE.Group, tile: TileCoord): void {
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
