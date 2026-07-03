import type * as THREE from "three";
import type { EnemyAssetSettings } from "./assetSettings";

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
};

export const ENEMY_CONTENT = [
  {
    kind: "leanHunter",
    assetId: "lean-hunter",
    label: "Lean Hunter",
    previewColor: 0xff5a8a,
    settings: {
      kind: "enemy",
      gameplay: {
        unlockMapDepth: 1,
        budgetCost: 1,
        attackDamageLevelGrowth: 3,
        xpReward: { base: 6, levelGrowth: 1.5 },
      },
      collision: { radius: 0.7, height: 1.1 },
      health: { base: 70, levelGrowth: 18 },
      movement: { speed: 2.8, levelSpeedGrowth: 0.07, sound: "hunter-moving" },
      spawnWeight: { base: 0.92, levelGrowth: -0.015, min: 0.74 },
      attacks: [{ kind: "melee", damage: 9, cooldown: 0.72, range: 0.42 }],
      dropTable: {
        chance: 0.72,
        entries: [
          { kind: "health", weight: 14, amount: 24 },
          { kind: "ammo", weight: 34, amount: 22 },
          { kind: "energy", weight: 24, amount: 32 },
        ],
      },
    },
  },
  {
    kind: "venomSpitter",
    assetId: "venom-spitter",
    label: "Venom Spitter",
    previewColor: 0x8dff38,
    settings: {
      kind: "enemy",
      gameplay: {
        unlockMapDepth: 2,
        budgetCost: 1.35,
        attackDamageLevelGrowth: 2,
        xpReward: { base: 10, levelGrowth: 2.2 },
      },
      collision: { radius: 0.68, height: 1.1 },
      health: { base: 58, levelGrowth: 14 },
      movement: { speed: 2.35, levelSpeedGrowth: 0.05, sound: "hunter-moving" },
      spawnWeight: { base: 0.22, levelGrowth: 0.018, max: 0.38 },
      attacks: [
        {
          kind: "ranged",
          damage: 7,
          cooldown: 1.35,
          range: 8.6,
          projectileSpeed: 9.5,
          projectileRadius: 0.24,
          windup: 0.28,
        },
      ],
      dropTable: {
        chance: 0.74,
        entries: [
          { kind: "health", weight: 10, amount: 22 },
          { kind: "ammo", weight: 38, amount: 24 },
          { kind: "energy", weight: 28, amount: 34 },
        ],
      },
    },
  },
  {
    kind: "elite",
    assetId: "elite-enemy",
    label: "Elite Hunter",
    previewColor: 0xff3434,
    settings: {
      kind: "enemy",
      gameplay: {
        unlockMapDepth: 3,
        budgetCost: 2.4,
        attackDamageLevelGrowth: 4,
        xpReward: { base: 14, levelGrowth: 3 },
      },
      collision: { radius: 0.7, height: 1.1 },
      health: { base: 118, levelGrowth: 36 },
      movement: { speed: 3.5, levelSpeedGrowth: 0.05, sound: "hunter-moving" },
      spawnWeight: { base: 0.08, levelGrowth: 0.015, max: 0.26 },
      attacks: [{ kind: "melee", damage: 9, cooldown: 0.72, range: 0.42 }],
      dropTable: {
        chance: 0.72,
        entries: [
          { kind: "health", weight: 14, amount: 24 },
          { kind: "ammo", weight: 34, amount: 22 },
          { kind: "energy", weight: 24, amount: 32 },
        ],
      },
    },
  },
  {
    kind: "brute",
    assetId: "brute",
    label: "Brute",
    previewColor: 0x86ff52,
    settings: {
      kind: "enemy",
      gameplay: {
        unlockMapDepth: 5,
        budgetCost: 3.4,
        attackDamageLevelGrowth: 6,
        xpReward: { base: 24, levelGrowth: 4.2 },
      },
      collision: { radius: 0.92, height: 1.72 },
      health: { base: 185, levelGrowth: 42 },
      movement: { speed: 1.82, levelSpeedGrowth: 0.035 },
      spawnWeight: { base: 0.045, levelGrowth: 0.012, max: 0.16 },
      attacks: [{ kind: "melee", damage: 18, cooldown: 1.16, range: 0.76 }],
      dropTable: {
        chance: 0.82,
        entries: [
          { kind: "health", weight: 18, amount: 34 },
          { kind: "ammo", weight: 30, amount: 26 },
          { kind: "energy", weight: 34, amount: 46 },
        ],
      },
    },
  },
] as const satisfies readonly EnemyContentDefinition[];

export type EnemyContent = (typeof ENEMY_CONTENT)[number];
export type EnemyKind = EnemyContent["kind"];

const CONTENT_BY_KIND = new Map(ENEMY_CONTENT.map((content) => [content.kind, content])) as ReadonlyMap<
  EnemyKind,
  EnemyContent
>;

export function enemyContentFor(kind: EnemyKind): EnemyContent {
  const content = CONTENT_BY_KIND.get(kind);
  if (!content) throw new Error(`Missing enemy content: ${kind}`);
  return content;
}
