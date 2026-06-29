import * as THREE from "three";
import { isWalkable, type LevelData } from "./level";
import type { MovementControlMode } from "./ui";

const MOVEMENT_EPSILON = 0.0001;
const PLAYER_MODEL_FORWARD_OFFSET = Math.PI;

export type MovementInputContext = {
  mode: MovementControlMode;
  camera: THREE.Camera;
  pointerWorld: THREE.Vector3;
  playerPosition: THREE.Vector3;
  playerYaw: number;
  strafe: number;
  forward: number;
  target?: THREE.Vector3;
};

export function movementInputFor(context: MovementInputContext): THREE.Vector3 {
  const input = context.target?.set(0, 0, 0) ?? new THREE.Vector3();
  if (context.strafe === 0 && context.forward === 0) return input;

  if (context.mode === "screen") {
    const screenRight = new THREE.Vector3();
    const screenUp = new THREE.Vector3();
    context.camera.updateMatrixWorld();
    screenRight.setFromMatrixColumn(context.camera.matrixWorld, 0).setY(0);
    screenUp.setFromMatrixColumn(context.camera.matrixWorld, 1).setY(0);

    if (screenRight.lengthSq() > MOVEMENT_EPSILON && screenUp.lengthSq() > MOVEMENT_EPSILON) {
      screenRight.normalize();
      screenUp.normalize();
      return input.addScaledVector(screenRight, context.strafe).addScaledVector(screenUp, context.forward);
    }
  }

  if (context.mode === "mouse") {
    const aimForward = context.pointerWorld.clone().sub(context.playerPosition).setY(0);
    if (aimForward.lengthSq() <= MOVEMENT_EPSILON) {
      const aimYaw = context.playerYaw - PLAYER_MODEL_FORWARD_OFFSET;
      aimForward.set(Math.sin(aimYaw), 0, Math.cos(aimYaw));
    }

    aimForward.normalize();
    const aimRight = new THREE.Vector3(-aimForward.z, 0, aimForward.x);
    return input.addScaledVector(aimRight, context.strafe).addScaledVector(aimForward, context.forward);
  }

  return input.set(context.strafe, 0, -context.forward);
}

export function moveOnWalkableLevel(
  level: LevelData,
  position: THREE.Vector3,
  direction: THREE.Vector3,
  distance: number,
): boolean {
  if (direction.lengthSq() <= MOVEMENT_EPSILON) return false;

  const current = position.clone();
  const full = current.clone().addScaledVector(direction, distance);
  if (isWalkable(level, full)) {
    position.copy(full);
    return true;
  }

  let moved = false;
  const xOnly = current.clone();
  xOnly.x += direction.x * distance;
  if (isWalkable(level, xOnly)) {
    position.copy(xOnly);
    moved = true;
  }

  const zOnly = position.clone();
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

  const full = position.clone().addScaledVector(direction, distance);
  return isWalkable(level, full);
}
