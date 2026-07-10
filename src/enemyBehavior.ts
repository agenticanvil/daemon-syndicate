import * as THREE from "three";
import { ENEMY_BALANCE, PLAYER_BALANCE } from "./balance";
import { distance2D, withinRadius2D, type CollisionBody2D } from "./collision";
import { key, worldToTile, type LevelData } from "./level";
import { canMoveDirectlyOnWalkableLevel, moveOnWalkableLevel } from "./movement";
import { findWorldPath, hasClearWorldPath, pathDirection } from "./pathfinding";
import type { Rng } from "./rng";
import type { Enemy, EnemyAnimation } from "./enemyTypes";

const MOVEMENT_EPSILON = 0.0001;
const ZERO_DIRECTION = new THREE.Vector3();
const PURSUIT_DIRECT = new THREE.Vector3();
const RANGED_TO_PLAYER = new THREE.Vector3();
const RANGED_STRAFE = new THREE.Vector3();
const MELEE_STEER_TO_PLAYER = new THREE.Vector3();
const MELEE_STEER_STRAFE = new THREE.Vector3();
const MELEE_STEER_SEPARATION = new THREE.Vector3();
const MELEE_STEER_NEIGHBOR_OFFSET = new THREE.Vector3();
const MELEE_STEER_RESULT = new THREE.Vector3();
const WINDUP_DIRECTION = new THREE.Vector3();
const FACING_AIM_DIRECTION = new THREE.Vector3();
const MOVEMENT_START = new THREE.Vector3();
const MOVEMENT_DELTA = new THREE.Vector3();
const MELEE_SEPARATION_RADIUS = 2.15;
const MELEE_SEPARATION_WEIGHT = 0.9;
const MELEE_DODGE_WEIGHT = 0.38;
const MELEE_DODGE_MIN_DISTANCE = 1.7;
const MELEE_DODGE_MAX_DISTANCE = 11;
const MELEE_MIN_PURSUIT_DOT = 0.64;

export type EnemyBehaviorResult = {
  animation: EnemyAnimation;
  damagedPlayer: boolean;
};

export type EnemyBehaviorContext = {
  enemy: Enemy;
  enemies: readonly Enemy[];
  dt: number;
  level: LevelData;
  playerPosition: THREE.Vector3;
  playerCollisionBody: CollisionBody2D;
  canDamagePlayer: boolean;
  damagedPlayerThisFrame: boolean;
  hasAnimatedRig: boolean;
  rng: Rng;
  emitPlayerDamaged: (amount: number) => void;
  fireEnemyProjectile: (enemy: Enemy, direction: THREE.Vector3) => void;
};

