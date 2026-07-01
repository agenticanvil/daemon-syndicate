import { promises as fs } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { defineConfig } from "vite";

const ASSET_CATEGORIES = new Set(["player", "enemies", "pickups", "environment"]);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default defineConfig({
  plugins: [
    {
      name: "daemon-syndicate-asset-settings",
      apply: "serve",
      configureServer(server) {
        let assetSettingsFilesPromise;

        server.middlewares.use("/__dev/assets", async (req, res) => {
          try {
            await handlePublicAssetsRequest(server.config.root, req, res);
          } catch (error) {
            sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid asset request" });
          }
        });

        server.middlewares.use("/__dev/asset-settings", async (req, res) => {
          const assetId = decodeURIComponent((req.url ?? "").split("?")[0].replace(/^\/+|\/+$/g, ""));
          const assetSettingsFiles = await (
            assetSettingsFilesPromise ?? (assetSettingsFilesPromise = discoverAssetSettingsFiles(server.config.root))
          );
          const settingsFile = assetSettingsFiles[assetId];

          if (!settingsFile) {
            sendJson(res, 404, { error: "Unknown asset" });
            return;
          }

          if (req.method !== "POST") {
            sendJson(res, 405, { error: "Method not allowed" });
            return;
          }

          try {
            const body = await readRequestBody(req);
            const settings = normalizeLegacyAssetSettings(JSON.parse(body));
            await fs.writeFile(resolve(server.config.root, settingsFile), `${JSON.stringify(settings, null, 2)}\n`);
            sendJson(res, 200, settings);
          } catch (error) {
            sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid asset settings" });
          }
        });
      },
    },
  ],
});

async function handlePublicAssetsRequest(root, req, res) {
  const path = decodeURIComponent((req.url ?? "").split("?")[0].replace(/^\/+|\/+$/g, ""));

  if (path === "bulk-validate") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    return sendJson(res, 200, await validatePublicAssets(root));
  }

  if (path === "promote-staged") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    const body = await readOptionalJsonBody(req);
    return sendJson(res, 200, await promoteStagedAssets(root, body));
  }

  if (!path) {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
    return sendJson(res, 200, { assets: await discoverPublicAssets(root) });
  }

  const request = parseAssetEndpointPath(path);
  if (!request) return sendJson(res, 404, { error: "Unknown asset endpoint" });

  if (req.method === "GET") {
    const record = await readPublicAssetRecord(root, request);
    if (!record) return sendJson(res, 404, { error: "Unknown asset" });
    return sendJson(res, 200, record.sidecar);
  }

  if (req.method === "POST") {
    const record = await readPublicAssetRecord(root, request);
    if (!record) return sendJson(res, 404, { error: "Unknown asset" });
    const body = await readRequestBody(req);
    const sidecar = normalizeAssetSidecar(JSON.parse(body), request);
    const sidecarPath = sidecarFilePath(root, request);
    await fs.mkdir(dirname(sidecarPath), { recursive: true });
    await fs.writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
    return sendJson(res, 200, sidecar);
  }

  return sendJson(res, 405, { error: "Method not allowed" });
}

