import { createAudioSystem } from "./audio";
import { Game } from "./game";
import { createPerfRecorder, type PerfRecorder } from "./perf";
import { seededRandom } from "./rng";
import { createGameScene, type GameScene, type GraphicsSettings } from "./scene";
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

  if (routePath === "/dev/map") {
    document.title = "Dev Map | Daemon Syndicate";
    if (import.meta.env.DEV) {
      const { startDevMap } = await import("./devMap");
      await startDevMap(app);
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
  let game: Game | undefined;
  let world: GameScene | undefined;
  let deploying = false;

  ui.onAudioSettingsChange((settings) => audio.applySettings(settings));
  let graphicsSettings: GraphicsSettings | undefined;
  ui.onGraphicsSettingsChange((settings) => {
    graphicsSettings = settings;
    world?.applyGraphicsSettings(settings);
  });

  window.__daemonPerf = perf;
  ui.startButton.addEventListener("click", () => {
    void deploy(ui.getStartMapDepth());
  });

  if (params.get("autostart") === "1") {
    void deploy(readMapDepthParam(params));
  }

  async function deploy(mapDepth: number): Promise<void> {
    if (deploying) return;
    deploying = true;

    if (game) {
      try {
        await audio.preload();
        audio.play("ui-click", { volume: 0.55 });
        game.startNewRun(mapDepth);
      } finally {
        deploying = false;
      }
      return;
    }

    try {
      ui.showLoading("Loading models and shader bundles...");
      const gltfAssets = await withTimeout(loadGltfAssetLibrary(), 60_000, "Timed out loading runtime model assets.");
      ui.showLoading("Decoding audio buffers...");
      await withTimeout(audio.preload(), 20_000, "Timed out loading audio buffers.");
      ui.showLoading("Warming renderer and floor textures...");
      world = await withTimeout(createGameScene(app, gltfAssets), 20_000, "Timed out loading floor textures.");
      if (graphicsSettings) world.applyGraphicsSettings(graphicsSettings);

      game = new Game(world, ui, perf, {
        audio,
        rng: seed ? seededRandom(seed) : Math.random,
        seed: seed ?? undefined,
      });
      game.bindEvents();
      game.startLoop();
      const activeGame = game;
      window.__daemonGame = {
        startNewRun: (nextMapDepth) => activeGame.startNewRun(nextMapDepth),
        snapshot: () => activeGame.snapshot(),
        spawnEnemy: (kind, position) => activeGame.spawnEnemy(kind, position),
        grantResources: (resources) => activeGame.grantResources(resources),
      };

      audio.play("ui-click", { volume: 0.55 });
      game.startNewRun(mapDepth);
    } catch (error) {
      ui.showStartError(error instanceof Error ? error.message : "Failed to prepare runtime assets.");
    } finally {
      deploying = false;
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function readMapDepthParam(params: URLSearchParams): number {
  const mapDepth = Number(params.get("mapDepth"));
  return Number.isFinite(mapDepth) ? Math.max(1, Math.floor(mapDepth)) : 1;
}
