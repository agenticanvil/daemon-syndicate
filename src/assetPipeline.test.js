import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultSidecar,
  discoverPublicAssets,
  normalizeAssetSidecar,
  parseAssetEndpointPath,
  validatePublicAssets,
} from "../vite.config.mjs";

const tempRoots = [];

describe("public asset sidecar pipeline", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("rejects unsafe asset endpoint paths", () => {
    expect(parseAssetEndpointPath("environment/industrial-crate")).toEqual({
      category: "environment",
      name: "industrial-crate",
      staged: false,
    });
    expect(parseAssetEndpointPath("_staged/environment/industrial-crate")).toEqual({
      category: "environment",
      name: "industrial-crate",
      staged: true,
    });
    expect(parseAssetEndpointPath("environment/../crate")).toBeNull();
    expect(parseAssetEndpointPath("environment/industrial_crate")).toBeNull();
    expect(parseAssetEndpointPath("sfx/ui-click")).toBeNull();
  });

  it("discovers live and staged GLBs and ignores folders without paired GLBs", async () => {
    const root = await createProjectRoot();
    await writeProjectFile(root, "public/assets/environment/industrial-crate/industrial-crate.glb", "glTF");
    await writeProjectFile(root, "public/assets/environment/no-model/nope.txt", "");
    await writeProjectFile(root, "public/assets/_staged/pickups/health-pickup/health-pickup.glb", "glTF");

    const assets = await discoverPublicAssets(root);

    expect(assets.map((asset) => `${asset.staged ? "_staged/" : ""}${asset.category}/${asset.name}`)).toEqual([
      "environment/industrial-crate",
      "_staged/pickups/health-pickup",
    ]);
    expect(assets[0].modelUrl).toBe("/assets/environment/industrial-crate/industrial-crate.glb");
    expect(assets[1].modelUrl).toBe("/assets/_staged/pickups/health-pickup/health-pickup.glb");
  });

  it("seeds sidecars from legacy settings while dropping collision height", async () => {
    const root = await createProjectRoot();
    await writeProjectFile(root, "src/assets/enemies/leanHunter/leanHunter.settings.json", JSON.stringify(legacyEnemySettings()));

    const sidecar = await createDefaultSidecar(root, {
      category: "enemies",
      name: "lean-hunter",
      staged: false,
    });

    expect(sidecar).toMatchObject({
      schemaVersion: 1,
      id: "lean-hunter",
      category: "enemies",
      label: "Lean Hunter",
      kind: "enemy",
      model: { file: "lean-hunter.glb" },
      collision: { type: "circle", radius: 0.7 },
      gameplay: legacyEnemySettings().gameplay,
      health: legacyEnemySettings().health,
      movement: legacyEnemySettings().movement,
      spawnWeight: legacyEnemySettings().spawnWeight,
      attacks: legacyEnemySettings().attacks,
      dropTable: legacyEnemySettings().dropTable,
    });
    expect(sidecar.collision.height).toBeUndefined();
  });

  it("round-trips supported sidecar fields and enforces paired model names", () => {
    const settings = {
      ...legacyEnemySettings(),
      schemaVersion: 1,
      id: "venom-spitter",
      category: "enemies",
      label: "Venom Spitter",
      model: { file: "venom-spitter.glb", scale: 1.25 },
      preview: { defaultAnimation: "walk" },
      collision: { type: "circle", radius: 0.68 },
    };

    const normalized = normalizeAssetSidecar(settings, {
      category: "enemies",
      name: "venom-spitter",
      staged: false,
    });

    expect(normalized.gameplay).toEqual(settings.gameplay);
    expect(normalized.attacks[0]).toMatchObject({
      kind: "ranged",
      projectileSpeed: 9.5,
      projectileRadius: 0.24,
      windup: 0.28,
    });
    expect(() =>
      normalizeAssetSidecar(
        { ...settings, model: { file: "other.glb" } },
        { category: "enemies", name: "venom-spitter", staged: false },
      ),
    ).toThrow("model.file must be venom-spitter.glb");
  });

  it("reports missing sidecars and non-standard enemy animation names", async () => {
    const root = await createProjectRoot();
    await writeProjectFile(root, "public/assets/enemies/lean-hunter/lean-hunter.glb", "glTF");
    await writeProjectFile(
      root,
      "public/assets/enemies/lean-hunter/lean-hunter.asset.json",
      JSON.stringify({
        ...legacyEnemySettings(),
        schemaVersion: 1,
        id: "lean-hunter",
        category: "enemies",
        label: "Lean Hunter",
        model: { file: "lean-hunter.glb" },
        preview: { defaultAnimation: "lunge" },
        collision: { type: "circle", radius: 0.7 },
      }),
    );
    await writeProjectFile(root, "public/assets/pickups/ammo-pickup/ammo-pickup.glb", "glTF");

    const report = await validatePublicAssets(root);

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual({
      severity: "warning",
      asset: "enemies/lean-hunter",
      message: "Non-standard default animation name",
    });
    expect(report.issues).toContainEqual({
      severity: "error",
      asset: "pickups/ammo-pickup",
      message: "Missing sidecar JSON",
    });
  });
});

async function createProjectRoot() {
  const root = await mkdtemp(join(tmpdir(), "daemon-assets-"));
  tempRoots.push(root);
  return root;
}

async function writeProjectFile(root, relativePath, content) {
  const filePath = join(root, relativePath);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content);
}

function legacyEnemySettings() {
  return {
    kind: "enemy",
    gameplay: {
      unlockMapDepth: 2,
      budgetCost: 1.35,
      attackDamageLevelGrowth: 2,
      xpReward: { base: 10, levelGrowth: 2.2 },
    },
    collision: { radius: 0.7, height: 1.1 },
    health: { base: 58, levelGrowth: 14 },
    movement: { speed: 2.35, levelSpeedGrowth: 0.05 },
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
      ],
    },
  };
}