export function updateEnemyBehavior(context: EnemyBehaviorContext): EnemyBehaviorResult {
  const { enemy, dt, level, playerPosition, playerCollisionBody } = context;
  let damagedPlayer = context.damagedPlayerThisFrame;

  const playerDistance = distance2D(enemy.position, playerPosition);
  if (playerDistance > ENEMY_BALANCE.activationDistance && enemy.attackWindupTimer === undefined) {
    enemy.path = undefined;
    enemy.pathTarget = undefined;
    enemy.attackTimer -= dt;
    return { animation: "idle", damagedPlayer };
  }

  const attackDistance = PLAYER_BALANCE.radius + enemy.radius + enemy.attack.range;
  const pursuitDirection = getEnemyPursuitDirection({
    enemy,
    playerPosition,
    level,
    playerDistance,
    moveDistance: enemy.speed * dt,
    dt,
    rng: context.rng,
  });
  const isRanged = enemy.attack.kind === "ranged";
  const hasLineOfSight = hasClearWorldPath(level, enemy.position, playerPosition);
  let moved = false;
  let movementDirection = pursuitDirection;

  enemy.steeringRecoveryTimer = Math.max((enemy.steeringRecoveryTimer ?? 0) - dt, 0);

  updateEnemyAttackWindup(enemy, dt, playerPosition, context.fireEnemyProjectile);

  if (isRanged) {
    movementDirection =
      enemy.attackWindupTimer === undefined
        ? getRangedEnemyMovementDirection(enemy, playerPosition, playerDistance, pursuitDirection, hasLineOfSight)
        : ZERO_DIRECTION.set(0, 0, 0);
  } else {
    movementDirection = getMeleeEnemyMovementDirection({
      enemy,
      enemies: context.enemies,
      playerPosition,
      playerDistance,
      pursuitDirection,
      hasLineOfSight,
      dt,
      rng: context.rng,
    });
  }

  if (
    enemy.steeringRecoveryTimer > 0 ||
    !canMoveDirectlyOnWalkableLevel(level, enemy.position, movementDirection, enemy.speed * dt, enemy.radius)
  ) {
    movementDirection = pursuitDirection;
  }

  MOVEMENT_START.copy(enemy.position);
  const shouldMove =
    movementDirection.lengthSq() > MOVEMENT_EPSILON &&
    (isRanged || playerDistance > PLAYER_BALANCE.radius + enemy.radius + ENEMY_BALANCE.stopProximity);
  if (!isRanged && shouldMove) {
    moved = moveEnemy(level, enemy, movementDirection, enemy.speed * dt);
  } else if (isRanged && shouldMove) {
    moved = moveEnemy(level, enemy, movementDirection, enemy.speed * dt);
  }

  updateStuckRecovery(enemy, pursuitDirection, MOVEMENT_START, dt, shouldMove);

  updateEnemyFacing(enemy, playerPosition, movementDirection, hasLineOfSight, isRanged, context.hasAnimatedRig, dt);

  enemy.attackTimer -= dt;
  const inAttackRange =
    isRanged
      ? playerDistance <= attackDistance && hasLineOfSight
      : withinRadius2D(enemy, playerCollisionBody, attackDistance);
  const animation: EnemyAnimation =
    inAttackRange || enemy.attackWindupTimer !== undefined ? "melee" : moved ? "walk" : "idle";

  if (isRanged) {
    if (
      inAttackRange &&
      enemy.attackTimer <= 0 &&
      enemy.attackWindupTimer === undefined &&
      playerCollisionBody.collisionLayer === enemy.collisionLayer
    ) {
      const direction = enemy.attackWindupDirection ?? new THREE.Vector3();
      direction.copy(playerPosition).sub(enemy.position).setY(0).normalize();
      enemy.attackWindupTimer = enemy.attack.windup ?? 0.18;
      enemy.attackWindupDirection = direction;
    }
  } else if (
    inAttackRange &&
    enemy.attackTimer <= 0 &&
    playerCollisionBody.collisionLayer === enemy.collisionLayer &&
    context.canDamagePlayer &&
    !damagedPlayer
  ) {
    enemy.attackTimer = enemy.attack.cooldown;
    damagedPlayer = true;
    context.emitPlayerDamaged(enemy.attack.damage);
  }

  return { animation, damagedPlayer };
}

function getEnemyFacingYaw(direction: THREE.Vector3): number {
  return Math.atan2(-direction.x, -direction.z);
}

function getEnemyPursuitDirection(context: {
  enemy: Enemy;
  playerPosition: THREE.Vector3;
  level: LevelData;
  playerDistance: number;
  moveDistance: number;
  dt: number;
  rng: Rng;
}): THREE.Vector3 {
  const { enemy, playerPosition, level, playerDistance, moveDistance, dt, rng } = context;
  const direct = PURSUIT_DIRECT.copy(playerPosition).sub(enemy.position).setY(0);
  if (direct.lengthSq() <= MOVEMENT_EPSILON) return direct;
  direct.normalize();

  if (playerDistance > ENEMY_BALANCE.pathfindingRadius) {
    enemy.path = undefined;
    enemy.pathTarget = undefined;
    return direct;
  }

  if (
    playerDistance <= ENEMY_BALANCE.directApproachRadius &&
    hasClearWorldPath(level, enemy.position, playerPosition, enemy.radius) &&
    canMoveDirectlyOnWalkableLevel(level, enemy.position, direct, moveDistance, enemy.radius)
  ) {
    enemy.path = undefined;
    enemy.pathTarget = undefined;
    return direct;
  }

  const playerKey = key(worldToTile(playerPosition));
  enemy.pathRefreshTimer = (enemy.pathRefreshTimer ?? 0) - dt;
  if (!enemy.path || enemy.pathTarget !== playerKey || enemy.pathRefreshTimer <= 0) {
    enemy.path = findWorldPath(level, enemy.position, playerPosition, enemy.radius);
    enemy.pathTarget = playerKey;
    enemy.pathRefreshTimer = ENEMY_BALANCE.pathRefreshInterval + rng() * ENEMY_BALANCE.pathRefreshJitter;
  }

  return pathDirection(enemy.path, enemy.position, ENEMY_BALANCE.waypointReachedDistance) ?? direct;
}

