import * as THREE from "three";
import { isWalkable, type LevelData } from "./level";

const MOVEMENT_EPSILON = 0.0001;
const SCREEN_RIGHT = new THREE.Vector3();
const SCREEN_UP = new THREE.Vector3();
const MOVE_CURRENT = new THREE.Vector3();
const MOVE_FULL = new THREE.Vector3();
const MOVE_X_ONLY = new THREE.Vector3();
const MOVE_Z_ONLY = new THREE.Vector3();

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
): boolean {
  if (direction.lengthSq() <= MOVEMENT_EPSILON) return false;

  const current = MOVE_CURRENT.copy(position);
  const full = MOVE_FULL.copy(current).addScaledVector(direction, distance);
  if (isWalkable(level, full)) {
    position.copy(full);
    return true;
  }

  let moved = false;
  const xOnly = MOVE_X_ONLY.copy(current);
  xOnly.x += direction.x * distance;
  if (isWalkable(level, xOnly)) {
    position.copy(xOnly);
    moved = true;
  }

  const zOnly = MOVE_Z_ONLY.copy(position);
  zOnly.z += direction.z * distance;
  if (isWalkable(level, zOnly)) {
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
): boolean {
  if (direction.lengthSq() <= MOVEMENT_EPSILON) return false;

  const full = MOVE_FULL.copy(position).addScaledVector(direction, distance);
  return isWalkable(level, full);
}
