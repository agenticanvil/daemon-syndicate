import { Game } from "./game";
import { createPerfRecorder, type PerfRecorder } from "./perf";
import { createGameScene } from "./scene";
import "./style.css";
import { createUi } from "./ui";

declare global {
  interface Window {
    __daemonPerf?: PerfRecorder;
    __daemonGame?: {
      startNewRun: () => void;
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
  if (routePath === "/dev/asset-renderer") {
    document.title = "Asset Editor | Daemon Syndicate";
    if (import.meta.env.DEV) {
      const { startAssetRenderer } = await import("./assetRenderer");
      startAssetRenderer(app);
    } else {
      app.innerHTML = "";
    }
    return;
  }

  startGame(app);
}

function startGame(app: HTMLDivElement): void {
  const params = new URLSearchParams(window.location.search);
  const perfEnabled = params.get("perf") === "1";
  const seed = params.get("seed");

  if (seed) {
    Math.random = seededRandom(seed);
  }

  const perf = createPerfRecorder(perfEnabled);
  const ui = createUi(app);
  const world = createGameScene(app);
  const game = new Game(world, ui, perf);

  game.bindEvents();
  window.__daemonPerf = perf;
  window.__daemonGame = {
    startNewRun: () => game.startNewRun(),
  };

  if (params.get("autostart") === "1") {
    game.startNewRun();
  }

  game.startLoop();
}

function seededRandom(seed: string): () => number {
  let state = 0;
  for (let i = 0; i < seed.length; i += 1) {
    state = Math.imul(31, state) + seed.charCodeAt(i);
  }

  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return ((state >>> 0) / 4294967296);
  };
}
