import * as THREE from "three";
import { LEVEL_HEIGHT, LEVEL_WIDTH, TILE_SIZE } from "./constants";

export type TileCoord = {
  x: number;
  y: number;
};

export type ExitDirection = "north" | "east";

export type LevelData = {
  id: number;
  width: number;
  height: number;
  exitDirection: ExitDirection;
  start: TileCoord;
  end: TileCoord;
  walkable: Set<string>;
  spawnPoints: TileCoord[];
};

const CARDINALS: TileCoord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function generateLevel(id: number): LevelData {
  const width = LEVEL_WIDTH;
  const height = LEVEL_HEIGHT;
  const exitDirection: ExitDirection = Math.random() < 0.55 ? "north" : "east";
  const start = { x: 3, y: height - 4 };
  const end = exitDirection === "north" ? { x: width - 5, y: 1 } : { x: width - 2, y: 5 };
  const path = buildMainPath(start, end, exitDirection, width, height);
  const walkable = new Set<string>();

  carveRoom(walkable, path[0], width, height, 1);
  for (let i = 1; i < path.length; i += 1) {
    carveCorridor(walkable, path[i - 1], path[i], width, height);
  }

  const branchCount = 3 + Math.min(Math.floor(id / 2), 4);
  for (let i = 0; i < branchCount; i += 1) {
    const anchor = path[3 + Math.floor(Math.random() * Math.max(path.length - 6, 1))];
    carveBranch(walkable, anchor, width, height, 4 + Math.floor(Math.random() * 5));
  }

  carveRoom(walkable, start, width, height, 2);
  carveRoom(walkable, end, width, height, 1);
  walkable.add(key(start));
  walkable.add(key(end));

  const spawnPoints = [...walkable]
    .map(fromKey)
    .filter((tile) => distance(tile, start) > 6 && distance(tile, end) > 3);

  return { id, width, height, exitDirection, start, end, walkable, spawnPoints };
}

export function key(tile: TileCoord): string {
  return `${tile.x},${tile.y}`;
}

export function fromKey(value: string): TileCoord {
  const [x, y] = value.split(",").map(Number);
  return { x, y };
}

export function tileToWorld(tile: TileCoord): THREE.Vector3 {
  return new THREE.Vector3(
    (tile.x - (LEVEL_WIDTH - 1) / 2) * TILE_SIZE,
    0,
    (tile.y - (LEVEL_HEIGHT - 1) / 2) * TILE_SIZE,
  );
}

export function exitGateToWorld(tile: TileCoord, direction: ExitDirection): THREE.Vector3 {
  const position = tileToWorld(tile);
  if (direction === "east") {
    position.x += TILE_SIZE * 0.5;
  } else {
    position.z -= TILE_SIZE * 0.5;
  }
  return position;
}

export function worldToTile(position: THREE.Vector3): TileCoord {
  return {
    x: Math.round(position.x / TILE_SIZE + (LEVEL_WIDTH - 1) / 2),
    y: Math.round(position.z / TILE_SIZE + (LEVEL_HEIGHT - 1) / 2),
  };
}

export function isWalkable(level: LevelData, position: THREE.Vector3): boolean {
  return level.walkable.has(key(worldToTile(position)));
}

export function randomSpawnPoint(level: LevelData): THREE.Vector3 {
  const source = level.spawnPoints.length > 0 ? level.spawnPoints : [...level.walkable].map(fromKey);
  return tileToWorld(source[Math.floor(Math.random() * source.length)]);
}

export function neighbors(tile: TileCoord): TileCoord[] {
  return CARDINALS.map((dir) => ({ x: tile.x + dir.x, y: tile.y + dir.y }));
}

function buildMainPath(
  start: TileCoord,
  end: TileCoord,
  exitDirection: ExitDirection,
  width: number,
  height: number,
): TileCoord[] {
  const path: TileCoord[] = [{ ...start }];
  const current = { ...start };
  let guard = 0;

  while ((current.x !== end.x || current.y !== end.y) && guard < 140) {
    guard += 1;
    const options: TileCoord[] = [];
    if (current.x < end.x) options.push({ x: current.x + 1, y: current.y });
    if (current.y > end.y) options.push({ x: current.x, y: current.y - 1 });
    if (Math.random() < 0.24 && current.y < height - 4) options.push({ x: current.x, y: current.y + 1 });
    if (Math.random() < 0.2 && current.x > 3) options.push({ x: current.x - 1, y: current.y });

    const preferred =
      exitDirection === "east"
        ? options.sort((a, b) => Math.abs(a.x - end.x) - Math.abs(b.x - end.x))
        : options.sort((a, b) => Math.abs(a.y - end.y) - Math.abs(b.y - end.y));
    const next = preferred[Math.floor(Math.random() * Math.min(preferred.length, 2))] ?? end;
    current.x = THREE.MathUtils.clamp(next.x, 1, width - 2);
    current.y = THREE.MathUtils.clamp(next.y, 1, height - 2);
    path.push({ ...current });
  }

  while (current.x !== end.x) {
    current.x += Math.sign(end.x - current.x);
    path.push({ ...current });
  }

  while (current.y !== end.y) {
    current.y += Math.sign(end.y - current.y);
    path.push({ ...current });
  }

  return path;
}

function carveBranch(walkable: Set<string>, anchor: TileCoord, width: number, height: number, length: number): void {
  const current = { ...anchor };
  const dir = CARDINALS[Math.floor(Math.random() * CARDINALS.length)];
  for (let i = 0; i < length; i += 1) {
    const previous = { ...current };
    current.x = THREE.MathUtils.clamp(current.x + dir.x, 2, width - 3);
    current.y = THREE.MathUtils.clamp(current.y + dir.y, 2, height - 3);
    carveCorridor(walkable, previous, current, width, height);
    if (Math.random() < 0.25) {
      carveRoom(walkable, current, width, height, 1);
    }
  }
}

function carveCorridor(
  walkable: Set<string>,
  from: TileCoord,
  to: TileCoord,
  width: number,
  height: number,
): void {
  addWalkable(walkable, to, width, height);

  if (from.x !== to.x) {
    addWalkable(walkable, { x: from.x, y: from.y + perpendicularOffset(from.y, height) }, width, height);
    addWalkable(walkable, { x: to.x, y: to.y + perpendicularOffset(to.y, height) }, width, height);
  }

  if (from.y !== to.y) {
    addWalkable(walkable, { x: from.x + perpendicularOffset(from.x, width), y: from.y }, width, height);
    addWalkable(walkable, { x: to.x + perpendicularOffset(to.x, width), y: to.y }, width, height);
  }
}

function carveRoom(walkable: Set<string>, center: TileCoord, width: number, height: number, radius: number): void {
  for (let y = center.y - radius; y <= center.y + radius; y += 1) {
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      addWalkable(walkable, { x, y }, width, height);
    }
  }
}

function addWalkable(walkable: Set<string>, tile: TileCoord, width: number, height: number): void {
  if (tile.x > 0 && tile.x < width - 1 && tile.y > 0 && tile.y < height - 1) {
    walkable.add(key(tile));
  }
}

function perpendicularOffset(value: number, size: number): number {
  return value < size - 2 ? 1 : -1;
}

function distance(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
