# Daemon Syndicate Refactor Continuation Plan

This plan continues from the current architecture after the latest refactor pass:

- `Game` is now mostly orchestration.
- Gameplay tuning lives in `src/balance.ts`.
- Enemy and ability behavior are definition-driven through `src/enemyDefinitions.ts` and `src/weaponDefinitions.ts`.
- Projectiles and pickups now have separate domain state and Three.js view handles.
- Enemies, projectiles, and pickups now all keep domain state separate from runtime Three.js views.
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

## Next: Typed Asset Data, Definition-Driven Drops, And Enemy Attacks

Goal: make asset-authored data scalable without forcing every asset to carry the same fields.

Current issue:

- The asset editor currently treats settings as one shared shape.
- That led to non-enemy assets needing placeholder movement speed values.
- Future asset types will need different data: enemies need movement, attacks, AI, and drop tables; pickups need resource grants; players need max resources and movement/combat defaults.
- Pickup drop odds live globally in `DROP_BALANCE`.
- Enemy attack damage/cooldown/range is global in `ENEMY_BALANCE`.
- Enemy definitions only describe spawn/scaling/view creation.

Recommended data model:

Use discriminated settings JSON with a `kind` field and type-specific sections.

```ts
type AssetSettings = EnemyAssetSettings | PickupAssetSettings | PlayerAssetSettings;

type EnemyAssetSettings = {
  kind: "enemy";
  collision: CollisionSettings;
  health: number;
  movement: {
    speed: number;
    waveSpeedGrowth: number;
  };
  attacks: EnemyAttackDefinition[];
  dropTable: DropTable;
};

type PickupAssetSettings = {
  kind: "pickup";
  collision: CollisionSettings;
  resources: Partial<Record<ResourceKind, number>>;
  lifetime?: number;
};

type PlayerAssetSettings = {
  kind: "player";
  collision: CollisionSettings;
  health: number;
  movement?: {
    speed: number;
  };
};
```

Proposed additions:

```ts
type DropTable = {
  chance: number;
  entries: Array<{ kind: ResourceKind; weight: number; amount: number }>;
};

type EnemyAttackDefinition = {
  kind: "melee" | "ranged";
  damage: number;
  cooldown: number;
  range: number;
  projectileSpeed?: number;
  windup?: number;
};
```

Steps:

1. Add `kind` to each asset settings JSON.
2. Replace the current universal `EditableAssetSettings` with a discriminated `AssetSettings` union.
3. Update the Vite asset-settings middleware to dispatch validation/normalization by `kind`.
4. Update the asset editor to render common sections plus kind-specific forms:
   - Common: collision and preview/render controls.
   - Enemy: health, movement speed, wave scaling, attacks, drop table.
   - Pickup: resource grant amounts and lifetime.
   - Player: health, collision, and player-only movement/combat fields when needed.
5. Remove placeholder fields from unrelated assets, such as `speed: 0` on pickups.
6. Move current global drop odds into enemy `dropTable` defaults.
7. Move current enemy attack settings into enemy `attacks` defaults.
8. Build runtime `EnemyDefinition` values from `EnemyAssetSettings` instead of duplicating speed/attack/drop constants.
9. Update `PickupSystem` to read pickup resource grants from `PickupAssetSettings.resources`.
10. Preserve current behavior as the default during migration.

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

- Asset editor can load, edit, save, and reload each asset kind.
- Enemy speed/health behavior matches current values after migration.
- Pickup drops grant the same resource amounts as before unless intentionally changed.
- `npm test` and `npm run build` pass.

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
