import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const assetSettingsFiles = {
  player: "src/assets/player/player.settings.json",
  "lean-hunter": "src/assets/enemies/leanHunter.settings.json",
  "elite-enemy": "src/assets/enemies/eliteEnemy/eliteEnemy.settings.json",
  "health-pickup": "src/assets/pickups/healthPickup/healthPickup.settings.json",
  "ammo-pickup": "src/assets/pickups/ammoPickup/ammoPickup.settings.json",
  "energy-pickup": "src/assets/pickups/energyPickup/energyPickup.settings.json",
};

export default defineConfig({
  plugins: [
    {
      name: "daemon-syndicate-asset-settings",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use("/__dev/asset-settings", async (req, res) => {
          const assetId = decodeURIComponent((req.url ?? "").split("?")[0].replace(/^\/+|\/+$/g, ""));
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
            const settings = normalizeAssetSettings(JSON.parse(body));
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

function normalizeAssetSettings(value) {
  const kind = value?.kind;
  if (kind === "enemy") return normalizeEnemySettings(value);
  if (kind === "pickup") return normalizePickupSettings(value);
  if (kind === "player") return normalizePlayerSettings(value);
  throw new Error("kind must be enemy, pickup, or player");
}

function normalizeEnemySettings(value) {
  const collision = normalizeCollisionSettings(value);
  const health = normalizeHealth(value?.health);
  const speed = Number(value?.movement?.speed);
  const waveSpeedGrowth = Number(value?.movement?.waveSpeedGrowth);
  const attacks = normalizeEnemyAttacks(value?.attacks);
  const dropTable = normalizeDropTable(value?.dropTable);

  if (!Number.isFinite(speed) || speed < 0 || speed > 8) {
    throw new Error("movement.speed must be between 0 and 8");
  }

  if (!Number.isFinite(waveSpeedGrowth) || waveSpeedGrowth < 0 || waveSpeedGrowth > 2) {
    throw new Error("movement.waveSpeedGrowth must be between 0 and 2");
  }

  return {
    kind: "enemy",
    collision,
    health,
    movement: {
      speed: round(speed, 2),
      waveSpeedGrowth: round(waveSpeedGrowth, 3),
    },
    attacks,
    dropTable,
  };
}

function normalizePickupSettings(value) {
  const collision = normalizeCollisionSettings(value);
  const resources = normalizeResources(value?.resources);
  const lifetime = Number(value?.lifetime);

  if (!Object.values(resources).some((amount) => amount > 0)) {
    throw new Error("pickup resources must grant at least one resource");
  }

  if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 120) {
    throw new Error("lifetime must be between 0 and 120");
  }

  return {
    kind: "pickup",
    collision,
    resources,
    lifetime: round(lifetime, 2),
  };
}

function normalizePlayerSettings(value) {
  const collision = normalizeCollisionSettings(value);
  const health = normalizeHealth(value?.health);
  const speed = Number(value?.movement?.speed);

  if (!Number.isFinite(speed) || speed < 0 || speed > 12) {
    throw new Error("movement.speed must be between 0 and 12");
  }

  return {
    kind: "player",
    collision,
    health,
    movement: {
      speed: round(speed, 2),
    },
  };
}

function normalizeCollisionSettings(value) {
  const radius = Number(value?.collision?.radius);
  const height = Number(value?.collision?.height);

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

function normalizeEnemyAttacks(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("attacks must include at least one attack");
  }

  return value.map((attack) => {
    const kind = attack?.kind;
    const damage = Number(attack?.damage);
    const cooldown = Number(attack?.cooldown);
    const range = Number(attack?.range);

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

function readRequestBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = "";

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 16) {
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

function round(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
