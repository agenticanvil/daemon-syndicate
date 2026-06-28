import * as THREE from "three";
import { WEAPON_BALANCE } from "./balance";
import { distance2D } from "./collision";
import { exitGateToWorld, type LevelData } from "./level";
import { findWorldPath, hasClearWorldPath, pathDirection } from "./pathfinding";
import type { GameSimulationSnapshot } from "./gameSimulation";
import type { PlayerCommand } from "./playerCommand";
import type { Pickup, ResourceKind } from "./types";

type PickupSnapshot = GameSimulationSnapshot["pickups"][number];
type EnemySnapshot = GameSimulationSnapshot["enemies"][number];

const WAYPOINT_REACHED_DISTANCE = 0.35;
const LOW_HEALTH = 55;
const LOW_AMMO = 18;
const LOW_ENERGY = WEAPON_BALANCE.nova.energyCost;
const PRIMARY_RANGE = 16;
const TOO_CLOSE = 4.2;
const PREFERRED_RANGE = 8.4;

export class BasicPlayerAi {
  private tick = 0;

  next(snapshot: GameSimulationSnapshot): PlayerCommand {
    this.tick += 1;
    const level = levelFromSnapshot(snapshot);
    const playerPosition = vectorFromSnapshot(snapshot.player.position);
    const livingEnemies = snapshot.enemies.filter((enemy) => enemy.deathTimer === undefined && enemy.hp > 0);
    const nearestEnemy = nearest(playerPosition, livingEnemies);
    const priorityPickup = this.pickPriorityPickup(snapshot);
    const aimWorld = nearestEnemy
      ? vectorFromSnapshot(nearestEnemy.position)
      : exitGateToWorld(snapshot.level.end, snapshot.level.exitDirection);

    let movement = new THREE.Vector3();
    if (priorityPickup && (!nearestEnemy || distance2D(playerPosition, vectorFromSnapshot(priorityPickup.position)) < 9)) {
      movement = directionTo(level, playerPosition, vectorFromSnapshot(priorityPickup.position));
    } else if (nearestEnemy) {
      movement = this.combatMovement(level, playerPosition, vectorFromSnapshot(nearestEnemy.position));
    } else {
      movement = directionTo(level, playerPosition, exitGateToWorld(snapshot.level.end, snapshot.level.exitDirection));
    }

    const nearbyEnemyCount = livingEnemies.filter(
      (enemy) => distance2D(playerPosition, vectorFromSnapshot(enemy.position)) <= WEAPON_BALANCE.nova.radius,
    ).length;
    const canSeeTarget = nearestEnemy
      ? hasClearWorldPath(level, playerPosition, vectorFromSnapshot(nearestEnemy.position))
      : false;
    const targetDistance = nearestEnemy ? distance2D(playerPosition, vectorFromSnapshot(nearestEnemy.position)) : Infinity;
    const dashUnlocked = snapshot.progression.upgrades.dash > 0;

    return {
      movement,
      aimWorld,
      firePrimary:
        Boolean(nearestEnemy) &&
        canSeeTarget &&
        targetDistance <= PRIMARY_RANGE &&
        snapshot.player.resources.ammo >= WEAPON_BALANCE.primary.ammoCost,
      fireNova:
        snapshot.player.resources.energy >= WEAPON_BALANCE.nova.energyCost &&
        (nearbyEnemyCount >= 2 || targetDistance <= TOO_CLOSE * 0.72),
      dash:
        dashUnlocked &&
        snapshot.player.dashTimer <= 0 &&
        snapshot.player.resources.energy >= 18 &&
        targetDistance <= TOO_CLOSE * 0.9,
    };
  }

  private combatMovement(level: LevelData, playerPosition: THREE.Vector3, enemyPosition: THREE.Vector3): THREE.Vector3 {
    const offset = playerPosition.clone().sub(enemyPosition).setY(0);
    const distance = offset.length();
    if (distance <= 0.001) return new THREE.Vector3();

    const away = offset.normalize();
    const strafeSign = this.tick % 120 < 60 ? 1 : -1;
    const strafe = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar(strafeSign);

    if (distance < TOO_CLOSE) {
      return away.addScaledVector(strafe, 0.35).normalize();
    }
    if (distance > PREFERRED_RANGE) {
      return directionTo(level, playerPosition, enemyPosition);
    }
    return strafe;
  }

  private pickPriorityPickup(snapshot: GameSimulationSnapshot): PickupSnapshot | undefined {
    const wanted = new Set<ResourceKind>();
    if (snapshot.player.resources.health < LOW_HEALTH) wanted.add("health");
    if (snapshot.player.resources.ammo < LOW_AMMO) wanted.add("ammo");
    if (snapshot.player.resources.energy < LOW_ENERGY) wanted.add("energy");
    if (wanted.size === 0) return undefined;

    const playerPosition = vectorFromSnapshot(snapshot.player.position);
    return nearest(
      playerPosition,
      snapshot.pickups.filter((pickup) => wanted.has(pickup.kind)),
    );
  }
}

function nearest<T extends EnemySnapshot | PickupSnapshot | Pickup>(
  position: THREE.Vector3,
  candidates: T[],
): T | undefined {
  let best: T | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = distance2D(position, vectorFromSnapshot(candidate.position));
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function directionTo(level: LevelData, from: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
  const direct = target.clone().sub(from).setY(0);
  if (direct.lengthSq() <= 0.001) return new THREE.Vector3();
  if (hasClearWorldPath(level, from, target)) return direct.normalize();

  const path = findWorldPath(level, from, target);
  return pathDirection(path, from, WAYPOINT_REACHED_DISTANCE) ?? direct.normalize();
}

function levelFromSnapshot(snapshot: GameSimulationSnapshot): LevelData {
  return {
    id: snapshot.level.id,
    width: snapshot.level.width,
    height: snapshot.level.height,
    exitDirection: snapshot.level.exitDirection,
    start: { ...snapshot.level.start },
    end: { ...snapshot.level.end },
    walkable: new Set(snapshot.level.walkable),
    blocked: new Set(snapshot.level.blocked),
    environmentalObjects: snapshot.level.environmentalObjects.map((object) => ({
      kind: object.kind as LevelData["environmentalObjects"][number]["kind"],
      tile: { ...object.tile },
      rotation: object.rotation,
    })),
    spawnPoints: snapshot.level.spawnPoints.map((spawn) => ({ ...spawn })),
  };
}

function vectorFromSnapshot(vector: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(vector.x, vector.y, vector.z);
}
