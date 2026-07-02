# Daemon Syndicate

Daemon Syndicate is a Vite/TypeScript isometric sci-fi action prototype using Three.js. Core game logic lives in `src/game.ts`, scene setup in `src/scene.ts`, HUD/UI markup in `src/ui.ts`, and styling in `src/style.css`.

Assume the dev server is already running unless the user explicitly asks you to start or restart it. Use the existing local server for browser checks, and avoid launching a new server by default in each thread.

When doing browser checks against `bun run dev`, do not wait for `networkidle`; Bun/Vite dev servers can keep requests open. Use `domcontentloaded` plus explicit UI, canvas, or app-readiness checks instead.

Use `tmp/` for temporary files, including verification screenshots and other disposable artifacts.
