import * as THREE from "three";
import { LEVEL_HEIGHT, LEVEL_WIDTH, TILE_SIZE } from "./constants";
import { DEFAULT_FLOOR_VARIANT_ID, FLOOR_VARIANTS, type FloorVariantId } from "./floorVariants";
import { exitGateTiles, key, neighbors, tileToWorld, type ExitDirection, type LevelData, type TileCoord } from "./level";

export type LevelRenderMaterials = {
  floors: Record<FloorVariantId, THREE.MeshStandardMaterial>;
  floorDecal: THREE.MeshBasicMaterial;
  edge: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  wallUpper: THREE.MeshStandardMaterial;
  void: THREE.MeshBasicMaterial;
  rim: THREE.MeshBasicMaterial;
};

export type LevelEdgeVisibility = {
  updateWallOcclusion: (playerPosition: THREE.Vector3, camera: THREE.Camera, dt: number, instant?: boolean) => void;
};

const LEVEL_RENDER_DISPOSABLES_KEY = "daemonSyndicateLevelRenderDisposables";
const LEVEL_RENDER_OWNED_MATERIAL_KEY = "daemonSyndicateLevelRendererOwnedMaterial";
const FLOOR_TEXTURE_SPAN_TILES = 2;
const FLOOR_DECAL_OFFSET = 0.026;
const FLOOR_DECAL_MIN_COUNT = 3;
const FLOOR_DECAL_TILES_PER_PLACEMENT = 5;
const WALL_THICKNESS = 0.2;
const WALL_PLINTH_HEIGHT = 0.64;
const WALL_PLINTH_FLOOR_OVERLAP = 0.08;
const WALL_UPPER_HEIGHT = 1.82;
const WALL_TOTAL_HEIGHT = WALL_PLINTH_HEIGHT + WALL_UPPER_HEIGHT;
const WALL_OCCLUDING_OPACITY = 0.055;
const WALL_FADE_SPEED = 9;
const WALL_OCCLUSION_TARGET_HEIGHT = 0.9;

type WallEdge = {
  center: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  halfLength: number;
};

type BoundaryEdge = {
  ownerTile: TileCoord;
  centerX: number;
  centerZ: number;
  dirX: number;
  dirY: number;
  horizontal: boolean;
  startVertex: string;
  endVertex: string;
};

type FloorDecalDefinition = {
  rect: AtlasRect;
  widthTiles: number;
  depthTiles: number;
};

type AtlasRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const FLOOR_DECALS: FloorDecalDefinition[] = [
  { rect: atlasCell(0, 0), widthTiles: 1.8, depthTiles: 1.35 },
  { rect: atlasCell(0, 2), widthTiles: 1.7, depthTiles: 1.0 },
  { rect: atlasCell(1, 3), widthTiles: 1.25, depthTiles: 0.85 },
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

  const floorTilesByVariant = new Map<FloorVariantId, TileCoord[]>();
  for (const tileKey of level.walkable) {
    const [x, y] = tileKey.split(",").map(Number);
    const variant = level.floorVariants?.get(tileKey) ?? DEFAULT_FLOOR_VARIANT_ID;
    const tiles = floorTilesByVariant.get(variant) ?? [];
    tiles.push({ x, y });
    floorTilesByVariant.set(variant, tiles);
  }

  for (const variant of FLOOR_VARIANTS) {
    const tiles = floorTilesByVariant.get(variant.id);
    if (!tiles || tiles.length === 0) continue;

    const floorTiles = new THREE.Mesh(createFloorGeometry(tiles), materials.floors[variant.id]);
    floorTiles.castShadow = true;
    floorTiles.receiveShadow = true;
    floorTiles.frustumCulled = false;
    floorTiles.name = "level-floor-tiles";
    root.add(floorTiles);
    disposables.push(floorTiles);
  }

  const floorDecals = createFloorDecals(level, materials.floorDecal);
  if (floorDecals) {
    root.add(floorDecals);
    disposables.push(floorDecals);
  }

  const edgeGeometry = new THREE.BoxGeometry(TILE_SIZE, 0.8, 0.22);
  const rimGeometry = new THREE.BoxGeometry(TILE_SIZE, 0.04, 0.08);
  const wallPlinthGeometry = new THREE.BoxGeometry(
    TILE_SIZE,
    WALL_PLINTH_HEIGHT + WALL_PLINTH_FLOOR_OVERLAP,
    WALL_THICKNESS,
  );
  const wallUpperGeometry = new THREE.BoxGeometry(TILE_SIZE, WALL_UPPER_HEIGHT, WALL_THICKNESS);
  const edgeTransforms: THREE.Matrix4[] = [];
  const rimTransforms: THREE.Matrix4[] = [];
  const wallPlinthTransforms: THREE.Matrix4[] = [];
  const wallUpperTransforms: THREE.Matrix4[] = [];
  const wallEdges: WallEdge[] = [];
  const boundaryEdges = collectBoundaryEdges(level);
  const vertexOrientations = collectVertexOrientations(boundaryEdges);

  for (const boundaryEdge of boundaryEdges) {
    const edgeTransform = createBoundaryTransform(boundaryEdge, -0.36, 0.22, vertexOrientations);
    const rimTransform = createBoundaryTransform(boundaryEdge, 0.06, 0.08, vertexOrientations);
    const wallPlinthTransform = createBoundaryTransform(
      boundaryEdge,
      (WALL_PLINTH_HEIGHT - WALL_PLINTH_FLOOR_OVERLAP) * 0.5,
      WALL_THICKNESS,
      vertexOrientations,
    );
    const wallUpperTransform = createBoundaryTransform(
      boundaryEdge,
      WALL_PLINTH_HEIGHT + WALL_UPPER_HEIGHT * 0.5,
      WALL_THICKNESS,
      vertexOrientations,
    );
    edgeTransforms.push(edgeTransform.matrix);
    rimTransforms.push(rimTransform.matrix);
    wallPlinthTransforms.push(wallPlinthTransform.matrix);
    wallUpperTransforms.push(wallUpperTransform.matrix);
    wallEdges.push({
      center: wallUpperTransform.center,
      normal: new THREE.Vector3(boundaryEdge.dirX, 0, boundaryEdge.dirY),
      tangent: new THREE.Vector3(boundaryEdge.horizontal ? 1 : 0, 0, boundaryEdge.horizontal ? 0 : 1),
      halfLength: wallUpperTransform.length * 0.5,
    });
  }

  const edges = new THREE.InstancedMesh(edgeGeometry, materials.edge, edgeTransforms.length);
  const rims = new THREE.InstancedMesh(rimGeometry, materials.rim, rimTransforms.length);
  const wallPlinths = new THREE.InstancedMesh(wallPlinthGeometry, materials.wall, wallPlinthTransforms.length);
  const wallFadeValues = new Float32Array(wallUpperTransforms.length).fill(1);
  const wallFade = new THREE.InstancedBufferAttribute(wallFadeValues, 1);
  wallUpperGeometry.setAttribute("wallFade", wallFade);
  const upperWalls = new THREE.InstancedMesh(wallUpperGeometry, materials.wallUpper, wallUpperTransforms.length);
  edgeTransforms.forEach((transform, index) => {
    edges.setMatrixAt(index, transform);
    rims.setMatrixAt(index, rimTransforms[index]);
    wallPlinths.setMatrixAt(index, wallPlinthTransforms[index]);
    upperWalls.setMatrixAt(index, wallUpperTransforms[index]);
  });
  edges.frustumCulled = false;
  rims.frustumCulled = false;
  wallPlinths.frustumCulled = false;
  upperWalls.frustumCulled = false;
  edges.castShadow = true;
  edges.receiveShadow = true;
  wallPlinths.castShadow = true;
  wallPlinths.receiveShadow = true;
  upperWalls.castShadow = true;
  upperWalls.receiveShadow = true;
  wallPlinths.name = "level-wall-plinths";
  upperWalls.name = "level-wall-uppers";
  edges.name = "level-platform-edges";
  root.add(edges, wallPlinths, upperWalls, rims);
  disposables.push(edges, rims, wallPlinths, upperWalls);

  disposables.push(...addStartPad(root, level.start));
  root.userData[LEVEL_RENDER_DISPOSABLES_KEY] = disposables;

  const playerOcclusionTarget = new THREE.Vector3();
  const cameraToPlayer = new THREE.Vector3();
  const wallIntersection = new THREE.Vector3();
  const wallOffset = new THREE.Vector3();
  const updateWallOcclusion = (playerPosition: THREE.Vector3, camera: THREE.Camera, dt: number, instant = false): void => {
    playerOcclusionTarget.copy(playerPosition).addScaledVector(THREE.Object3D.DEFAULT_UP, WALL_OCCLUSION_TARGET_HEIGHT);
    cameraToPlayer.copy(playerOcclusionTarget).sub(camera.position);
    if (cameraToPlayer.lengthSq() < 0.0001) return;

    wallEdges.forEach((wallEdge, index) => {
      const denominator = cameraToPlayer.dot(wallEdge.normal);
      const intersectionAmount =
        Math.abs(denominator) > 0.0001
          ? wallOffset.copy(wallEdge.center).sub(camera.position).dot(wallEdge.normal) / denominator
          : -1;
      wallIntersection.copy(camera.position).addScaledVector(cameraToPlayer, intersectionAmount);
      const intersectsWallLength =
        Math.abs(wallOffset.copy(wallIntersection).sub(wallEdge.center).dot(wallEdge.tangent)) <= wallEdge.halfLength;
      const intersectsUpperWallHeight =
        wallIntersection.y >= WALL_PLINTH_HEIGHT && wallIntersection.y <= WALL_TOTAL_HEIGHT;
      const occludesPlayer =
        intersectionAmount > 0 &&
        intersectionAmount < 1 &&
        intersectsWallLength &&
        intersectsUpperWallHeight;
      const target = occludesPlayer ? WALL_OCCLUDING_OPACITY : 1;
      const alpha = instant ? 1 : 1 - Math.exp(-WALL_FADE_SPEED * Math.max(dt, 0));
      wallFadeValues[index] = THREE.MathUtils.lerp(wallFadeValues[index], target, alpha);
      wallFade.setX(index, wallFadeValues[index]);
    });
    wallFade.needsUpdate = true;
  };
  return { updateWallOcclusion };
}

