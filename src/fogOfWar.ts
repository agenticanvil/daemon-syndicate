import type * as THREE from "three";
import { fromKey, key, worldToTile, type LevelData, type TileCoord } from "./level";

const VISION_RADIUS_TILES = 6.25;
const VISION_RADIUS_SQ = VISION_RADIUS_TILES * VISION_RADIUS_TILES;

type FogTile = {
  tile: TileCoord;
  explored: boolean;
};

export class FogOfWar {
  private readonly tiles = new Map<string, FogTile>();

  constructor(
    private readonly level: LevelData,
    private readonly onExploredTilesChanged: (exploredKeys: ReadonlySet<string>) => void,
  ) {
    this.buildTiles();
    this.onExploredTilesChanged(this.exploredKeys());
  }

  update(playerPosition: THREE.Vector3, _dt: number, instant = false): void {
    const visibleKeys = this.findVisibleTiles(worldToTile(playerPosition));
    let changed = instant;

    for (const [tileKey, fogTile] of this.tiles) {
      if (!fogTile.explored && visibleKeys.has(tileKey)) {
        fogTile.explored = true;
        changed = true;
      }
    }

    if (changed) {
      this.onExploredTilesChanged(this.exploredKeys());
    }
  }

  dispose(): void {
    this.tiles.clear();
  }

  private buildTiles(): void {
    for (const tileKey of this.level.walkable) {
      this.tiles.set(tileKey, {
        tile: fromKey(tileKey),
        explored: false,
      });
    }
  }

  private exploredKeys(): Set<string> {
    const explored = new Set<string>();
    for (const [tileKey, fogTile] of this.tiles) {
      if (fogTile.explored) explored.add(tileKey);
    }
    return explored;
  }

  private findVisibleTiles(origin: TileCoord): Set<string> {
    const visible = new Set<string>();

    for (const [tileKey, fogTile] of this.tiles) {
      const dx = fogTile.tile.x - origin.x;
      const dy = fogTile.tile.y - origin.y;
      if (dx * dx + dy * dy > VISION_RADIUS_SQ) continue;
      if (this.hasLineOfSight(origin, fogTile.tile)) {
        visible.add(tileKey);
      }
    }

    return visible;
  }

  private hasLineOfSight(origin: TileCoord, target: TileCoord): boolean {
    const targetKey = key(target);
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const stepsX = Math.abs(dx);
    const stepsY = Math.abs(dy);
    if (stepsX === 0 && stepsY === 0) return true;

    const signX = Math.sign(dx);
    const signY = Math.sign(dy);
    let x = origin.x;
    let y = origin.y;

    for (let stepX = 0, stepY = 0; stepX < stepsX || stepY < stepsY; ) {
      const nextXProgress = stepsX === 0 ? Infinity : (stepX + 0.5) / stepsX;
      const nextYProgress = stepsY === 0 ? Infinity : (stepY + 0.5) / stepsY;

      if (nextXProgress === nextYProgress) {
        if (
          this.blocksLineSegment({ x: x + signX, y }, targetKey) ||
          this.blocksLineSegment({ x, y: y + signY }, targetKey)
        ) {
          return false;
        }
        x += signX;
        y += signY;
        stepX += 1;
        stepY += 1;
      } else if (nextXProgress < nextYProgress) {
        x += signX;
        stepX += 1;
      } else {
        y += signY;
        stepY += 1;
      }

      if (this.blocksLineSegment({ x, y }, targetKey)) return false;
    }

    return true;
  }

  private blocksLineSegment(tile: TileCoord, targetKey: string): boolean {
    const tileKey = key(tile);
    return tileKey !== targetKey && this.isSightBlocker(tileKey);
  }

  private isSightBlocker(tileKey: string): boolean {
    return !this.level.walkable.has(tileKey);
  }
}
