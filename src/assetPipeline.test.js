import { mkdtemp, mkdir, readFile, writeFile, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultSidecar,
  discoverPublicAssets,
  normalizeAssetSidecar,
  parseAssetEndpointPath,
  promoteStagedAssets,
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
    expect(assets[1].liveModelExists).toBe(false);
    expect(assets[1].liveSidecarExists).toBe(false);
  });

  it("reports whether staged model assets already have a live GLB and sidecar", async () => {
    const root = await createProjectRoot();
    await writeProjectFile(root, "public/assets/_staged/environment/industrial-crate/industrial-crate.glb", "glTF");
    await writeProjectFile(root, "public/assets/_staged/environment/industrial-crate/industrial-crate.asset.json", JSON.stringify(environmentSidecar()));
    await writeProjectFile(root, "public/assets/environment/industrial-crate/industrial-crate.glb", "glTF");
    await writeProjectFile(root, "public/assets/environment/industrial-crate/industrial-crate.asset.json", JSON.stringify(environmentSidecar()));

    const staged = (await discoverPublicAssets(root)).find((asset) => asset.staged);

    expect(staged).toMatchObject({
      category: "environment",
      name: "industrial-crate",
      liveModelExists: true,
      liveSidecarExists: true,
      modelComparison: { status: "current" },
      sidecarComparison: { status: "current" },
    });
  });

  it("reports newer staged models and changed staged gameplay sidecars", async () => {
    const root = await createProjectRoot();
    const liveUpdatedAt = new Date("2026-01-01T00:00:00.000Z");
    const stagedUpdatedAt = new Date("2026-01-02T00:00:00.000Z");
    await writeProjectFile(root, "public/assets/environment/industrial-crate/industrial-crate.glb", "old-glb");
    await writeProjectFile(root, "public/assets/environment/industrial-crate/industrial-crate.asset.json", JSON.stringify(environmentSidecar({ radius: 0.6 })));
    await writeProjectFile(root, "public/assets/_staged/environment/industrial-crate/industrial-crate.glb", "new-glb");
    await writeProjectFile(
      root,
      "public/assets/_staged/environment/industrial-crate/industrial-crate.asset.json",
      JSON.stringify(environmentSidecar({ radius: 0.72 })),
    );
    await touchProjectFile(root, "public/assets/environment/industrial-crate/industrial-crate.glb", liveUpdatedAt);
    await touchProjectFile(root, "public/assets/environment/industrial-crate/industrial-crate.asset.json", liveUpdatedAt);
    await touchProjectFile(root, "public/assets/_staged/environment/industrial-crate/industrial-crate.glb", stagedUpdatedAt);
    await touchProjectFile(root, "public/assets/_staged/environment/industrial-crate/industrial-crate.asset.json", stagedUpdatedAt);

    const staged = (await discoverPublicAssets(root)).find((asset) => asset.staged);

    expect(staged).toMatchObject({
      category: "environment",
      name: "industrial-crate",
      modelComparison: {
        status: "newer",
        stagedUpdatedAt: stagedUpdatedAt.toISOString(),
        liveUpdatedAt: liveUpdatedAt.toISOString(),
      },
      sidecarComparison: {
        status: "newer",
        stagedUpdatedAt: stagedUpdatedAt.toISOString(),
        liveUpdatedAt: liveUpdatedAt.toISOString(),
      },
    });
  });

  it("promotes valid staged assets without inventing sidecars", async () => {
    const root = await createProjectRoot();
    await writeProjectFile(root, "public/assets/_staged/environment/industrial-crate/industrial-crate.glb", "glTF");
    await writeProjectFile(root, "public/assets/_staged/environment/industrial-crate/industrial-crate.asset.json", JSON.stringify(environmentSidecar()));
    await writeProjectFile(root, "public/assets/_staged/pickups/health-pickup/health-pickup.glb", "glTF");
    await writeProjectFile(root, "public/assets/_staged/environment/exit-portal/exit-portal.glb", "glTF");
    await writeProjectFile(
      root,
      "public/assets/_staged/environment/exit-portal/exit-portal.asset.json",
      JSON.stringify({ ...environmentSidecar(), id: "exit-portal", model: { file: "wrong.glb" } }),
    );

    const report = await promoteStagedAssets(root, { all: true });
    const assets = await discoverPublicAssets(root);
    const liveCrate = assets.find((asset) => !asset.staged && asset.category === "environment" && asset.name === "industrial-crate");
    const liveHealth = assets.find((asset) => !asset.staged && asset.category === "pickups" && asset.name === "health-pickup");
    const stagedExitPortal = assets.find((asset) => asset.staged && asset.category === "environment" && asset.name === "exit-portal");

    expect(report.ok).toBe(false);
    expect(report.promoted).toEqual([{ category: "environment", name: "industrial-crate" }]);
    expect(report.issues).toContainEqual({
      severity: "error",
      asset: "_staged/pickups/health-pickup",
      message: "Staged sidecar must exist before promotion",
    });
    expect(report.issues).toContainEqual({
      severity: "error",
      asset: "_staged/environment/exit-portal",
      message: "model.file must be exit-portal.glb",
    });
    expect(liveCrate?.sidecarExists).toBe(true);
    expect(liveHealth).toBeUndefined();
    expect(stagedExitPortal?.sidecarError).toBe("model.file must be exit-portal.glb");
  });

  it("promotes bundled shader material sidecars and files", async () => {
    const root = await createProjectRoot();
    await writeProjectFile(root, "public/assets/_staged/environment/exit-portal/exit-portal.glb", "glTF");
    await writeProjectFile(
      root,
      "public/assets/_staged/environment/exit-portal/exit-portal.asset.json",
      JSON.stringify({
        ...environmentSidecar(),
        id: "exit-portal",
        label: "Exit Portal",
        model: { file: "exit-portal.glb", scale: 1 },
        materials: [
          {
            id: "portal-field",
            type: "shader",
            mesh: "exit-portal-field",
            definition: "materials/portal-field.json",
          },
        ],
      }),
    );
    await writeProjectFile(
      root,
      "public/assets/_staged/environment/exit-portal/materials/portal-field.json",
      JSON.stringify({
        vertexShader: "portal-field.vert.glsl",
        fragmentShader: "portal-field.frag.glsl",
        uniforms: { uTime: { type: "time" } },
        transparent: true,
      }),
    );
    await writeProjectFile(root, "public/assets/_staged/environment/exit-portal/materials/portal-field.vert.glsl", "void main() {}");
    await writeProjectFile(root, "public/assets/_staged/environment/exit-portal/materials/portal-field.frag.glsl", "void main() {}");

    const report = await promoteStagedAssets(root, { category: "environment", name: "exit-portal" });
    const liveSidecar = JSON.parse(await readFile(join(root, "public/assets/environment/exit-portal/exit-portal.asset.json"), "utf8"));
    const liveMaterialDefinition = JSON.parse(
      await readFile(join(root, "public/assets/environment/exit-portal/materials/portal-field.json"), "utf8"),
    );
    const liveVertexShader = await readFile(join(root, "public/assets/environment/exit-portal/materials/portal-field.vert.glsl"), "utf8");
    const liveFragmentShader = await readFile(join(root, "public/assets/environment/exit-portal/materials/portal-field.frag.glsl"), "utf8");

    expect(report).toMatchObject({ ok: true, promoted: [{ category: "environment", name: "exit-portal" }], issues: [] });
    expect(liveSidecar.materials).toEqual([
      { id: "portal-field", type: "shader", mesh: "exit-portal-field", definition: "materials/portal-field.json" },
    ]);
    expect(liveMaterialDefinition.uniforms.uTime).toEqual({ type: "time" });
    expect(liveVertexShader).toBe("void main() {}");
    expect(liveFragmentShader).toBe("void main() {}");
  });

  it("seeds sidecars from category defaults when no daemon sidecar exists", async () => {
    const root = await createProjectRoot();

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
      gameplay: {
        unlockMapDepth: 1,
        budgetCost: 1,
        attackDamageLevelGrowth: 0,
        xpReward: { base: 1, levelGrowth: 0 },
      },
      health: { base: 50, levelGrowth: 10 },
      movement: { speed: 2.5, levelSpeedGrowth: 0 },
      spawnWeight: { base: 1, levelGrowth: 0 },
      attacks: [{ kind: "melee", damage: 5, cooldown: 1, range: 0.5 }],
      dropTable: { chance: 0, entries: [{ kind: "health", weight: 1, amount: 1 }] },
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
    expect(normalized.movement.sound).toBe("hunter-moving");
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

async function touchProjectFile(root, relativePath, date) {
  await utimes(join(root, relativePath), date, date);
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
      ],
    },
  };
}

function environmentSidecar(options = {}) {
  return {
    kind: "environment",
    schemaVersion: 1,
    id: "industrial-crate",
    category: "environment",
    label: "Industrial Crate",
    model: { file: "industrial-crate.glb", scale: 1 },
    collision: { type: "circle", radius: options.radius ?? 0.6 },
  };
}
