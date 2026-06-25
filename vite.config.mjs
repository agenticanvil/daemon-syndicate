import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const assetSettingsFiles = {
  player: "src/assets/player/player.settings.json",
  "lean-hunter": "src/assets/enemies/leanHunter.settings.json",
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
  const radius = Number(value?.collision?.radius);
  const height = Number(value?.collision?.height);
  const health = Number(value?.health);

  if (!Number.isFinite(radius) || radius < 0.1 || radius > 1.4) {
    throw new Error("collision.radius must be between 0.1 and 1.4");
  }

  if (!Number.isFinite(height) || height <= 0 || height > 5) {
    throw new Error("collision.height must be between 0 and 5");
  }

  if (!Number.isFinite(health) || health < 1 || health > 999) {
    throw new Error("health must be between 1 and 999");
  }

  return {
    collision: {
      radius: round(radius, 2),
      height: round(height, 2),
    },
    health: Math.round(health),
  };
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
