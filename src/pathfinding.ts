import * as THREE from "three";
import { fromKey, isTileWalkable, key, neighbors, tileToWorld, worldToTile, type LevelData, type TileCoord } from "./level";
import { hasClearMovementSegment, isWalkableWithRadius } from "./movement";

export function findPath(level: LevelData, start: TileCoord, target: TileCoord, radius = 0): string[] | undefined {
  const startKey = key(start);
  const targetKey = key(target);

  if (startKey === targetKey) return [];
  if (!isTileClear(level, start, radius) || !isTileClear(level, target, radius)) return undefined;

  const queue: string[] = [startKey];
  const cameFrom = new Map<string, string | undefined>([[startKey, undefined]]);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const currentKey = queue[cursor];
    if (currentKey === targetKey) break;

    for (const neighbor of neighbors(fromKey(currentKey))) {
      const neighborKey = key(neighbor);
      if (!isTileClear(level, neighbor, radius) || cameFrom.has(neighborKey)) continue;
      cameFrom.set(neighborKey, currentKey);
      queue.push(neighborKey);
    }
  }

  if (!cameFrom.has(targetKey)) return undefined;

  const path: string[] = [];
  let current: string | undefined = targetKey;
  while (current && current !== startKey) {
    path.push(current);
    current = cameFrom.get(current);
  }
  path.reverse();
  return path;
}

export function findWorldPath(
  level: LevelData,
  from: THREE.Vector3,
  target: THREE.Vector3,
  radius = 0,
): string[] | undefined {
  const start = worldToTile(from);
  const path = findPath(level, start, worldToTile(target), radius);
  if (!path || path.length === 0 || radius <= 0) return path;

  const firstWaypoint = tileToWorld(fromKey(path[0]));
  if (hasClearMovementSegment(level, from, firstWaypoint, radius)) return path;

  const startKey = key(start);
  const startCenter = tileToWorld(start);
  return hasClearMovementSegment(level, from, startCenter, radius) ? [startKey, ...path] : undefined;
}

export function hasClearWorldPath(level: LevelData, from: THREE.Vector3, target: THREE.Vector3, radius = 0): boolean {
  return radius <= 0
    ? hasClearTileLine(level, worldToTile(from), worldToTile(target))
    : hasClearMovementSegment(level, from, target, radius);
}

export function hasClearTileLine(level: LevelData, start: TileCoord, target: TileCoord): boolean {
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return isTileWalkable(level, start);

  for (let step = 0; step <= steps; step += 1) {
    const tile = {
      x: Math.round(start.x + (dx * step) / steps),
      y: Math.round(start.y + (dy * step) / steps),
    };
    if (!isTileWalkable(level, tile)) return false;
  }

  return true;
}

export function pathDirection(
  path: string[] | undefined,
  position: THREE.Vector3,
  waypointReachedDistance: number,
): THREE.Vector3 | undefined {
  if (!path || path.length === 0) return undefined;

  while (path.length > 0) {
    const waypoint = tileToWorld(fromKey(path[0]));
    const offset = waypoint.sub(position).setY(0);
    if (offset.length() > waypointReachedDistance) {
      return offset.normalize();
    }
    path.shift();
  }

  return undefined;
}

function isTileClear(level: LevelData, tile: TileCoord, radius: number): boolean {
  return isTileWalkable(level, tile) && (radius <= 0 || isWalkableWithRadius(level, tileToWorld(tile), radius));
}
