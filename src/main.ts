import { createAudioSystem } from "./audio";
import { Game } from "./game";
import { createPerfRecorder, type PerfRecorder } from "./perf";
import { seededRandom } from "./rng";
import { createGameScene } from "./scene";
import { loadGltfAssetLibrary } from "./gltfAssetFactory";
import "./style.css";
import { createUi } from "./ui";

declare global {
  interface Window {
    __daemonPerf?: PerfRecorder;
    __daemonGame?: {
      startNewRun: (mapDepth?: number) => void;
      snapshot: () => unknown;
      spawnEnemy: Game["spawnEnemy"];
      grantResources: Game["grantResources"];
    };
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
const routePath = window.location.pathname.replace(/\/+$/, "") || "/";

if (!app) {
  throw new Error("Missing #app root");
}

void startApp(app, routePath);

async function startApp(app: HTMLDivElement, routePath: string): Promise<void> {
  if (routePath === "/dev/asset-editor") {
    document.title = "Asset Editor | Daemon Syndicate";
    if (import.meta.env.DEV) {
      const { startAssetEditor } = await import("./assetEditor");
      startAssetEditor(app);
    } else {
      app.innerHTML = "";
    }
    return;
  }

  if (routePath === "/dev/assets") {
    document.title = "Assets | Daemon Syndicate";
    if (import.meta.env.DEV) {
      const { startDevAssets } = await import("./devAssets");
      await startDevAssets(app);
    } else {
      app.innerHTML = "";
    }
    return;
  }

  await startGame(app);
}

async function startGame(app: HTMLDivElement): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const perfEnabled = params.get("perf") === "1";
  const seed = params.get("seed");

  const perf = createPerfRecorder(perfEnabled);
  const audio = createAudioSystem();
  const ui = createUi(app);
  const gltfAssets = await loadGltfAssetLibrary();
  const world = createGameScene(app, gltfAssets);
  ui.onAudioSettingsChange((settings) => audio.applySettings(settings));
  ui.onGraphicsSettingsChange((settings) => world.applyGraphicsSettings(settings));
  const game = new Game(world, ui, perf, {
    audio,
    rng: seed ? seededRandom(seed) : Math.random,
    seed: seed ?? undefined,
  });

  game.bindEvents();
  window.__daemonPerf = perf;
  window.__daemonGame = {
    startNewRun: (mapDepth) => game.startNewRun(mapDepth),
    snapshot: () => game.snapshot(),
    spawnEnemy: (kind, position) => game.spawnEnemy(kind, position),
    grantResources: (resources) => game.grantResources(resources),
  };

  if (params.get("autostart") === "1") {
    game.startNewRun(readMapDepthParam(params));
  }

  game.startLoop();
}

function readMapDepthParam(params: URLSearchParams): number {
  const mapDepth = Number(params.get("mapDepth"));
  return Number.isFinite(mapDepth) ? Math.max(1, Math.floor(mapDepth)) : 1;
}
