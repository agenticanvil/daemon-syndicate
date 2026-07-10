import * as THREE from "three";
import { LEVEL_HEIGHT, LEVEL_WIDTH, TILE_SIZE } from "./constants";
import { isWalkable, type LevelData } from "./level";

const MOVEMENT_EPSILON = 0.0001;
const SCREEN_RIGHT = new THREE.Vector3();
const SCREEN_UP = new THREE.Vector3();
const MOVE_CURRENT = new THREE.Vector3();
const MOVE_FULL = new THREE.Vector3();
const MOVE_X_ONLY = new THREE.Vector3();
const MOVE_Z_ONLY = new THREE.Vector3();
const SEGMENT_SAMPLE = new THREE.Vector3();

export type MovementInputContext = {
  camera: THREE.Camera;
  strafe: number;
  forward: number;
  target?: THREE.Vector3;
};

export function movementInputFor(context: MovementInputContext): THREE.Vector3 {
  const input = context.target?.set(0, 0, 0) ?? new THREE.Vector3();
  if (context.strafe === 0 && context.forward === 0) return input;

  context.camera.updateMatrixWorld();
  const screenRight = SCREEN_RIGHT.setFromMatrixColumn(context.camera.matrixWorld, 0).setY(0);
  const screenUp = SCREEN_UP.setFromMatrixColumn(context.camera.matrixWorld, 1).setY(0);

  if (screenRight.lengthSq() > MOVEMENT_EPSILON && screenUp.lengthSq() > MOVEMENT_EPSILON) {
    screenRight.normalize();
    screenUp.normalize();
    return normalizeMovementInput(input.addScaledVector(screenRight, context.strafe).addScaledVector(screenUp, context.forward));
  }

  return input;
}

function normalizeMovementInput(input: THREE.Vector3): THREE.Vector3 {
  if (input.lengthSq() > MOVEMENT_EPSILON) input.normalize();
  return input;
}

export function moveOnWalkableLevel(
  level: LevelData,
  position: THREE.Vector3,
  direction: THREE.Vector3,
  distance: number,
  radius = 0,
): boolean {
  if (direction.lengthSq() <= MOVEMENT_EPSILON) return false;

  const current = MOVE_CURRENT.copy(position);
  const full = MOVE_FULL.copy(current).addScaledVector(direction, distance);
  if (isWalkableWithRadius(level, full, radius)) {
    position.copy(full);
    return true;
  }

  let moved = false;
  const xOnly = MOVE_X_ONLY.copy(current);
  xOnly.x += direction.x * distance;
  if (Math.abs(direction.x) > MOVEMENT_EPSILON && isWalkableWithRadius(level, xOnly, radius)) {
    position.copy(xOnly);
    moved = true;
  }

  const zOnly = MOVE_Z_ONLY.copy(position);
  zOnly.z += direction.z * distance;
  if (Math.abs(direction.z) > MOVEMENT_EPSILON && isWalkableWithRadius(level, zOnly, radius)) {
    position.copy(zOnly);
    moved = true;
  }

  return moved;
}

export function canMoveDirectlyOnWalkableLevel(
  level: LevelData,
  position: THREE.Vector3,
  direction: THREE.Vector3,
  distance: number,
  radius = 0,
): boolean {
  if (direction.lengthSq() <= MOVEMENT_EPSILON) return false;

  const full = MOVE_FULL.copy(position).addScaledVector(direction, distance);
  return isWalkableWithRadius(level, full, radius);
}

export function hasClearMovementSegment(
  level: LevelData,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius = 0,
): boolean {
  const distance = from.distanceTo(to);
  if (distance <= MOVEMENT_EPSILON) return isWalkableWithRadius(level, from, radius);

  const sampleSpacing = Math.max(
    TILE_SIZE * 0.05,
    Math.min(TILE_SIZE * 0.25, radius > MOVEMENT_EPSILON ? radius * 0.5 : TILE_SIZE * 0.25),
  );
  const steps = Math.ceil(distance / sampleSpacing);

  for (let step = 0; step <= steps; step += 1) {
    SEGMENT_SAMPLE.lerpVectors(from, to, step / steps);
    if (!isWalkableWithRadius(level, SEGMENT_SAMPLE, radius)) return false;
  }

  return true;
}

export function isWalkableWithRadius(level: LevelData, position: THREE.Vector3, radius: number): boolean {
  if (!isWalkable(level, position)) return false;
  if (radius <= MOVEMENT_EPSILON) return true;

  const gridX = position.x / TILE_SIZE + (LEVEL_WIDTH - 1) * 0.5;
  const gridY = position.z / TILE_SIZE + (LEVEL_HEIGHT - 1) * 0.5;
  const radiusInTiles = radius / TILE_SIZE;
  const minTileX = Math.ceil(gridX - radiusInTiles - 0.5);
  const maxTileX = Math.floor(gridX + radiusInTiles + 0.5);
  const minTileY = Math.ceil(gridY - radiusInTiles - 0.5);
  const maxTileY = Math.floor(gridY + radiusInTiles + 0.5);
  const radiusSquared = radius * radius;
  const halfTile = TILE_SIZE * 0.5;

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const tileKey = `${tileX},${tileY}`;
      if (level.walkable.has(tileKey) && !level.blocked.has(tileKey)) continue;

      const tileCenterX = (tileX - (LEVEL_WIDTH - 1) * 0.5) * TILE_SIZE;
      const tileCenterZ = (tileY - (LEVEL_HEIGHT - 1) * 0.5) * TILE_SIZE;
      const closestX = THREE.MathUtils.clamp(position.x, tileCenterX - halfTile, tileCenterX + halfTile);
      const closestZ = THREE.MathUtils.clamp(position.z, tileCenterZ - halfTile, tileCenterZ + halfTile);
      const deltaX = position.x - closestX;
      const deltaZ = position.z - closestZ;

      if (deltaX * deltaX + deltaZ * deltaZ < radiusSquared - MOVEMENT_EPSILON * MOVEMENT_EPSILON) {
        return false;
      }
    }
  }

  return true;
}