function getRangedEnemyMovementDirection(
  enemy: Enemy,
  playerPosition: THREE.Vector3,
  playerDistance: number,
  pursuitDirection: THREE.Vector3,
  hasLineOfSight: boolean,
): THREE.Vector3 {
  const toPlayer = RANGED_TO_PLAYER.copy(playerPosition).sub(enemy.position).setY(0);
  if (toPlayer.lengthSq() <= MOVEMENT_EPSILON) return ZERO_DIRECTION.set(0, 0, 0);
  toPlayer.normalize();

  const preferredMin = Math.max(enemy.attack.range * 0.46, PLAYER_BALANCE.radius + enemy.radius + 1.2);
  const preferredMax = enemy.attack.range * 0.78;
  const strafeSign = enemy.id % 2 === 0 ? 1 : -1;
  const strafe = RANGED_STRAFE.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(strafeSign);

  if (playerDistance < preferredMin) {
    return toPlayer.multiplyScalar(-1).addScaledVector(strafe, 0.35).normalize();
  }
  if (!hasLineOfSight || playerDistance > preferredMax) {
    return pursuitDirection;
  }
  return strafe;
}

function getMeleeEnemyMovementDirection(context: {
  enemy: Enemy;
  enemies: readonly Enemy[];
  playerPosition: THREE.Vector3;
  playerDistance: number;
  pursuitDirection: THREE.Vector3;
  hasLineOfSight: boolean;
  dt: number;
  rng: Rng;
}): THREE.Vector3 {
  const { enemy, enemies, playerPosition, playerDistance, pursuitDirection, hasLineOfSight, dt, rng } = context;
  if (pursuitDirection.lengthSq() <= MOVEMENT_EPSILON) return pursuitDirection;

  enemy.movementJukeTimer = (enemy.movementJukeTimer ?? 0) - dt;
  if (enemy.movementJukeTimer <= 0 || enemy.movementJukeSign === undefined) {
    enemy.movementJukeTimer = 0.42 + rng() * 0.46;
    enemy.movementJukeSign = rng() < 0.5 ? -1 : 1;
  }

  const toPlayer = MELEE_STEER_TO_PLAYER.copy(playerPosition).sub(enemy.position).setY(0);
  if (toPlayer.lengthSq() <= MOVEMENT_EPSILON) return pursuitDirection;
  toPlayer.normalize();

  const strafe = MELEE_STEER_STRAFE.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(enemy.movementJukeSign);
  const dodgePressure =
    hasLineOfSight && playerDistance > MELEE_DODGE_MIN_DISTANCE && playerDistance < MELEE_DODGE_MAX_DISTANCE ? 1 : 0.35;
  const separation = meleeSeparationDirection(enemy, enemies, MELEE_STEER_SEPARATION);

  const result = MELEE_STEER_RESULT.copy(pursuitDirection)
    .addScaledVector(strafe, MELEE_DODGE_WEIGHT * dodgePressure)
    .addScaledVector(separation, MELEE_SEPARATION_WEIGHT);

  if (result.lengthSq() <= MOVEMENT_EPSILON) return pursuitDirection;
  result.normalize();

  if (result.dot(pursuitDirection) < MELEE_MIN_PURSUIT_DOT) {
    result.multiplyScalar(0.45).addScaledVector(pursuitDirection, 0.8).normalize();
  }

  return result;
}