async function discoverPublicAssets(root) {
  const assetsRoot = resolve(root, "public/assets");
  const records = [];
  for (const category of ASSET_CATEGORIES) {
    records.push(...(await discoverAssetCategory(root, assetsRoot, category, false)));
  }
  for (const category of ASSET_CATEGORIES) {
    records.push(...(await discoverAssetCategory(root, resolve(assetsRoot, "_staged"), category, true)));
  }
  return records.sort((a, b) => Number(a.staged) - Number(b.staged) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

async function discoverAssetCategory(root, baseRoot, category, staged) {
  const categoryRoot = resolve(baseRoot, category);
  if (!(await fileExists(categoryRoot))) return [];
  const entries = await fs.readdir(categoryRoot, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSlug(entry.name)) continue;
    const request = { category, name: entry.name, staged };
    if (!(await fileExists(modelFilePath(root, request)))) continue;
    const record = await readPublicAssetRecord(root, request);
    if (record) records.push(record);
  }
  return records;
}

async function readPublicAssetRecord(root, request) {
  if (!isValidAssetRequest(request)) throw new Error("Invalid asset path");
  if (!(await fileExists(modelFilePath(root, request)))) return null;

  const sidecarPath = sidecarFilePath(root, request);
  const sidecarExists = await fileExists(sidecarPath);
  const rawSidecar = sidecarExists ? JSON.parse(await fs.readFile(sidecarPath, "utf8")) : await createDefaultSidecar(root, request);
  const sidecar = normalizeAssetSidecar(rawSidecar, request);
  const publicPrefix = request.staged ? `/assets/_staged/${request.category}/${request.name}` : `/assets/${request.category}/${request.name}`;

  return {
    id: request.name,
    category: request.category,
    name: request.name,
    label: sidecar.label,
    modelUrl: `${publicPrefix}/${request.name}.glb`,
    sidecarUrl: `${publicPrefix}/${request.name}.asset.json`,
    sidecarExists,
    staged: request.staged,
    sidecar,
  };
}

async function validatePublicAssets(root) {
  const records = await discoverPublicAssets(root);
  const issues = [];
  for (const record of records) {
    const request = { category: record.category, name: record.name, staged: record.staged };
    if (!(await fileExists(modelFilePath(root, request)))) {
      issues.push({ severity: "error", asset: assetIssueId(record), message: "Missing paired GLB" });
    }
    if (!record.sidecarExists) {
      issues.push({ severity: "error", asset: assetIssueId(record), message: "Missing sidecar JSON" });
    }
    try {
      normalizeAssetSidecar(record.sidecar, request);
    } catch (error) {
      issues.push({
        severity: "error",
        asset: assetIssueId(record),
        message: error instanceof Error ? error.message : "Invalid sidecar",
      });
    }
    if (record.category === "enemies") {
      const animation = record.sidecar.preview?.defaultAnimation;
      if (animation && !["idle", "walk", "melee", "attack", "death"].includes(animation)) {
        issues.push({ severity: "warning", asset: assetIssueId(record), message: "Non-standard default animation name" });
      }
    }
  }
  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    assetCount: records.length,
    issues,
  };
}

async function promoteStagedAssets(root, options) {
  const records = (await discoverPublicAssets(root)).filter((record) => record.staged);
  const selected = records.filter((record) => {
    if (options?.all) return true;
    if (!options?.category && !options?.name) return true;
    return (!options.category || options.category === record.category) && (!options.name || options.name === record.name);
  });
  const promoted = [];
  const issues = [];

  for (const record of selected) {
    const stagedRequest = { category: record.category, name: record.name, staged: true };
    const liveRequest = { category: record.category, name: record.name, staged: false };
    const stagedSidecarPath = sidecarFilePath(root, stagedRequest);
    if (!(await fileExists(stagedSidecarPath))) {
      issues.push({ severity: "error", asset: assetIssueId(record), message: "Staged sidecar must exist before promotion" });
      continue;
    }

    const sidecar = normalizeAssetSidecar(JSON.parse(await fs.readFile(stagedSidecarPath, "utf8")), liveRequest);
    await assertPathInside(resolve(root, "public/assets"), modelFilePath(root, liveRequest));
    await fs.mkdir(dirname(modelFilePath(root, liveRequest)), { recursive: true });
    await fs.copyFile(modelFilePath(root, stagedRequest), modelFilePath(root, liveRequest));
    await fs.writeFile(sidecarFilePath(root, liveRequest), `${JSON.stringify(sidecar, null, 2)}\n`);
    promoted.push({ category: record.category, name: record.name });
  }

  return {
    ok: issues.length === 0,
    promoted,
    issues,
  };
}

function parseAssetEndpointPath(path) {
  const parts = path.split("/");
  if (parts.length === 2) {
    const [category, name] = parts;
    return isValidAssetRequest({ category, name, staged: false }) ? { category, name, staged: false } : null;
  }
  if (parts.length === 3 && parts[0] === "_staged") {
    const [, category, name] = parts;
    return isValidAssetRequest({ category, name, staged: true }) ? { category, name, staged: true } : null;
  }
  return null;
}

function isValidAssetRequest(request) {
  return ASSET_CATEGORIES.has(request.category) && isSlug(request.name);
}

function modelFilePath(root, request) {
  const base = request.staged
    ? resolve(root, "public/assets/_staged", request.category, request.name)
    : resolve(root, "public/assets", request.category, request.name);
  return resolve(base, `${request.name}.glb`);
}

function sidecarFilePath(root, request) {
  const base = request.staged
    ? resolve(root, "public/assets/_staged", request.category, request.name)
    : resolve(root, "public/assets", request.category, request.name);
  return resolve(base, `${request.name}.asset.json`);
}

