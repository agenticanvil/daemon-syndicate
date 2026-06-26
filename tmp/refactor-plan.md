# Daemon Syndicate Refactor Continuation Plan

This plan continues from the current architecture after the latest refactor pass:

- `Game` is now mostly orchestration.
- Gameplay tuning lives in `src/balance.ts`.
- Enemy and ability behavior are definition-driven through `src/enemyDefinitions.ts` and `src/weaponDefinitions.ts`.
- Projectiles and pickups now have separate domain state and Three.js view handles.
- Enemies, projectiles, and pickups now all keep domain state separate from runtime Three.js views.
- Asset settings JSON is now discriminated by asset kind.
- Focused Vitest coverage now protects pathfinding, movement, weapon definitions, enemy definitions, and runtime event queue behavior.

## Completed: Split Enemy Domain State From Views

Enemy AI, damage, collision, pathing, nova knockback, drops, and death cleanup now operate on plain `Enemy` domain state. `EnemySystem` owns runtime `EnemyView` handles in an id-keyed map and syncs view position/rotation from domain state after simulation.

Verification:

- `npm run build` passes.
- Browser smoke test used `/?autostart=1&seed=enemy-domain-smoke`, fired primary and nova at visible enemies, reached 3 kills, and confirmed pickup drops visually.
- Screenshot saved to `tmp/enemy-domain-smoke.png`.

## Completed: Add Focused Logic Tests

The project now has Vitest configured through `npm test`, with focused pure/domain tests for:

- `pathfinding.test.ts`: walkable path, unreachable target, and same-tile behavior.
- `movement.test.ts`: full movement, axis fallback, and blocked movement.
- `weaponDefinitions.test.ts`: ability cost/cooldown metadata, primary projectile drafts, and nova layer/radius filtering.
- `enemyDefinitions.test.ts`: current lean/elite scaling, positive spawn weights, and deterministic weighted selection with injected RNG.

Testability improvement completed:

- `chooseEnemyDefinition` accepts an optional RNG function while preserving `Math.random` as the default.

Verification:

- `npm test` passes with 4 files and 12 tests.
- `npm run build` passes.
- Browser smoke test used `/?autostart=1&seed=phase-2-tests-smoke`, fired primary and nova, and saved `tmp/phase-2-tests-smoke.png`.

## Completed: Introduce Runtime Event Hooks

Runtime side effects now flow through a small synchronous `EventQueue` instead of direct cross-system calls for damage text, enemy death drops, player damage flashes/game-over checks, and pickup resource grants.

Verification:

- `npm test` passes with 6 files and 17 tests.
- `npm run build` passes.
- Browser page-load smoke against `http://127.0.0.1:5173/?autostart=1&seed=event-queue-smoke` confirmed the HUD and canvas render. Active browser input automation timed out, so no active combat screenshot was kept for this step.

## Completed: Typed Asset Data, Definition-Driven Drops, And Enemy Attacks

Asset-authored data is now scalable without forcing every asset to carry the same fields.

Completed in this phase:

- Added shared `AssetSettings` types with `enemy`, `pickup`, and `player` variants.
- Added `kind` to every asset settings JSON.
- Removed placeholder `health`/`speed` fields from pickups and replaced them with resource grant data.
- Moved enemy movement speed into `movement.speed` with `movement.waveSpeedGrowth`.
- Added enemy `attacks` and `dropTable` defaults to asset JSON.
- Updated the asset editor to show kind-specific controls:
  - Common: collision radius and preview/render controls.
  - Enemy/player: health and movement speed.
  - Pickup: health, ammo, and energy grants.
- Updated the Vite asset-settings middleware to validate/normalize by `kind`.
- Updated pickup drops to read pickup grant amount and lifetime from pickup asset settings.
- Moved enemy death drop selection from `DROP_BALANCE` into each enemy `dropTable`.
- Moved enemy melee damage/cooldown/range from `ENEMY_BALANCE` into each enemy `attacks` entry.
- Runtime enemies now carry their attack and drop-table data from `EnemyDefinition`.
- Moved enemy base health, wave health growth, and spawn weighting into enemy asset settings.
- Runtime `EnemyDefinition` health and spawn-weight functions now derive from `EnemyAssetSettings`.
- Expanded the asset editor with enemy primary-attack and drop-table controls.

Verification:

- `npm test` passes with 5 files and 14 tests.
- `npm run build` passes.
- Browser smoke checked `/dev/asset-editor?asset=lean-hunter`; enemy combat controls rendered with current JSON values, pickup-only controls were hidden, editing damage changed the status to `Unsaved changes`, and screenshot was saved to `tmp/asset-editor-enemy-combat.png`.

## Completed: Resource And Status Effect Model

Player invulnerability now uses an explicit `invulnerable` status effect instead of a dedicated `Game.invulnTimer`. The new `statusEffects.ts` helper handles ticking, querying, and refreshing status effects, with enemy status arrays deferred until a real enemy effect is introduced.

Verification:

- `npm test` passes with 6 files and 17 tests.
- `npm run build` passes.
- Browser smoke checked `/?autostart=1&seed=status-effects-smoke`; the canvas and HUD rendered and no console errors were reported.

## In Progress: Split Player System

Goal: move player-specific simulation out of `Game`.

Current issue:

- `Game` still owns movement, aim, camera follow, player resource regen, player damage state, and player rig update orchestration.

Completed in this phase:

- Extracted key and pointer tracking into `src/inputState.ts`.
- `Game` now consumes `InputState` for movement input, pointer aiming, reticle reset, and firing targets.

Suggested split:

- `InputState`: keys, pointer screen/world, action requests.
- `PlayerSystem`: movement, aim yaw, resources, damage/status.
- `CameraSystem`: camera follow and resize interaction remains in scene/renderer.

Remaining steps:

1. Move `getMovementInput`, `applyMovement`, `updatePlayerAim`, `regenerate`, and player damage color state into `PlayerSystem`.
2. Keep `Game` as the frame-order coordinator.
3. Preserve UI movement mode access, or copy UI setting into input state when changed.

Verification:

- `npm test` passes with 6 files and 17 tests.
- `npm run build` passes.
- Browser smoke checked `/?autostart=1&seed=input-state-smoke`; the canvas and HUD rendered and no console errors were reported.

## Phase 7: Scene/Asset Factory Cleanup

Goal: keep renderer/scene construction separate from gameplay asset factories.

Current issue:

- `createGameScene` owns renderer, camera, lighting, level rendering, player creation, enemy creation, pickup creation, and shared materials.

Suggested split:

- `renderer.ts`: renderer/camera/resize.
- `materials.ts`: shared materials and disposal policy.
- `levelRenderer.ts`: `renderLevel`.
- `assetFactory.ts`: player/enemy/pickup view creation.

Steps:

1. Extract `renderLevel` first; it is self-contained.
2. Extract asset creation functions used by definitions/systems.
3. Keep `GameScene` as a facade until call sites are stable.

Verification:

- Level renders exactly as before.
- Asset editor route still works.
- Browser smoke test.

## Phase 8: Performance-Oriented Entity Pooling

Goal: reduce geometry/material churn once gameplay spawns more short-lived objects.

Current issue:

- Projectiles create/dispose geometry repeatedly.
- Nova creates/disposes ring geometry/material.
- Damage text creates/removes DOM nodes.
- Enemy/pickup assets are created per spawn/drop.

Recommended order:

1. Pool projectile meshes first.
2. Reuse projectile geometry and shared material.
3. Pool damage text DOM elements.
4. Consider pickup pooling after drops become frequent.
5. Do not pool enemies until enemy domain/view split is complete and measured.

Verification:

- Use existing perf recorder with `?perf=1`.
- Compare `renderer.info.memory.geometries`, `textures`, and frame spans before/after.

## Phase 9: Save/Replay/Debug Hooks

Goal: make the simulation inspectable and reproducible.

This becomes practical after domain state is separated from views.

Steps:

1. Replace direct `Math.random()` in gameplay systems with injected RNG.
2. Add a serializable snapshot of:
   - level id/seed
   - player state
   - enemies
   - projectiles
   - pickups
   - timers/status effects
3. Add debug helpers on `window.__daemonGame`:
   - `snapshot()`
   - `spawnEnemy(kind, tileOrWorldPosition)`
   - `grantResources(partialResources)`
4. Keep debug APIs behind dev mode if they grow.

Verification:

- Same seed + same input sequence should produce the same early run state.
- Snapshot should not include Three.js objects.

## Suggested Next Commit

Recommended next commit scope:

1. Finish Phase 4 runtime data migration:
   - Add spawn/scaling metadata to enemy asset settings.
   - Build `EnemyDefinition` values from a small helper that accepts `EnemyAssetSettings` plus view factory.
   - Remove duplicated spawn/health-growth constants from `enemyDefinitions.ts`.
2. Preserve current enemy health, speed, spawn weighting, attack, and drop behavior.
3. Verify with `npm test`, `npm run build`, and an asset editor smoke check.

Reason:

- Enemy attacks and drops already come from asset settings, but spawn/health-growth metadata still does not.
- Finishing this closes the runtime half of Phase 4 before broadening the editor UI for attack/drop-table editing.

## Standard Verification Checklist

Run this before finishing each phase:

```sh
npm test
npm run build
```

Then run a browser smoke test against the existing dev server:

- Load `http://127.0.0.1:5173/?autostart=1&seed=<phase-name>`
- Confirm one canvas exists.
- Confirm HUD is visible.
- Confirm health/ammo/energy/level values render.
- Fire primary.
- Fire nova.
- Wait at least one second.
- Save screenshot under `tmp/`.

For asset-data work, also load `http://127.0.0.1:5173/dev/asset-editor?asset=health-pickup` or an enemy asset URL and confirm the editor canvas and relevant kind-specific controls render.
