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

- `npm test` passes with 5 files and 14 tests.
- `npm run build` passes.
- Browser page-load smoke against `http://127.0.0.1:5173/?autostart=1&seed=event-queue-smoke` confirmed the HUD and canvas render. Active browser input automation timed out, so no active combat screenshot was kept for this step.

## In Progress: Typed Asset Data, Definition-Driven Drops, And Enemy Attacks

Goal: make asset-authored data scalable without forcing every asset to carry the same fields.

Completed in the current pass:

- Added shared `AssetSettings` types with `enemy`, `pickup`, and `player` variants.
- Added `kind` to every asset settings JSON.
- Removed placeholder `health`/`speed` fields from pickups and replaced them with resource grant data.
- Moved enemy movement speed into `movement.speed` with `movement.waveSpeedGrowth`.
- Added enemy `attacks` and `dropTable` defaults to asset JSON for the next runtime migration.
- Updated the asset editor to show kind-specific controls:
  - Common: collision radius and preview/render controls.
  - Enemy/player: health and movement speed.
  - Pickup: health, ammo, and energy grants.
- Updated the Vite asset-settings middleware to validate/normalize by `kind`.
- Updated pickup drops to read pickup grant amount and lifetime from pickup asset settings.

Remaining issue:

- Pickup drop odds still live globally in `DROP_BALANCE`.
- Enemy attack damage/cooldown/range is global in `ENEMY_BALANCE`.
- Enemy definitions still duplicate wave health growth and spawn weights outside asset settings.

Remaining steps:

1. Move enemy death drop selection from `DROP_BALANCE` into each enemy `dropTable`.
2. Move enemy attack damage/cooldown/range from `ENEMY_BALANCE` into each enemy `attacks` entry.
3. Build runtime `EnemyDefinition` values from `EnemyAssetSettings` rather than duplicating scaling constants.
4. Expand the asset editor with enemy attack and drop-table editing when those runtime fields are actively used.
5. Preserve current gameplay behavior as the default during migration.

Future benefits:

- Asset data can grow by domain without bloating every asset.
- The editor can stay explicit and ergonomic as assets become more specialized.
- Ranged enemies can drop ammo less often.
- Elites can drop larger pickups or guaranteed energy.
- Bosses can use different attack cadence/range.
- Pickups can grant multiple resources or different amounts without hardcoded drop-balance branches.

Risks:

- Avoid building a generic form system too early. A small registry per `kind` is enough:
  `enemy`, `pickup`, and `player`.
- Keep runtime systems consuming domain-specific settings, not editor UI state.
- Do not mix spawn weighting, drop tables, and pickup grant values into one generic "loot" abstraction until there are multiple real cases.

Verification:

- `npm test` passes with 5 files and 14 tests.
- `npm run build` passes.
- Asset editor page-load smoke against `/dev/asset-renderer?asset=health-pickup` confirmed the canvas renders and pickup resource controls are visible while health/movement fields are hidden.
- Save-endpoint behavior requires a dev-server restart to pick up the updated Vite middleware; the server was not restarted in this pass.

## Phase 5: Resource And Status Effect Model

Goal: make player/enemy modifiers explicit instead of scattering timers and hardcoded state checks.

Current issue:

- Player invulnerability is `Game.invulnTimer`.
- Low health is checked in multiple places.
- Future effects like slow, burn, stun, armor, shield, haste, damage-over-time, or buffs need a shared model.

Proposed shape:

```ts
type StatusEffect = {
  kind: "invulnerable" | "slow" | "burn" | "stun" | "shield";
  remaining: number;
  magnitude?: number;
  sourceId?: number;
};
```

Steps:

1. Add a small `statusEffects.ts` helper for ticking effects and querying flags.
2. Replace `invulnTimer` with a player status effect.
3. Add enemy status effect arrays only when a real enemy effect is introduced.
4. Keep resource regeneration in `Game` or move it to `playerSystem.ts`.

Verification:

- Player still takes damage no faster than the current invulnerability window.
- HUD readiness and health color behavior stay unchanged.

## Phase 6: Split Player System

Goal: move player-specific simulation out of `Game`.

Current issue:

- `Game` still owns input interpretation, movement, aim, camera follow, player resource regen, player damage state, and player rig update orchestration.

Suggested split:

- `InputState`: keys, pointer screen/world, action requests.
- `PlayerSystem`: movement, aim yaw, resources, damage/status.
- `CameraSystem`: camera follow and resize interaction remains in scene/renderer.

Steps:

1. Extract key/pointer handling into `inputState.ts`.
2. Move `getMovementInput`, `applyMovement`, `updatePlayerAim`, `regenerate`, and player damage color state into `PlayerSystem`.
3. Keep `Game` as the frame-order coordinator.
4. Preserve UI movement mode access, or copy UI setting into input state when changed.

Verification:

- WASD movement modes still behave the same.
- Mouse aim still rotates player correctly.
- Gate transitions still trigger.
- Energy regen still updates HUD.

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
- Asset renderer route still works.
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

1. Complete Phase 1 only: enemy domain/view split.
2. Preserve behavior.
3. Verify with build and browser smoke.

Reason:

- Enemy domain/view split is the last major architecture blocker before tests and event hooks become straightforward.
- Doing tests first is possible, but enemies are still renderer-coupled, so test value would be limited.

## Standard Verification Checklist

Run this before finishing each phase:

```sh
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