async function createDefaultSidecar(root, request) {
  const legacy = await readLegacySettingsForAsset(root, request.name);
  return normalizeAssetSidecar(
    {
      ...(legacy ?? defaultSettingsForCategory(request.category)),
      schemaVersion: 1,
      id: request.name,
      category: request.category,
      label: labelFromSlug(request.name),
      model: {
        file: `${request.name}.glb`,
        scale: 1,
        rotationY: 0,
        floorOffset: 0,
      },
      preview: defaultPreviewForCategory(request.category),
      collision: {
        type: "circle",
        radius: legacy?.collision?.radius ?? defaultSettingsForCategory(request.category).collision.radius,
      },
    },
    request,
  );
}

async function readLegacySettingsForAsset(root, assetName) {
  const files = await discoverAssetSettingsFiles(root);
  const settingsFile = files[assetName];
  if (!settingsFile) return null;
  return JSON.parse(await fs.readFile(resolve(root, settingsFile), "utf8"));
}

function defaultSettingsForCategory(category) {
  if (category === "enemies") {
    return {
      kind: "enemy",
      gameplay: {
        unlockMapDepth: 1,
        budgetCost: 1,
        attackDamageLevelGrowth: 0,
        xpReward: { base: 1, levelGrowth: 0 },
      },
      collision: { radius: 0.7 },
      health: { base: 50, levelGrowth: 10 },
      movement: { speed: 2.5, levelSpeedGrowth: 0 },
      spawnWeight: { base: 1, levelGrowth: 0 },
      attacks: [{ kind: "melee", damage: 5, cooldown: 1, range: 0.5 }],
      dropTable: { chance: 0, entries: [{ kind: "health", weight: 1, amount: 1 }] },
    };
  }
  if (category === "pickups") {
    return {
      kind: "pickup",
      collision: { radius: 0.6 },
      resources: { health: 1 },
      lifetime: 18,
    };
  }
  if (category === "player") {
    return {
      kind: "player",
      collision: { radius: 0.55 },
      health: 100,
      movement: { speed: 7.5 },
    };
  }
  return {
    kind: "environment",
    collision: { radius: 0.6 },
  };
}

function defaultPreviewForCategory(category) {
  if (category === "player") return { targetY: 0.9, defaultAnimation: "idle" };
  if (category === "enemies") return { targetY: 0.55, defaultAnimation: "idle" };
  if (category === "pickups") return { targetY: 0.35 };
  return { targetY: 0.45 };
}

function normalizeAssetSidecar(value, request) {
  const category = request.category;
  const name = request.name;
  const kind = value?.kind ?? kindForCategory(category);
  if (kind !== kindForCategory(category)) throw new Error(`kind must match category ${category}`);

  const settings = normalizeLegacyAssetSettings({
    ...value,
    collision: {
      radius: value?.collision?.radius,
      height: value?.collision?.height ?? 1,
    },
  });
  const model = normalizeModel(value?.model, name);
  const preview = normalizePreview(value?.preview);

  return {
    schemaVersion: 1,
    id: name,
    category,
    label: typeof value?.label === "string" && value.label.trim() ? value.label.trim() : labelFromSlug(name),
    kind: settings.kind,
    model,
    ...(preview ? { preview } : {}),
    collision: normalizeSidecarCollision(value?.collision ?? settings.collision),
    ...settingsWithoutCollision(settings),
  };
}

function normalizeModel(value, name) {
  if (value?.file !== `${name}.glb`) throw new Error(`model.file must be ${name}.glb`);
  const scale = optionalNumber(value?.scale, "model.scale", 0.01, 100);
  const rotationY = optionalNumber(value?.rotationY, "model.rotationY", -Math.PI * 2, Math.PI * 2);
  const floorOffset = optionalNumber(value?.floorOffset, "model.floorOffset", -10, 10);
  return {
    file: `${name}.glb`,
    ...(scale === undefined ? {} : { scale: round(scale, 4) }),
    ...(rotationY === undefined ? {} : { rotationY: round(rotationY, 4) }),
    ...(floorOffset === undefined ? {} : { floorOffset: round(floorOffset, 4) }),
  };
}

