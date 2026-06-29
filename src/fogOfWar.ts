import * as THREE from "three";
import { TILE_SIZE } from "./constants";
import { fromKey, key, tileToWorld, worldToTile, type LevelData, type TileCoord } from "./level";

const VISION_RADIUS_TILES = 6.25;
const VISION_RADIUS_SQ = VISION_RADIUS_TILES * VISION_RADIUS_TILES;
const UNEXPLORED_ALPHA = 0.98;
const EXPLORED_ALPHA = 0;
const FOG_DAMPING = 5.8;
const FOG_PLANE_Y = 0.16;
const FOG_EDGE_HEIGHT = 1.05;
const FOG_EDGE_Y = -0.34;
const FOG_TEXTURE_SCALE = 16;
const FOG_EDGE_FEATHER = 4;

const EDGE_DIRECTIONS: TileCoord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

type FogTile = {
  tile: TileCoord;
  edgeMaterial: THREE.MeshBasicMaterial;
  edgeMeshes: THREE.Mesh[];
  explored: boolean;
  alpha: number;
  targetAlpha: number;
};

export class FogOfWar {
  private readonly edgeGeometry = new THREE.PlaneGeometry(TILE_SIZE * 1.1, FOG_EDGE_HEIGHT);
  private readonly topGeometry: THREE.PlaneGeometry;
  private readonly textureCanvas: HTMLCanvasElement;
  private readonly textureContext: CanvasRenderingContext2D;
  private readonly fogTexture: THREE.CanvasTexture;
  private readonly topMaterial: THREE.MeshBasicMaterial;
  private readonly topMesh: THREE.Mesh;
  private readonly tiles = new Map<string, FogTile>();