function meleeSeparationDirection(enemy: Enemy, enemies: readonly Enemy[], target: THREE.Vector3): THREE.Vector3 {
  target.set(0, 0, 0);

  for (const other of enemies) {
    if (other === enemy || other.deathTimer !== undefined) continue;
    const offset = MELEE_STEER_NEIGHBOR_OFFSET.copy(enemy.position).sub(other.position).setY(0);
    const distanceSq = offset.lengthSq();
    if (distanceSq <= MOVEMENT_EPSILON || distanceSq >= MELEE_SEPARATION_RADIUS * MELEE_SEPARATION_RADIUS) continue;

    const distance = Math.sqrt(distanceSq);
    const strength = (MELEE_SEPARATION_RADIUS - distance) / MELEE_SEPARATION_RADIUS;
    target.addScaledVector(offset, strength / distance);
  }

  if (target.lengthSq() > MOVEMENT_EPSILON) target.normalize();
  return target;
}

function updateEnemyAttackWindup(
  enemy: Enemy,
  dt: number,
  playerPosition: THREE.Vector3,
  fireEnemyProjectile: (enemy: Enemy, direction: THREE.Vector3) => void,
): void {
  if (enemy.attackWindupTimer === undefined) return;

  enemy.attackWindupTimer -= dt;
  if (enemy.attackWindupTimer > 0) return;

  const direction =
    enemy.attackWindupDirection ?? WINDUP_DIRECTION.copy(playerPosition).sub(enemy.position).setY(0).normalize();
  fireEnemyProjectile(enemy, direction);
  enemy.attackTimer = enemy.attack.cooldown;
  enemy.attackWindupTimer = undefined;
}

function updateEnemyFacing(
  enemy: Enemy,
  playerPosition: THREE.Vector3,
  movementDirection: THREE.Vector3,
  hasLineOfSight: boolean,
  isRanged: boolean,
  hasAnimatedRig: boolean,
  dt: number,
): void {
  if (isRanged && (hasLineOfSight || enemy.attackWindupTimer !== undefined)) {
    const aimDirection = FACING_AIM_DIRECTION.copy(playerPosition).sub(enemy.position).setY(0);
    if (aimDirection.lengthSq() > MOVEMENT_EPSILON) {
      enemy.facingYaw = getEnemyFacingYaw(aimDirection.normalize());
    }
  } else if (movementDirection.lengthSq() > MOVEMENT_EPSILON) {
    enemy.facingYaw = getEnemyFacingYaw(movementDirection);
  } else if (!hasAnimatedRig) {
    enemy.facingYaw += dt * 2.4;
  }
}

function moveEnemy(level: LevelData, enemy: Enemy, direction: THREE.Vector3, distance: number): boolean {
  return moveOnWalkableLevel(level, enemy.position, direction, distance, enemy.radius);
}

function updateStuckRecovery(
  enemy: Enemy,
  pursuitDirection: THREE.Vector3,
  movementStart: THREE.Vector3,
  dt: number,
  attemptedMovement: boolean,
): void {
  if (!attemptedMovement || pursuitDirection.lengthSq() <= MOVEMENT_EPSILON) {
    enemy.stuckTimer = 0;
    return;
  }

  const forwardProgress = MOVEMENT_DELTA.copy(enemy.position).sub(movementStart).dot(pursuitDirection);
  if (forwardProgress > enemy.speed * dt * 0.1) {
    enemy.stuckTimer = 0;
    return;
  }

  enemy.stuckTimer = (enemy.stuckTimer ?? 0) + dt;
  if (enemy.stuckTimer < ENEMY_BALANCE.stuckRecoveryDelay) return;

  enemy.path = undefined;
  enemy.pathTarget = undefined;
  enemy.pathRefreshTimer = 0;
  enemy.movementJukeTimer = 0;
  enemy.steeringRecoveryTimer = ENEMY_BALANCE.stuckRecoveryDuration;
  enemy.stuckTimer = 0;
}

export function canFireEnemyProjectile(direction: THREE.Vector3): boolean {
  return direction.lengthSq() > MOVEMENT_EPSILON;
}