function normalizePreview(value) {
  if (!value || typeof value !== "object") return undefined;
  const targetY = optionalNumber(value.targetY, "preview.targetY", -10, 10);
  const defaultAnimation =
    typeof value.defaultAnimation === "string" && value.defaultAnimation.trim() ? value.defaultAnimation.trim() : undefined;
  if (targetY === undefined && defaultAnimation === undefined) return undefined;
  return {
    ...(targetY === undefined ? {} : { targetY: round(targetY, 3) }),
    ...(defaultAnimation === undefined ? {} : { defaultAnimation }),
  };
}

function normalizeSidecarCollision(value) {
  const radius = Number(value?.radius);
  if (value?.type !== undefined && value.type !== "circle") throw new Error('collision.type must be "circle"');
  if (!Number.isFinite(radius) || radius < 0.1 || radius > 1.4) {
    throw new Error("collision.radius must be between 0.1 and 1.4");
  }
  return { type: "circle", radius: round(radius, 2) };
}

function settingsWithoutCollision(settings) {
  const { collision: _collision, ...rest } = settings;
  return rest;
}

function kindForCategory(category) {
  if (category === "enemies") return "enemy";
  if (category === "pickups") return "pickup";
  if (category === "player") return "player";
  return "environment";
}

async function discoverAssetSettingsFiles(root) {
  const assetRoot = resolve(root, "src/assets");
  const files = {};
  await visitAssetSettingsFolders(assetRoot, root, files);
  return files;
}

async function visitAssetSettingsFolders(directory, root, files) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await visitAssetSettingsFolders(fullPath, root, files);
      continue;
    }
    if (!entry.name.endsWith(".settings.json")) continue;
    const folder = directory.split(/[/\\]/).at(-1);
    const assetId = camelToKebab(folder);
    files[assetId] = fullPath.slice(resolve(root).length + 1);
  }
}