  constructor(
    private readonly root: THREE.Group,
    private readonly level: LevelData,
  ) {
    const textureWidth = level.width * FOG_TEXTURE_SCALE;
    const textureHeight = level.height * FOG_TEXTURE_SCALE;
    this.textureCanvas = createCanvas(textureWidth, textureHeight);
    this.textureContext = getCanvasContext(this.textureCanvas);
    this.fogTexture = new THREE.CanvasTexture(this.textureCanvas);
    this.fogTexture.magFilter = THREE.LinearFilter;
    this.fogTexture.minFilter = THREE.LinearFilter;
    this.topGeometry = new THREE.PlaneGeometry(level.width * TILE_SIZE, level.height * TILE_SIZE);
    this.topMaterial = new THREE.MeshBasicMaterial({
      alphaMap: this.fogTexture,
      color: 0x000000,
      transparent: true,
      opacity: UNEXPLORED_ALPHA,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.topMesh = new THREE.Mesh(this.topGeometry, this.topMaterial);
    this.topMesh.rotation.x = -Math.PI / 2;
    this.topMesh.position.y = FOG_PLANE_Y;
    this.prepareMesh(this.topMesh);
    this.buildTiles();
    this.redrawFogTexture();
  }

  update(playerPosition: THREE.Vector3, dt: number, instant = false): void {
    const visibleKeys = this.findVisibleTiles(worldToTile(playerPosition));
    let changed = false;

    for (const [tileKey, fogTile] of this.tiles) {
      const wasExplored = fogTile.explored;
      const previousAlpha = fogTile.alpha;
      if (visibleKeys.has(tileKey)) {
        fogTile.explored = true;
      }
      fogTile.targetAlpha = fogTile.explored ? EXPLORED_ALPHA : 1;

      const nextAlpha = instant
        ? fogTile.targetAlpha
        : THREE.MathUtils.damp(fogTile.alpha, fogTile.targetAlpha, FOG_DAMPING, dt);
      fogTile.alpha = Math.abs(nextAlpha - fogTile.targetAlpha) < 0.006 ? fogTile.targetAlpha : nextAlpha;
      changed ||= Math.abs(previousAlpha - fogTile.alpha) > 0.0001 || wasExplored !== fogTile.explored;

      fogTile.edgeMaterial.opacity = fogTile.alpha * UNEXPLORED_ALPHA;
      for (const mesh of fogTile.edgeMeshes) {
        mesh.visible = fogTile.alpha > 0.01;
      }
    }

    if (changed || instant) {
      this.redrawFogTexture();
    }
  }

  dispose(): void {
    this.root.remove(this.topMesh);
    this.topGeometry.dispose();
    this.topMaterial.dispose();
    this.fogTexture.dispose();
    for (const fogTile of this.tiles.values()) {
      for (const mesh of fogTile.edgeMeshes) {
        this.root.remove(mesh);
      }
      fogTile.edgeMaterial.dispose();
    }
    this.edgeGeometry.dispose();
    this.tiles.clear();
  }

  private buildTiles(): void {
    for (const tileKey of this.level.walkable) {
      const tile = fromKey(tileKey);
      const position = tileToWorld(tile);
      const edgeMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: UNEXPLORED_ALPHA,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const edgeMeshes: THREE.Mesh[] = [];

      for (const direction of EDGE_DIRECTIONS) {
        const neighborKey = key({ x: tile.x + direction.x, y: tile.y + direction.y });
        if (this.level.walkable.has(neighborKey)) continue;

        const edgeMesh = new THREE.Mesh(this.edgeGeometry, edgeMaterial);
        edgeMesh.rotation.y = direction.y === 0 ? Math.PI / 2 : 0;
        edgeMesh.position.set(
          position.x + direction.x * TILE_SIZE * 0.5,
          FOG_EDGE_Y,
          position.z + direction.y * TILE_SIZE * 0.5,
        );
        this.prepareMesh(edgeMesh);
        edgeMeshes.push(edgeMesh);
      }

      this.tiles.set(tileKey, {
        tile,
        edgeMaterial,
        edgeMeshes,
        explored: false,
        alpha: 1,
        targetAlpha: 1,
      });
    }
  }

  private redrawFogTexture(): void {
    this.textureContext.clearRect(0, 0, this.textureCanvas.width, this.textureCanvas.height);
    this.textureContext.fillStyle = "black";
    this.textureContext.fillRect(0, 0, this.textureCanvas.width, this.textureCanvas.height);
    for (const fogTile of this.tiles.values()) {
      if (fogTile.alpha <= 0.01) continue;
      this.textureContext.fillStyle = alphaColor(fogTile.alpha);
      this.textureContext.fillRect(
        fogTile.tile.x * FOG_TEXTURE_SCALE,
        fogTile.tile.y * FOG_TEXTURE_SCALE,
        FOG_TEXTURE_SCALE,
        FOG_TEXTURE_SCALE,
      );
    }

    for (const fogTile of this.tiles.values()) {
      if (fogTile.alpha <= 0.01) continue;
      this.drawExploredEdgeFeathers(fogTile);
    }

    this.fogTexture.needsUpdate = true;
  }

  private drawExploredEdgeFeathers(fogTile: FogTile): void {
    const x = fogTile.tile.x * FOG_TEXTURE_SCALE;
    const y = fogTile.tile.y * FOG_TEXTURE_SCALE;
    const currentColor = alphaColor(fogTile.alpha);

    for (const direction of EDGE_DIRECTIONS) {
      const neighbor = this.tiles.get(key({ x: fogTile.tile.x + direction.x, y: fogTile.tile.y + direction.y }));
      if (!neighbor || neighbor.alpha >= fogTile.alpha - 0.01) continue;

      const neighborColor = alphaColor(neighbor.alpha);
      if (direction.x > 0) {
        const gradient = this.textureContext.createLinearGradient(
          x + FOG_TEXTURE_SCALE - FOG_EDGE_FEATHER,
          y,
          x + FOG_TEXTURE_SCALE,
          y,
        );
        gradient.addColorStop(0, currentColor);
        gradient.addColorStop(1, neighborColor);
        this.textureContext.fillStyle = gradient;
        this.textureContext.fillRect(x + FOG_TEXTURE_SCALE - FOG_EDGE_FEATHER, y, FOG_EDGE_FEATHER, FOG_TEXTURE_SCALE);
      } else if (direction.x < 0) {
        const gradient = this.textureContext.createLinearGradient(x, y, x + FOG_EDGE_FEATHER, y);
        gradient.addColorStop(0, neighborColor);
        gradient.addColorStop(1, currentColor);
        this.textureContext.fillStyle = gradient;
        this.textureContext.fillRect(x, y, FOG_EDGE_FEATHER, FOG_TEXTURE_SCALE);
      } else if (direction.y > 0) {
        const gradient = this.textureContext.createLinearGradient(
          x,
          y + FOG_TEXTURE_SCALE - FOG_EDGE_FEATHER,
          x,
          y + FOG_TEXTURE_SCALE,
        );
        gradient.addColorStop(0, currentColor);
        gradient.addColorStop(1, neighborColor);
        this.textureContext.fillStyle = gradient;
        this.textureContext.fillRect(x, y + FOG_TEXTURE_SCALE - FOG_EDGE_FEATHER, FOG_TEXTURE_SCALE, FOG_EDGE_FEATHER);
      } else {
        const gradient = this.textureContext.createLinearGradient(x, y, x, y + FOG_EDGE_FEATHER);
        gradient.addColorStop(0, neighborColor);
        gradient.addColorStop(1, currentColor);
        this.textureContext.fillStyle = gradient;
        this.textureContext.fillRect(x, y, FOG_TEXTURE_SCALE, FOG_EDGE_FEATHER);
      }
    }
  }

  private prepareMesh(mesh: THREE.Mesh): void {
    mesh.renderOrder = 20;
    mesh.frustumCulled = false;
    this.root.add(mesh);
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
    const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2;
    if (steps === 0) return true;

    let previousKey = key(origin);
    for (let step = 1; step <= steps; step += 1) {
      const sample: TileCoord = {
        x: Math.round(origin.x + (dx * step) / steps),
        y: Math.round(origin.y + (dy * step) / steps),
      };
      const sampleKey = key(sample);
      if (sampleKey === previousKey) continue;
      if (sampleKey === targetKey) return true;
      if (this.isSightBlocker(sampleKey)) return false;
      previousKey = sampleKey;
    }

    return true;
  }

  private isSightBlocker(tileKey: string): boolean {
    return !this.level.walkable.has(tileKey) || this.level.blocked.has(tileKey);
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function alphaColor(alpha: number): string {
  const value = Math.round(THREE.MathUtils.clamp(alpha, 0, 1) * 255);
  return `rgb(${value}, ${value}, ${value})`;
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create fog of war canvas context");
  }
  return context;
}