function collectBoundaryEdges(level: LevelData): BoundaryEdge[] {
  const boundaryEdges: BoundaryEdge[] = [];
  const exitTileKeys = new Set(exitGateTiles(level.end, level.exitDirection).map(key));
  const exitDirection = directionVector(level.exitDirection);
  for (const tileKey of level.walkable) {
    const [x, y] = tileKey.split(",").map(Number);
    const ownerTile = { x, y };
    for (const neighbor of neighbors(ownerTile)) {
      if (level.walkable.has(key(neighbor))) continue;
      const dirX = neighbor.x - ownerTile.x;
      const dirY = neighbor.y - ownerTile.y;
      if (exitTileKeys.has(tileKey) && dirX === exitDirection.x && dirY === exitDirection.y) continue;
      const horizontal = dirY !== 0;
      const base = tileToWorld(ownerTile);
      boundaryEdges.push({
        ownerTile,
        centerX: base.x + dirX * TILE_SIZE * 0.5,
        centerZ: base.z + dirY * TILE_SIZE * 0.5,
        dirX,
        dirY,
        horizontal,
        startVertex: horizontal ? `${ownerTile.x},${ownerTile.y + Math.max(dirY, 0)}` : `${ownerTile.x + Math.max(dirX, 0)},${ownerTile.y}`,
        endVertex: horizontal
          ? `${ownerTile.x + 1},${ownerTile.y + Math.max(dirY, 0)}`
          : `${ownerTile.x + Math.max(dirX, 0)},${ownerTile.y + 1}`,
      });
    }
  }
  return boundaryEdges;
}

