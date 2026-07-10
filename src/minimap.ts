import { exitGateTiles, key, type ExitDirection, type LevelData, type TileCoord } from "./level";

export const MINIMAP_VIEW_TILES = 61;
const MINIMAP_REVEAL_RADIUS = 7;

const WALL_DIRECTIONS: Array<{ edge: ExitDirection; dx: number; dy: number }> = [
  { edge: "north", dx: 0, dy: -1 },
  { edge: "east", dx: 1, dy: 0 },
  { edge: "south", dx: 0, dy: 1 },
  { edge: "west", dx: -1, dy: 0 },
];
const WALL_EDGE_CACHE = new WeakMap<LevelData, ReadonlyMap<string, ExitDirection[]>>();

export function revealMinimapTiles(
  level: LevelData,
  center: TileCoord,
  explored: Set<string>,
  radius = MINIMAP_REVEAL_RADIUS,
): void {
  const minX = Math.max(0, Math.floor(center.x - radius));
  const maxX = Math.min(level.width - 1, Math.ceil(center.x + radius));
  const minY = Math.max(0, Math.floor(center.y - radius));
  const maxY = Math.min(level.height - 1, Math.ceil(center.y + radius));
  const radiusSquared = radius * radius;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - center.x;
      const dy = y - center.y;
      const tileKey = key({ x, y });
      if (dx * dx + dy * dy <= radiusSquared && level.walkable.has(tileKey)) {
        explored.add(tileKey);
      }
    }
  }
}

export function minimapWallEdges(level: LevelData, tile: TileCoord): ExitDirection[] {
  let wallsByTile = WALL_EDGE_CACHE.get(level);
  if (!wallsByTile) {
    wallsByTile = buildMinimapWallEdges(level);
    WALL_EDGE_CACHE.set(level, wallsByTile);
  }
  return wallsByTile.get(key(tile)) ?? [];
}

function buildMinimapWallEdges(level: LevelData): ReadonlyMap<string, ExitDirection[]> {
  const exitTiles = new Set(exitGateTiles(level.end, level.exitDirection).map(key));
  const wallsByTile = new Map<string, ExitDirection[]>();
  for (const tileKey of level.walkable) {
    const [x, y] = tileKey.split(",").map(Number);
    const edges = WALL_DIRECTIONS.filter(({ edge, dx, dy }) => {
      const neighborKey = key({ x: x + dx, y: y + dy });
      const isExitOpening = edge === level.exitDirection && exitTiles.has(tileKey);
      return !level.walkable.has(neighborKey) && !isExitOpening;
    }).map(({ edge }) => edge);
    if (edges.length > 0) wallsByTile.set(tileKey, edges);
  }
  return wallsByTile;
}
