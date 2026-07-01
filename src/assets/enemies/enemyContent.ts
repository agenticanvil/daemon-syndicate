import type * as THREE from "three";
import type { EnemyAssetSettings } from "../../assetSettings";
import { createBruteAsset, BRUTE_SETTINGS } from "./brute/bruteAsset";
import { createEliteEnemyAsset, ELITE_ENEMY_SETTINGS } from "./eliteEnemy/eliteEnemyAsset";
import { loadLeanHunterRig, LEAN_HUNTER_SETTINGS } from "./leanHunter/leanHunterAsset";
import { createVenomSpitterAsset, VENOM_SPITTER_SETTINGS } from "./venomSpitter/venomSpitterAsset";

export type EnemyAssetAnimation = "idle" | "walk" | "melee" | "death";

export type EnemyAsset = {
  root: THREE.Group;
  applyBasePose: () => void;
  update: (state: { animation: EnemyAssetAnimation }, dt: number) => void;
  skeleton?: THREE.Skeleton;
};

export type EnemyContentDefinition<K extends string = string, A extends string = string> = {
  kind: K;
  assetId: A;
  label: string;
  previewColor: THREE.ColorRepresentation;
  settings: EnemyAssetSettings;
  createAsset: (loader: THREE.TextureLoader, anisotropy: number) => EnemyAsset;
};

export const ENEMY_CONTENT = [
  {
    kind: "leanHunter",
    assetId: "lean-hunter",
    label: "Lean Hunter",
    previewColor: 0xff5a8a,
    settings: LEAN_HUNTER_SETTINGS,
    createAsset: loadLeanHunterRig,
  },
  {
    kind: "venomSpitter",
    assetId: "venom-spitter",
    label: "Venom Spitter",
    previewColor: 0x8dff38,
    settings: VENOM_SPITTER_SETTINGS,
    createAsset: createVenomSpitterAsset,
  },
  {
    kind: "elite",
    assetId: "elite-enemy",
    label: "Elite Hunter",
    previewColor: 0xff3434,
    settings: ELITE_ENEMY_SETTINGS,
    createAsset: createEliteEnemyAsset,
  },
  {
    kind: "brute",
    assetId: "brute",
    label: "Brute",
    previewColor: 0x86ff52,
    settings: BRUTE_SETTINGS,
    createAsset: createBruteAsset,
  },
] as const satisfies readonly EnemyContentDefinition[];

export type EnemyContent = (typeof ENEMY_CONTENT)[number];
export type EnemyKind = EnemyContent["kind"];
export type EnemyAssetId = EnemyContent["assetId"];

const CONTENT_BY_KIND = new Map(ENEMY_CONTENT.map((content) => [content.kind, content])) as ReadonlyMap<
  EnemyKind,
  EnemyContent
>;
const CONTENT_BY_ASSET_ID = new Map(ENEMY_CONTENT.map((content) => [content.assetId, content])) as ReadonlyMap<
  EnemyAssetId,
  EnemyContent
>;

export const ENEMY_ASSET_IDS = ENEMY_CONTENT.map((content) => content.assetId) as EnemyAssetId[];

export function enemyContentFor(kind: EnemyKind): EnemyContent {
  const content = CONTENT_BY_KIND.get(kind);
  if (!content) throw new Error(`Missing enemy content: ${kind}`);
  return content;
}

export function enemyContentForAssetId(assetId: string): EnemyContent | undefined {
  return CONTENT_BY_ASSET_ID.get(assetId as EnemyAssetId);
}

export function isEnemyAssetId(value: string | null | undefined): value is EnemyAssetId {
  return typeof value === "string" && CONTENT_BY_ASSET_ID.has(value as EnemyAssetId);
}
