import * as THREE from "three";
import { fromKey, isTileWalkable, key, neighbors, tileToWorld, worldToTile, type LevelData, type TileCoord } from "./level";

export function findPath(level: LevelData, start: TileCoord, target: TileCoord): string[] | undefined {
  const startKey = key(start);
  const targetKey = key(target);

  if (startKey === targetKey) return [];
  if (!isTileWalkable(level, start) || !isTileWalkable(level, target)) return undefined;

  const queue: string[] = [startKey];
  const cameFrom = new Map<string, string | undefined>([[startKey, undefined]]);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const currentKey = queue[cursor];
    if (currentKey === targetKey) break;

    for (const neighbor of neighbors(fromKey(currentKey))) {
      const neighborKey = key(neighbor);
      if (!isTileWalkable(level, neighbor) || cameFrom.has(neighborKey)) continue;
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

export function findWorldPath(level: LevelData, from: THREE.Vector3, target: THREE.Vector3): string[] | undefined {
  return findPath(level, worldToTile(from), worldToTile(target));
}

export function hasClearWorldPath(level: LevelData, from: THREE.Vector3, target: THREE.Vector3): boolean {
  return hasClearTileLine(level, worldToTile(from), worldToTile(target));
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
