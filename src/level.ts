import * as THREE from "three";
import { LEVEL_HEIGHT, LEVEL_WIDTH, TILE_SIZE } from "./constants";
import type { EnvironmentAssetKind } from "./assetFactory";
import { chooseFloorVariant, type FloorVariantId } from "./floorVariants";
import type { Rng } from "./rng";

export type TileCoord = {
  x: number;
  y: number;
};

export type ExitDirection = "north" | "east" | "south" | "west";

type EnvironmentalObject = {
  kind: EnvironmentAssetKind;
  tile: TileCoord;
  rotation: number;
};

export type LevelData = {
  mapDepth: number;
  width: number;
  height: number;
  exitDirection: ExitDirection;
  start: TileCoord;
  end: TileCoord;
  walkable: Set<string>;
  floorVariants?: ReadonlyMap<string, FloorVariantId>;
  blocked: Set<string>;
  environmentalObjects: EnvironmentalObject[];
  spawnPoints: TileCoord[];
};

type LevelRoute = {
  exitDirection: ExitDirection;
  start: TileCoord;
  end: TileCoord;
};

const CARDINALS: TileCoord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const DIAGONALS: TileCoord[] = [
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

export function generateLevel(mapDepth: number, rng: Rng = Math.random): LevelData {
  const width = LEVEL_WIDTH;
  const height = LEVEL_HEIGHT;
  const { exitDirection, start, end } = chooseLevelRoute(width, height, rng);
  const path = buildMainPath(start, end, exitDirection, width, height, rng);
  const walkable = new Set<string>();

  carveRoom(walkable, path[0], width, height, 1);
  for (let i = 1; i < path.length; i += 1) {
    carveCorridor(walkable, path[i - 1], path[i], width, height);
  }

  const branchCount = 14 + Math.min(Math.floor(mapDepth / 2), 10);
  for (let i = 0; i < branchCount; i += 1) {
    const anchor = path[3 + Math.floor(rng() * Math.max(path.length - 6, 1))];
    carveBranch(walkable, anchor, width, height, 7 + Math.floor(rng() * 10), rng);
  }
  carveDeadEndAlcoves(walkable, width, height, 10 + Math.min(mapDepth, 8), rng);

  carveRoom(walkable, start, width, height, 2);
  carveRoom(walkable, end, width, height, 1);
  walkable.add(key(start));
  walkable.add(key(end));
  normalizePlatformSpacing(walkable, width, height);

  const blocked = new Set<string>();
  const environmentalObjects = placeEnvironmentalObjects(walkable, blocked, start, end, rng);

  const spawnPoints = [...walkable]
    .map(fromKey)
    .filter((tile) => !blocked.has(key(tile)) && distance(tile, start) > 6 && distance(tile, end) > 3);
  const floorVariants = assignFloorVariants(walkable, rng);

  return {
    mapDepth,
    width,
    height,
    exitDirection,
    start,
    end,
    walkable,
    floorVariants,
    blocked,
    environmentalObjects,
    spawnPoints,
  };
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
  switch (direction) {
    case "east":
      position.x += TILE_SIZE * 0.5;
      break;
    case "west":
      position.x -= TILE_SIZE * 0.5;
      break;
    case "south":
      position.z += TILE_SIZE * 0.5;
      break;
    case "north":
      position.z -= TILE_SIZE * 0.5;
      break;
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
  return isTileWalkable(level, worldToTile(position));
}

export function isTileWalkable(level: LevelData, tile: TileCoord): boolean {
  const tileKey = key(tile);
  return level.walkable.has(tileKey) && !level.blocked.has(tileKey);
}

export function neighbors(tile: TileCoord): TileCoord[] {
  return CARDINALS.map((dir) => ({ x: tile.x + dir.x, y: tile.y + dir.y }));
}

function chooseLevelRoute(width: number, height: number, rng: Rng): LevelRoute {
  const startCorners = [
    { x: 3, y: 3 },
    { x: width - 4, y: 3 },
    { x: width - 4, y: height - 4 },
    { x: 3, y: height - 4 },
  ];
  const start = startCorners[Math.floor(rng() * startCorners.length)];
  const exitDirections = farExitDirections(start, width, height);
  const exitDirection = exitDirections[Math.floor(rng() * exitDirections.length)];

  return {
    exitDirection,
    start,
    end: chooseExitTile(exitDirection, width, height, rng),
  };
}

function farExitDirections(start: TileCoord, width: number, height: number): ExitDirection[] {
  const directions: ExitDirection[] = [];
  if (start.y >= height / 2) directions.push("north");
  if (start.y < height / 2) directions.push("south");
  if (start.x >= width / 2) directions.push("west");
  if (start.x < width / 2) directions.push("east");
  return directions;
}

function chooseExitTile(direction: ExitDirection, width: number, height: number, rng: Rng): TileCoord {
  switch (direction) {
    case "north":
      return { x: randomEdgeCoordinate(width, rng), y: 1 };
    case "south":
      return { x: randomEdgeCoordinate(width, rng), y: height - 2 };
    case "west":
      return { x: 1, y: randomEdgeCoordinate(height, rng) };
    case "east":
      return { x: width - 2, y: randomEdgeCoordinate(height, rng) };
  }
}

function randomEdgeCoordinate(size: number, rng: Rng): number {
  return 4 + Math.floor(rng() * Math.max(size - 8, 1));
}

function buildMainPath(
  start: TileCoord,
  end: TileCoord,
  exitDirection: ExitDirection,
  width: number,
  height: number,
  rng: Rng,
): TileCoord[] {
  const path: TileCoord[] = [{ ...start }];
  const current = { ...start };
  let guard = 0;

  while ((current.x !== end.x || current.y !== end.y) && guard < width * height) {
    guard += 1;
    const options = pathStepOptions(current, end, width, height, rng);

    const preferred =
      exitDirection === "east" || exitDirection === "west"
        ? options.sort((a, b) => Math.abs(a.x - end.x) - Math.abs(b.x - end.x))
        : options.sort((a, b) => Math.abs(a.y - end.y) - Math.abs(b.y - end.y));
    const next = preferred[Math.floor(rng() * Math.min(preferred.length, 3))] ?? end;
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

function pathStepOptions(current: TileCoord, end: TileCoord, width: number, height: number, rng: Rng): TileCoord[] {
  const options: TileCoord[] = [];
  const xStep = Math.sign(end.x - current.x);
  const yStep = Math.sign(end.y - current.y);
  const currentDistance = distance(current, end);

  if (xStep !== 0) options.push({ x: current.x + xStep, y: current.y });
  if (yStep !== 0) options.push({ x: current.x, y: current.y + yStep });

  for (const direction of shuffle([...CARDINALS], rng)) {
    if (rng() >= 0.34) continue;
    const tile = { x: current.x + direction.x, y: current.y + direction.y };
    if (tile.x < 2 || tile.x > width - 3 || tile.y < 2 || tile.y > height - 3) continue;
    if (distance(tile, end) > currentDistance + 3) continue;
    if (!options.some((option) => option.x === tile.x && option.y === tile.y)) {
      options.push(tile);
    }
  }

  return options;
}

function carveBranch(
  walkable: Set<string>,
  anchor: TileCoord,
  width: number,
  height: number,
  length: number,
  rng: Rng,
): void {
  const current = { ...anchor };
  let dir = CARDINALS[Math.floor(rng() * CARDINALS.length)];
  for (let i = 0; i < length; i += 1) {
    if (rng() < 0.42) {
      dir = turnDirection(dir, rng);
    }

    const previous = { ...current };
    const step = chooseBranchStep(walkable, current, previous, dir, width, height, rng);
    if (!step) break;

    dir = step.direction;
    current.x = step.tile.x;
    current.y = step.tile.y;
    carveCorridor(walkable, previous, current, width, height);

    if (rng() < 0.45 && i > 1) {
      carveDeadEndOffshoot(walkable, current, dir, width, height, 2 + Math.floor(rng() * 5), rng);
    }

    if (rng() < 0.1) {
      carveRoom(walkable, current, width, height, 1);
    }
  }
}

function carveDeadEndOffshoot(
  walkable: Set<string>,
  anchor: TileCoord,
  mainDirection: TileCoord,
  width: number,
  height: number,
  length: number,
  rng: Rng,
): void {
  const current = { ...anchor };
  let dir = turnDirection(mainDirection, rng);

  for (let i = 0; i < length; i += 1) {
    if (rng() < 0.24) {
      dir = turnDirection(dir, rng);
    }

    const previous = { ...current };
    const step = chooseBranchStep(walkable, current, previous, dir, width, height, rng);
    if (!step) break;

    dir = step.direction;
    current.x = step.tile.x;
    current.y = step.tile.y;
    carveCorridor(walkable, previous, current, width, height);
  }
}

function carveDeadEndAlcoves(
  walkable: Set<string>,
  width: number,
  height: number,
  targetCount: number,
  rng: Rng,
): void {
  let carved = 0;
  const anchors = shuffle([...walkable].map(fromKey), rng);

  for (const anchor of anchors) {
    if (carved >= targetCount) break;

    for (const direction of shuffle([...CARDINALS], rng)) {
      if (carved >= targetCount) break;

      const first = nextBranchTile(anchor, direction, width, height);
      if (walkable.has(key(first)) || walkableNeighborCountExcept(walkable, first, anchor) > 0) continue;

      let previous = anchor;
      let current = first;
      const length = 2 + Math.floor(rng() * 4);
      for (let step = 0; step < length; step += 1) {
        carveCorridor(walkable, previous, current, width, height);

        const next = nextBranchTile(current, direction, width, height);
        if (walkable.has(key(next)) || walkableNeighborCountExcept(walkable, next, current) > 0) break;

        previous = current;
        current = next;
      }

      carved += 1;
    }
  }
}

function chooseBranchStep(
  walkable: Set<string>,
  current: TileCoord,
  previous: TileCoord,
  preferredDirection: TileCoord,
  width: number,
  height: number,
  rng: Rng,
): { tile: TileCoord; direction: TileCoord } | undefined {
  const directions = [
    preferredDirection,
    ...shuffle(CARDINALS.filter((direction) => direction !== preferredDirection), rng),
  ];

  for (const direction of directions) {
    const tile = nextBranchTile(current, direction, width, height);
    if (tile.x === current.x && tile.y === current.y) continue;
    if (walkable.has(key(tile))) continue;
    if (walkableNeighborCountExcept(walkable, tile, previous) > 0) continue;
    return { tile, direction };
  }

  return undefined;
}

function nextBranchTile(tile: TileCoord, direction: TileCoord, width: number, height: number): TileCoord {
  return {
    x: THREE.MathUtils.clamp(tile.x + direction.x, 2, width - 3),
    y: THREE.MathUtils.clamp(tile.y + direction.y, 2, height - 3),
  };
}

function turnDirection(direction: TileCoord, rng: Rng): TileCoord {
  const turns =
    direction.x !== 0
      ? [
          { x: 0, y: 1 },
          { x: 0, y: -1 },
        ]
      : [
          { x: 1, y: 0 },
          { x: -1, y: 0 },
        ];

  return turns[Math.floor(rng() * turns.length)];
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

function normalizePlatformSpacing(walkable: Set<string>, width: number, height: number): void {
  let changed = true;

  while (changed) {
    changed = false;

    for (const tile of [...walkable].map(fromKey)) {
      if (!hasHorizontalNeighbor(walkable, tile)) {
        const xOffset = perpendicularOffset(tile.x, width);
        const before = walkable.size;
        addWalkable(walkable, { x: tile.x + xOffset, y: tile.y }, width, height);
        changed ||= walkable.size !== before;
      }

      if (!hasVerticalNeighbor(walkable, tile)) {
        const yOffset = perpendicularOffset(tile.y, height);
        const before = walkable.size;
        addWalkable(walkable, { x: tile.x, y: tile.y + yOffset }, width, height);
        changed ||= walkable.size !== before;
      }
    }

    for (const tile of [...walkable].map(fromKey)) {
      for (const diagonal of DIAGONALS) {
        const other = { x: tile.x + diagonal.x, y: tile.y + diagonal.y };
        if (!walkable.has(key(other))) continue;

        const firstBridge = { x: tile.x + diagonal.x, y: tile.y };
        const secondBridge = { x: tile.x, y: tile.y + diagonal.y };
        if (walkable.has(key(firstBridge)) || walkable.has(key(secondBridge))) continue;

        const before = walkable.size;
        addWalkable(walkable, firstBridge, width, height);
        changed ||= walkable.size !== before;
      }
    }
  }
}

function hasHorizontalNeighbor(walkable: Set<string>, tile: TileCoord): boolean {
  return walkable.has(key({ x: tile.x - 1, y: tile.y })) || walkable.has(key({ x: tile.x + 1, y: tile.y }));
}

function hasVerticalNeighbor(walkable: Set<string>, tile: TileCoord): boolean {
  return walkable.has(key({ x: tile.x, y: tile.y - 1 })) || walkable.has(key({ x: tile.x, y: tile.y + 1 }));
}

function addWalkable(walkable: Set<string>, tile: TileCoord, width: number, height: number): void {
  if (tile.x > 0 && tile.x < width - 1 && tile.y > 0 && tile.y < height - 1) {
    walkable.add(key(tile));
  }
}

function placeEnvironmentalObjects(
  walkable: Set<string>,
  blocked: Set<string>,
  start: TileCoord,
  end: TileCoord,
  rng: Rng,
): EnvironmentalObject[] {
  const targetCount = 2 + Math.floor(rng() * 2);
  const candidates = shuffle(
    [...walkable]
      .map(fromKey)
      .filter((tile) => distance(tile, start) > 4 && distance(tile, end) > 3 && walkableNeighborCount(walkable, tile) >= 2),
    rng,
  );
  const objects: EnvironmentalObject[] = [];

  for (const tile of candidates) {
    if (objects.length >= targetCount) break;
    const tileKey = key(tile);
    if (blocked.has(tileKey)) continue;
    blocked.add(tileKey);
    if (!isConnectedAfterBlocking(walkable, blocked, start)) {
      blocked.delete(tileKey);
      continue;
    }

    objects.push({
      kind: "industrial-crate",
      tile,
      rotation: Math.floor(rng() * 4) * (Math.PI / 2),
    });
  }

  return objects;
}

function assignFloorVariants(walkable: Set<string>, rng: Rng): ReadonlyMap<string, FloorVariantId> {
  return new Map([...walkable].map((tileKey) => [tileKey, chooseFloorVariant(rng)]));
}

function isConnectedAfterBlocking(walkable: Set<string>, blocked: Set<string>, start: TileCoord): boolean {
  const startKey = key(start);
  if (!walkable.has(startKey) || blocked.has(startKey)) return false;

  const openCount = [...walkable].filter((tileKey) => !blocked.has(tileKey)).length;
  const queue = [startKey];
  const visited = new Set<string>(queue);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const neighbor of neighbors(fromKey(queue[cursor]))) {
      const neighborKey = key(neighbor);
      if (!walkable.has(neighborKey) || blocked.has(neighborKey) || visited.has(neighborKey)) continue;
      visited.add(neighborKey);
      queue.push(neighborKey);
    }
  }

  return visited.size === openCount;
}

function walkableNeighborCount(walkable: Set<string>, tile: TileCoord): number {
  return neighbors(tile).filter((neighbor) => walkable.has(key(neighbor))).length;
}

function walkableNeighborCountExcept(walkable: Set<string>, tile: TileCoord, except: TileCoord): number {
  const exceptKey = key(except);
  return neighbors(tile).filter((neighbor) => {
    const neighborKey = key(neighbor);
    return neighborKey !== exceptKey && walkable.has(neighborKey);
  }).length;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function perpendicularOffset(value: number, size: number): number {
  return value < size - 2 ? 1 : -1;
}

function distance(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
