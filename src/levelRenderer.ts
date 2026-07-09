import * as THREE from "three";
import { LEVEL_HEIGHT, LEVEL_WIDTH, TILE_SIZE } from "./constants";
import { DEFAULT_FLOOR_VARIANT_ID, FLOOR_VARIANTS, type FloorVariantId } from "./floorVariants";
import { key, neighbors, tileToWorld, type LevelData, type TileCoord } from "./level";

export type LevelRenderMaterials = {
  floors: Record<FloorVariantId, THREE.MeshStandardMaterial>;
  floorDecal: THREE.MeshBasicMaterial;
  edge: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  wallUpper: THREE.MeshStandardMaterial;
  void: THREE.MeshBasicMaterial;
  rim: THREE.MeshBasicMaterial;
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
  updateWallOcclusion: (playerPosition: THREE.Vector3, camera: THREE.Camera, dt: number, instant?: boolean) => void;
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
const FLOOR_TEXTURE_SPAN_TILES = 2;
const FLOOR_DECAL_OFFSET = 0.026;
const FLOOR_DECAL_MIN_COUNT = 3;
const FLOOR_DECAL_TILES_PER_PLACEMENT = 5;
const WALL_THICKNESS = 0.2;
const WALL_PLINTH_HEIGHT = 0.64;
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
    floorTiles.receiveShadow = true;
    floorTiles.frustumCulled = false;
    root.add(floorTiles);
    disposables.push(floorTiles);
  }

  const floorDecals = createFloorDecals(level, materials.floorDecal);
  if (floorDecals) {
    root.add(floorDecals);
    disposables.push(floorDecals);
  }

  const fogBatch = createFogBatch([...level.walkable], level.walkable);
  root.add(fogBatch.curtainMesh, fogBatch.mesh);
  disposables.push(fogBatch.curtainMesh, fogBatch.mesh);

  const edgeGeometry = new THREE.BoxGeometry(TILE_SIZE, 0.8, 0.22);
  const rimGeometry = new THREE.BoxGeometry(TILE_SIZE, 0.04, 0.08);
  const wallPlinthGeometry = new THREE.BoxGeometry(TILE_SIZE, WALL_PLINTH_HEIGHT, WALL_THICKNESS);
  const wallUpperGeometry = new THREE.BoxGeometry(TILE_SIZE, WALL_UPPER_HEIGHT, WALL_THICKNESS);
  const edgeTransforms: THREE.Matrix4[] = [];
  const rimTransforms: THREE.Matrix4[] = [];
  const wallPlinthTransforms: THREE.Matrix4[] = [];
  const wallUpperTransforms: THREE.Matrix4[] = [];
  const wallEdges: WallEdge[] = [];
  const edgeOwnerTiles: TileCoord[] = [];
  const boundaryEdges = collectBoundaryEdges(level);
  const vertexOrientations = collectVertexOrientations(boundaryEdges);

  for (const boundaryEdge of boundaryEdges) {
    const edgeTransform = createBoundaryTransform(boundaryEdge, -0.36, 0.22, vertexOrientations);
    const rimTransform = createBoundaryTransform(boundaryEdge, 0.06, 0.08, vertexOrientations);
    const wallPlinthTransform = createBoundaryTransform(
      boundaryEdge,
      WALL_PLINTH_HEIGHT * 0.5,
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
    edgeOwnerTiles.push(boundaryEdge.ownerTile);
  }

  const edges = new THREE.InstancedMesh(edgeGeometry, materials.edge, edgeTransforms.length);
  const rims = new THREE.InstancedMesh(rimGeometry, materials.rim, rimTransforms.length);
  const wallPlinths = new THREE.InstancedMesh(wallPlinthGeometry, materials.wall, wallPlinthTransforms.length);
  const wallFadeValues = new Float32Array(wallUpperTransforms.length).fill(1);
  const wallFade = new THREE.InstancedBufferAttribute(wallFadeValues, 1);
  wallUpperGeometry.setAttribute("wallFade", wallFade);
  const upperWalls = new THREE.InstancedMesh(wallUpperGeometry, materials.wallUpper, wallUpperTransforms.length);
  edges.frustumCulled = false;
  rims.frustumCulled = false;
  wallPlinths.frustumCulled = false;
  upperWalls.frustumCulled = false;
  wallPlinths.castShadow = true;
  wallPlinths.receiveShadow = true;
  upperWalls.castShadow = true;
  upperWalls.receiveShadow = true;
  wallPlinths.name = "level-wall-plinths";
  upperWalls.name = "level-wall-uppers";
  root.add(edges, wallPlinths, upperWalls, rims);
  disposables.push(edges, rims, wallPlinths, upperWalls);

  disposables.push(...addStartPad(root, level.start));
  root.userData[LEVEL_RENDER_DISPOSABLES_KEY] = disposables;

  let currentExploredKeys: ReadonlySet<string> = new Set();
  const updateExploredTiles = (exploredKeys: ReadonlySet<string>): void => {
    currentExploredKeys = exploredKeys;
    updateFogBatch(fogBatch, exploredKeys);
    edgeTransforms.forEach((edgeTransform, index) => {
      const visible = isConnectedExploredTile(edgeOwnerTiles[index], exploredKeys);
      edges.setMatrixAt(index, visible ? edgeTransform : HIDDEN_MATRIX);
      rims.setMatrixAt(index, visible ? rimTransforms[index] : HIDDEN_MATRIX);
      wallPlinths.setMatrixAt(index, visible ? wallPlinthTransforms[index] : HIDDEN_MATRIX);
      upperWalls.setMatrixAt(index, visible ? wallUpperTransforms[index] : HIDDEN_MATRIX);
    });
    edges.instanceMatrix.needsUpdate = true;
    rims.instanceMatrix.needsUpdate = true;
    wallPlinths.instanceMatrix.needsUpdate = true;
    upperWalls.instanceMatrix.needsUpdate = true;
  };

  const playerOcclusionTarget = new THREE.Vector3();
  const cameraToPlayer = new THREE.Vector3();
  const wallIntersection = new THREE.Vector3();
  const wallOffset = new THREE.Vector3();
  const updateWallOcclusion = (playerPosition: THREE.Vector3, camera: THREE.Camera, dt: number, instant = false): void => {
    playerOcclusionTarget.copy(playerPosition).addScaledVector(THREE.Object3D.DEFAULT_UP, WALL_OCCLUSION_TARGET_HEIGHT);
    cameraToPlayer.copy(playerOcclusionTarget).sub(camera.position);
    if (cameraToPlayer.lengthSq() < 0.0001) return;

    wallEdges.forEach((wallEdge, index) => {
      if (!isConnectedExploredTile(edgeOwnerTiles[index], currentExploredKeys)) return;
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
  updateExploredTiles(new Set());

  return { updateExploredTiles, updateWallOcclusion };
}

function collectBoundaryEdges(level: LevelData): BoundaryEdge[] {
  const boundaryEdges: BoundaryEdge[] = [];
  for (const tileKey of level.walkable) {
    const [x, y] = tileKey.split(",").map(Number);
    const ownerTile = { x, y };
    for (const neighbor of neighbors(ownerTile)) {
      if (level.walkable.has(key(neighbor))) continue;
      const dirX = neighbor.x - ownerTile.x;
      const dirY = neighbor.y - ownerTile.y;
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