function camelToKebab(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function normalizeLegacyAssetSettings(value) {
  const kind = value?.kind;
  if (kind === "enemy") return normalizeEnemySettings(value);
  if (kind === "pickup") return normalizePickupSettings(value);
  if (kind === "player") return normalizePlayerSettings(value);
  if (kind === "environment") return normalizeEnvironmentSettings(value);
  throw new Error("kind must be enemy, pickup, player, or environment");
}

function normalizeEnemySettings(value) {
  const collision = normalizeLegacyCollisionSettings(value);
  const gameplay = normalizeEnemyGameplay(value?.gameplay);
  const health = normalizeEnemyHealth(value?.health);
  const speed = Number(value?.movement?.speed);
  const levelSpeedGrowth = Number(value?.movement?.levelSpeedGrowth);
  const spawnWeight = normalizeSpawnWeight(value?.spawnWeight);
  const attacks = normalizeEnemyAttacks(value?.attacks);
  const dropTable = normalizeDropTable(value?.dropTable);

  if (!Number.isFinite(speed) || speed < 0 || speed > 8) {
    throw new Error("movement.speed must be between 0 and 8");
  }

  if (!Number.isFinite(levelSpeedGrowth) || levelSpeedGrowth < 0 || levelSpeedGrowth > 2) {
    throw new Error("movement.levelSpeedGrowth must be between 0 and 2");
  }

  return {
    kind: "enemy",
    gameplay,
    collision,
    health,
    movement: {
      speed: round(speed, 2),
      levelSpeedGrowth: round(levelSpeedGrowth, 3),
    },
    spawnWeight,
    attacks,
    dropTable,
  };
}

function normalizeEnemyGameplay(value) {
  const unlockMapDepth = Number(value?.unlockMapDepth);
  const budgetCost = Number(value?.budgetCost);
  const attackDamageLevelGrowth = Number(value?.attackDamageLevelGrowth);
  const xpRewardBase = Number(value?.xpReward?.base);
  const xpRewardLevelGrowth = Number(value?.xpReward?.levelGrowth);
  if (!Number.isFinite(unlockMapDepth) || unlockMapDepth < 1 || unlockMapDepth > 99) {
    throw new Error("gameplay.unlockMapDepth must be between 1 and 99");
  }
  if (!Number.isFinite(budgetCost) || budgetCost <= 0 || budgetCost > 99) {
    throw new Error("gameplay.budgetCost must be between 0 and 99");
  }
  if (!Number.isFinite(attackDamageLevelGrowth) || attackDamageLevelGrowth < 0 || attackDamageLevelGrowth > 99) {
    throw new Error("gameplay.attackDamageLevelGrowth must be between 0 and 99");
  }
  if (!Number.isFinite(xpRewardBase) || xpRewardBase < 0 || xpRewardBase > 999) {
    throw new Error("gameplay.xpReward.base must be between 0 and 999");
  }
  if (!Number.isFinite(xpRewardLevelGrowth) || xpRewardLevelGrowth < 0 || xpRewardLevelGrowth > 999) {
    throw new Error("gameplay.xpReward.levelGrowth must be between 0 and 999");
  }
  return {
    unlockMapDepth: Math.round(unlockMapDepth),
    budgetCost: round(budgetCost, 2),
    attackDamageLevelGrowth: round(attackDamageLevelGrowth, 2),
    xpReward: {
      base: round(xpRewardBase, 2),
      levelGrowth: round(xpRewardLevelGrowth, 2),
    },
  };
}

function normalizePickupSettings(value) {
  const collision = normalizeLegacyCollisionSettings(value);
  const resources = normalizeResources(value?.resources);
  const lifetime = value?.lifetime === undefined ? undefined : Number(value.lifetime);

  if (!Object.values(resources).some((amount) => amount > 0)) {
    throw new Error("pickup resources must grant at least one resource");
  }

  if (lifetime !== undefined && (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 120)) {
    throw new Error("lifetime must be between 0 and 120");
  }

  return {
    kind: "pickup",
    collision,
    resources,
    ...(lifetime === undefined ? {} : { lifetime: round(lifetime, 2) }),
  };
}

function normalizePlayerSettings(value) {
  const collision = normalizeLegacyCollisionSettings(value);
  const health = normalizeHealth(value?.health);
  const speed = value?.movement?.speed === undefined ? undefined : Number(value.movement.speed);

  if (speed !== undefined && (!Number.isFinite(speed) || speed < 0 || speed > 12)) {
    throw new Error("movement.speed must be between 0 and 12");
  }

  return {
    kind: "player",
    collision,
    health,
    ...(speed === undefined ? {} : { movement: { speed: round(speed, 2) } }),
  };
}

function normalizeEnvironmentSettings(value) {
  return {
    kind: "environment",
    collision: normalizeLegacyCollisionSettings(value),
  };
}

function normalizeLegacyCollisionSettings(value) {
  const radius = Number(value?.collision?.radius);
  const height = value?.collision?.height === undefined ? 1 : Number(value.collision.height);

  if (!Number.isFinite(radius) || radius < 0.1 || radius > 1.4) {
    throw new Error("collision.radius must be between 0.1 and 1.4");
  }

  if (!Number.isFinite(height) || height <= 0 || height > 5) {
    throw new Error("collision.height must be between 0 and 5");
  }

  return {
    radius: round(radius, 2),
    height: round(height, 2),
  };
}

function normalizeHealth(value) {
  const health = Number(value);

  if (!Number.isFinite(health) || health < 1 || health > 999) {
    throw new Error("health must be between 1 and 999");
  }

  return Math.round(health);
}

function normalizeEnemyHealth(value) {
  const base = normalizeHealth(value?.base);
  const levelGrowth = Number(value?.levelGrowth);

  if (!Number.isFinite(levelGrowth) || levelGrowth < 0 || levelGrowth > 100) {
    throw new Error("health.levelGrowth must be between 0 and 100");
  }

  return {
    base,
    levelGrowth: round(levelGrowth, 2),
  };
}

function normalizeSpawnWeight(value) {
  const base = Number(value?.base);
  const levelGrowth = Number(value?.levelGrowth);
  const min = value?.min === undefined ? undefined : Number(value.min);
  const max = value?.max === undefined ? undefined : Number(value.max);

  if (!Number.isFinite(base) || base <= 0 || base > 10) {
    throw new Error("spawnWeight.base must be between 0 and 10");
  }

  if (!Number.isFinite(levelGrowth) || levelGrowth < -10 || levelGrowth > 10) {
    throw new Error("spawnWeight.levelGrowth must be between -10 and 10");
  }

  if (min !== undefined && (!Number.isFinite(min) || min < 0 || min > 10)) {
    throw new Error("spawnWeight.min must be between 0 and 10");
  }

  if (max !== undefined && (!Number.isFinite(max) || max <= 0 || max > 10)) {
    throw new Error("spawnWeight.max must be between 0 and 10");
  }

  if (min !== undefined && max !== undefined && min > max) {
    throw new Error("spawnWeight.min must be less than or equal to spawnWeight.max");
  }

  return {
    base: round(base, 3),
    levelGrowth: round(levelGrowth, 3),
    ...(min === undefined ? {} : { min: round(min, 3) }),
    ...(max === undefined ? {} : { max: round(max, 3) }),
  };
}

function normalizeEnemyAttacks(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("attacks must include at least one attack");
  }

  return value.map((attack) => {
    const kind = attack?.kind;
    const damage = Number(attack?.damage);
    const cooldown = Number(attack?.cooldown);
    const range = Number(attack?.range);
    const projectileSpeed = attack?.projectileSpeed === undefined ? undefined : Number(attack.projectileSpeed);
    const projectileRadius = attack?.projectileRadius === undefined ? undefined : Number(attack.projectileRadius);
    const windup = attack?.windup === undefined ? undefined : Number(attack.windup);

    if (kind !== "melee" && kind !== "ranged") {
      throw new Error("attack.kind must be melee or ranged");
    }

    if (!Number.isFinite(damage) || damage <= 0 || damage > 999) {
      throw new Error("attack.damage must be between 0 and 999");
    }

    if (!Number.isFinite(cooldown) || cooldown <= 0 || cooldown > 10) {
      throw new Error("attack.cooldown must be between 0 and 10");
    }

    if (!Number.isFinite(range) || range <= 0 || range > 50) {
      throw new Error("attack.range must be between 0 and 50");
    }

    return {
      kind,
      damage: Math.round(damage),
      cooldown: round(cooldown, 2),
      range: round(range, 2),
      ...(projectileSpeed === undefined ? {} : { projectileSpeed: round(assertFiniteRange(projectileSpeed, "attack.projectileSpeed", 0, 100), 2) }),
      ...(projectileRadius === undefined ? {} : { projectileRadius: round(assertFiniteRange(projectileRadius, "attack.projectileRadius", 0, 10), 2) }),
      ...(windup === undefined ? {} : { windup: round(assertFiniteRange(windup, "attack.windup", 0, 10), 2) }),
    };
  });
}

