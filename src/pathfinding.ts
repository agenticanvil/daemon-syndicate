import * as THREE from "three";
import { fromKey, key, neighbors, tileToWorld, worldToTile, type LevelData, type TileCoord } from "./level";

export function findPath(level: LevelData, start: TileCoord, target: TileCoord): string[] | undefined {
  const startKey = key(start);
  const targetKey = key(target);

  if (startKey === targetKey) return [];
  if (!level.walkable.has(startKey) || !level.walkable.has(targetKey)) return undefined;

  const queue: string[] = [startKey];
  const cameFrom = new Map<string, string | undefined>([[startKey, undefined]]);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const currentKey = queue[cursor];
    if (currentKey === targetKey) break;

    for (const neighbor of neighbors(fromKey(currentKey))) {
      const neighborKey = key(neighbor);
      if (!level.walkable.has(neighborKey) || cameFrom.has(neighborKey)) continue;
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
