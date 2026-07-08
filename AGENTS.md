# Daemon Syndicate

Daemon Syndicate is a Vite/TypeScript isometric sci-fi action prototype using Three.js. Core game logic lives in `src/game.ts`, scene setup in `src/scene.ts`, HUD/UI markup in `src/ui.ts`, and styling in `src/style.css`.

Assume the dev server is already running unless the user explicitly asks you to start or restart it. Use the existing local server for browser checks, and avoid launching a new server by default in each thread.

Use npm as the package-management and verification source of truth. Install with `npm install`/`npm ci`, keep `package-lock.json` as the only committed dependency lockfile, and run project scripts with `npm run ...` for build/test/lint/perf/sim verification. `bun run dev` is acceptable as a local convenience for the already-running Vite dev server, but do not run `bun install` or commit `bun.lock*` unless the project is intentionally migrated to Bun.

When doing browser checks against `bun run dev`, do not wait for `networkidle`; Bun/Vite dev servers can keep requests open. Use `domcontentloaded` plus explicit UI, canvas, or app-readiness checks instead.

For effect or rendering work that is hard to trigger through normal play, prefer adding or using a narrow `/dev/...` route with a deterministic test layout and explicit browser hooks. For example, `/dev/effects` supports free placement of enemy death splatters and test enemy kills against known void cutouts. This is most helpful for visual placement, clipping, shader, and asset-loading checks; use simulation/unit tests instead for deterministic gameplay rules, event emission, and balance behavior.

Use `tmp/` for temporary files, including verification screenshots and other disposable artifacts.

Runtime assets under `public/assets/` are tracked with Git LFS, while `public/assets/_staged/` remains local and ignored. Treat LFS assets differently from ordinary source changes: iterate on experimental or generated assets in `_staged`, and only promote final deployment candidates into live `public/assets/`.

Before committing or pushing changes that touch LFS-tracked assets (`.glb`, images, audio), check `git lfs status`, `git lfs ls-files`, and `git diff --stat`. Local commits do not upload LFS objects, but pushing multiple commits containing different versions of the same binary will upload each version. Before any requested push that includes asset changes, remind the user to squash/rebase or `git reset --soft origin/main` when appropriate so only the intended final asset versions are pushed.
