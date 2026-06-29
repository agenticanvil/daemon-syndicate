import * as THREE from "three";
import { ENEMY_BALANCE, PLAYER_BALANCE } from "./balance";
import { distance2D, withinRadius2D, type CollisionBody2D } from "./collision";
import { key, worldToTile, type LevelData } from "./level";
import { canMoveDirectlyOnWalkableLevel, moveOnWalkableLevel } from "./movement";
import { findWorldPath, hasClearWorldPath, pathDirection } from "./pathfinding";
import type { Rng } from "./rng";
import type { Enemy, EnemyAnimation } from "./enemyTypes";

const MOVEMENT_EPSILON = 0.0001;

export type EnemyBehaviorResult = {
  animation: EnemyAnimation;
  damagedPlayer: boolean;
};

export type EnemyBehaviorContext = {
  enemy: Enemy;
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

  updateEnemyAttackWindup(enemy, dt, playerPosition, context.fireEnemyProjectile);

  if (isRanged) {
    movementDirection =
      enemy.attackWindupTimer === undefined
        ? getRangedEnemyMovementDirection(enemy, playerPosition, playerDistance, pursuitDirection, hasLineOfSight)
        : new THREE.Vector3();
  }

  if (!isRanged && playerDistance > PLAYER_BALANCE.radius + enemy.radius + ENEMY_BALANCE.stopProximity) {
    moved = moveEnemy(level, enemy, movementDirection, enemy.speed * dt);
  } else if (isRanged && movementDirection.lengthSq() > MOVEMENT_EPSILON) {
    moved = moveEnemy(level, enemy, movementDirection, enemy.speed * dt);
  }

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
      const direction = playerPosition.clone().sub(enemy.position).setY(0).normalize();
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
  const direct = playerPosition.clone().sub(enemy.position).setY(0);
  if (direct.lengthSq() <= MOVEMENT_EPSILON) return direct;
  direct.normalize();

  if (playerDistance > ENEMY_BALANCE.pathfindingRadius) {
    enemy.path = undefined;
    enemy.pathTarget = undefined;
    return direct;
  }

  if (
    playerDistance <= ENEMY_BALANCE.directApproachRadius &&
    hasClearWorldPath(level, enemy.position, playerPosition) &&
    canMoveDirectlyOnWalkableLevel(level, enemy.position, direct, moveDistance)
  ) {
    enemy.path = undefined;
    enemy.pathTarget = undefined;
    return direct;
  }

  const playerKey = key(worldToTile(playerPosition));
  enemy.pathRefreshTimer = (enemy.pathRefreshTimer ?? 0) - dt;
  if (!enemy.path || enemy.pathTarget !== playerKey || enemy.pathRefreshTimer <= 0) {
    enemy.path = findWorldPath(level, enemy.position, playerPosition);
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
  const toPlayer = playerPosition.clone().sub(enemy.position).setY(0);
  if (toPlayer.lengthSq() <= MOVEMENT_EPSILON) return new THREE.Vector3();
  toPlayer.normalize();

  const preferredMin = Math.max(enemy.attack.range * 0.46, PLAYER_BALANCE.radius + enemy.radius + 1.2);
  const preferredMax = enemy.attack.range * 0.78;
  const strafeSign = enemy.id % 2 === 0 ? 1 : -1;
  const strafe = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(strafeSign);

  if (playerDistance < preferredMin) {
    return toPlayer.multiplyScalar(-1).addScaledVector(strafe, 0.35).normalize();
  }
  if (!hasLineOfSight || playerDistance > preferredMax) {
    return pursuitDirection;
  }
  return strafe;
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

  const direction = enemy.attackWindupDirection ?? playerPosition.clone().sub(enemy.position).setY(0).normalize();
  fireEnemyProjectile(enemy, direction);
  enemy.attackTimer = enemy.attack.cooldown;
  enemy.attackWindupTimer = undefined;
  enemy.attackWindupDirection = undefined;
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
    const aimDirection = playerPosition.clone().sub(enemy.position).setY(0);
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
  return moveOnWalkableLevel(level, enemy.position, direction, distance);
}

export function canFireEnemyProjectile(direction: THREE.Vector3): boolean {
  return direction.lengthSq() > MOVEMENT_EPSILON;
}