function directionVector(direction: ExitDirection): TileCoord {
  switch (direction) {
    case "north":
      return { x: 0, y: -1 };
    case "east":
      return { x: 1, y: 0 };
    case "south":
      return { x: 0, y: 1 };
    case "west":
      return { x: -1, y: 0 };
  }
}

function collectVertexOrientations(boundaryEdges: BoundaryEdge[]): Map<string, Set<"horizontal" | "vertical">> {
  const orientations = new Map<string, Set<"horizontal" | "vertical">>();
  for (const edge of boundaryEdges) {
    const orientation = edge.horizontal ? "horizontal" : "vertical";
    for (const vertex of [edge.startVertex, edge.endVertex]) {
      const vertexOrientations = orientations.get(vertex) ?? new Set();
      vertexOrientations.add(orientation);
      orientations.set(vertex, vertexOrientations);
    }
  }
  return orientations;
}

function createBoundaryTransform(
  edge: BoundaryEdge,
  height: number,
  thickness: number,
  vertexOrientations: ReadonlyMap<string, ReadonlySet<"horizontal" | "vertical">>,
): { matrix: THREE.Matrix4; center: THREE.Vector3; length: number } {
  const joinsPerpendicularAtStart = (vertexOrientations.get(edge.startVertex)?.size ?? 0) > 1;
  const joinsPerpendicularAtEnd = (vertexOrientations.get(edge.endVertex)?.size ?? 0) > 1;
  const joinAdjustment = edge.horizontal ? thickness * 0.5 : -thickness * 0.5;
  const startAdjustment = joinsPerpendicularAtStart ? joinAdjustment : 0;
  const endAdjustment = joinsPerpendicularAtEnd ? joinAdjustment : 0;
  const length = TILE_SIZE + startAdjustment + endAdjustment;
  const centerShift = (endAdjustment - startAdjustment) * 0.5;
  const center = new THREE.Vector3(
    edge.centerX + (edge.horizontal ? centerShift : 0),
    height,
    edge.centerZ + (edge.horizontal ? 0 : centerShift),
  );
  const matrix = new THREE.Matrix4().compose(
    center,
    new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, edge.horizontal ? 0 : -Math.PI / 2),
    new THREE.Vector3(length / TILE_SIZE, 1, 1),
  );
  return { matrix, center, length };
}