function normalizeDropTable(value) {
  const chance = Number(value?.chance);
  const entries = Array.isArray(value?.entries) ? value.entries : [];

  if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
    throw new Error("dropTable.chance must be between 0 and 1");
  }

  if (entries.length === 0) {
    throw new Error("dropTable.entries must include at least one entry");
  }

  return {
    chance: round(chance, 3),
    entries: entries.map((entry) => normalizeDropEntry(entry)),
  };
}

function normalizeDropEntry(entry) {
  const kind = entry?.kind;
  const weight = Number(entry?.weight);
  const amount = Number(entry?.amount);

  if (!isResourceKind(kind)) {
    throw new Error("drop entry kind must be health, ammo, or energy");
  }

  if (!Number.isFinite(weight) || weight <= 0 || weight > 999) {
    throw new Error("drop entry weight must be between 0 and 999");
  }

  if (!Number.isFinite(amount) || amount <= 0 || amount > 999) {
    throw new Error("drop entry amount must be between 0 and 999");
  }

  return {
    kind,
    weight: Math.round(weight),
    amount: Math.round(amount),
  };
}

function normalizeResources(value) {
  const resources = {};
  for (const kind of ["health", "ammo", "energy"]) {
    const amount = Number(value?.[kind] ?? 0);
    if (!Number.isFinite(amount) || amount < 0 || amount > 999) {
      throw new Error(`${kind} resource amount must be between 0 and 999`);
    }
    if (amount > 0) resources[kind] = Math.round(amount);
  }
  return resources;
}

function isResourceKind(value) {
  return value === "health" || value === "ammo" || value === "energy";
}

async function readOptionalJsonBody(req) {
  const body = await readRequestBody(req);
  if (!body.trim()) return {};
  return JSON.parse(body);
}

function readRequestBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = "";

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 64) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

async function fileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function isSlug(value) {
  return SLUG_PATTERN.test(value);
}

function labelFromSlug(value) {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function assetIssueId(record) {
  return record.staged ? `_staged/${record.category}/${record.name}` : `${record.category}/${record.name}`;
}

function optionalNumber(value, name, min, max) {
  if (value === undefined) return undefined;
  return assertFiniteRange(Number(value), name, min, max);
}

function assertFiniteRange(value, name, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

async function assertPathInside(root, path) {
  const rel = relative(root, path);
  if (rel.startsWith("..") || rel === "" || rel.split(sep).includes("..")) {
    throw new Error("Resolved path escapes public assets");
  }
}

function round(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