function createFloorGeometry(tiles: TileCoord[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const halfTile = TILE_SIZE * 0.5;

  tiles.forEach((tile, tileIndex) => {
    const position = tileToWorld(tile);
    const left = position.x - halfTile;
    const right = position.x + halfTile;
    const top = position.z - halfTile;
    const bottom = position.z + halfTile;
    const u0 = tile.x / FLOOR_TEXTURE_SPAN_TILES;
    const u1 = (tile.x + 1) / FLOOR_TEXTURE_SPAN_TILES;
    const v0 = tile.y / FLOOR_TEXTURE_SPAN_TILES;
    const v1 = (tile.y + 1) / FLOOR_TEXTURE_SPAN_TILES;

    positions.push(left, 0, top, left, 0, bottom, right, 0, bottom, right, 0, top);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    uvs.push(u0, v0, u0, v1, u1, v1, u1, v0);

    const vertexOffset = tileIndex * 4;
    indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2, vertexOffset, vertexOffset + 2, vertexOffset + 3);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function createFloorDecals(level: LevelData, material: THREE.MeshBasicMaterial): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined {
  const placements = chooseFloorDecalPlacements(level);
  if (placements.length === 0) return undefined;

  const geometry = createFloorDecalGeometry(placements);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

function chooseFloorDecalPlacements(level: LevelData): Array<FloorDecalDefinition & { tile: TileCoord; rotation: number; scale: number }> {
  const walkableTiles = [...level.walkable]
    .map((tileKey) => {
      const [x, y] = tileKey.split(",").map(Number);
      return { x, y };
    })
    .filter((tile) => !level.blocked.has(key(tile)) && tileDistance(tile, level.start) > 4 && walkableNeighborCount(level.walkable, tile) >= 3)
    .sort((a, b) => floorHash(a, 17) - floorHash(b, 17));

  const count = Math.max(FLOOR_DECAL_MIN_COUNT, Math.floor(level.walkable.size / FLOOR_DECAL_TILES_PER_PLACEMENT));
  const selected: Array<FloorDecalDefinition & { tile: TileCoord; rotation: number; scale: number }> = [];

  for (const tile of walkableTiles) {
    if (selected.length >= count) break;
    if (selected.some((placement) => tileDistance(placement.tile, tile) < 5)) continue;

    const decal = FLOOR_DECALS[floorHash(tile, 31) % FLOOR_DECALS.length];
    selected.push({
      ...decal,
      tile,
      rotation: (floorHash(tile, 43) / 0xffffffff) * Math.PI * 2,
      scale: 0.82 + (floorHash(tile, 59) / 0xffffffff) * 0.24,
    });
  }

  return selected;
}

function createFloorDecalGeometry(placements: Array<FloorDecalDefinition & { tile: TileCoord; rotation: number; scale: number }>): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  placements.forEach((placement, placementIndex) => {
    const center = tileToWorld(placement.tile);
    const halfWidth = (placement.widthTiles * TILE_SIZE * placement.scale) * 0.5;
    const halfDepth = (placement.depthTiles * TILE_SIZE * placement.scale) * 0.5;
    const cos = Math.cos(placement.rotation);
    const sin = Math.sin(placement.rotation);
    const corners = [
      { x: -halfWidth, z: -halfDepth, u: placement.rect.left, v: placement.rect.top + placement.rect.height },
      { x: -halfWidth, z: halfDepth, u: placement.rect.left, v: placement.rect.top },
      { x: halfWidth, z: halfDepth, u: placement.rect.left + placement.rect.width, v: placement.rect.top },
      { x: halfWidth, z: -halfDepth, u: placement.rect.left + placement.rect.width, v: placement.rect.top + placement.rect.height },
    ];

    for (const corner of corners) {
      const rotatedX = corner.x * cos - corner.z * sin;
      const rotatedZ = corner.x * sin + corner.z * cos;
      positions.push(center.x + rotatedX, FLOOR_DECAL_OFFSET, center.z + rotatedZ);
      normals.push(0, 1, 0);
      uvs.push(corner.u, 1 - corner.v);
    }

    const vertexOffset = placementIndex * 4;
    indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2, vertexOffset, vertexOffset + 2, vertexOffset + 3);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function atlasCell(column: 0 | 1, row: 0 | 1 | 2 | 3): AtlasRect {
  const paddingX = 0.025;
  const paddingY = 0.018;
  const cellWidth = 0.5;
  const cellHeight = 0.25;
  return {
    left: column * cellWidth + paddingX,
    top: row * cellHeight + paddingY,
    width: cellWidth - paddingX * 2,
    height: cellHeight - paddingY * 2,
  };
}

function walkableNeighborCount(walkable: ReadonlySet<string>, tile: TileCoord): number {
  return neighbors(tile).filter((neighbor) => walkable.has(key(neighbor))).length;
}

function tileDistance(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function floorHash(tile: TileCoord, salt: number): number {
  let hash = Math.imul(tile.x + 0x9e3779b9 + salt, 0x85ebca6b) ^ Math.imul(tile.y + 0xc2b2ae35 + salt, 0x27d4eb2f);
  hash ^= hash >>> 16;
  return hash >>> 0;
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
