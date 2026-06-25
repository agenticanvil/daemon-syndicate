# Daemon Syndicate Refactor Continuation Plan

This plan continues from the current architecture after the latest refactor pass:

- `Game` is now mostly orchestration.
- Gameplay tuning lives in `src/balance.ts`.
- Enemy and ability behavior are definition-driven through `src/enemyDefinitions.ts` and `src/weaponDefinitions.ts`.
- Projectiles and pickups now have separate domain state and Three.js view handles.
- Enemies, projectiles, and pickups now all keep domain state separate from runtime Three.js views.

## Completed: Split Enemy Domain State From Views

Enemy AI, damage, collision, pathing, nova knockback, drops, and death cleanup now operate on plain `Enemy` domain state. `EnemySystem` owns runtime `EnemyView` handles in an id-keyed map and syncs view position/rotation from domain state after simulation.

Verification:

- `npm run build` passes.
- Browser smoke test used `/?autostart=1&seed=enemy-domain-smoke`, fired primary and nova at visible enemies, reached 3 kills, and confirmed pickup drops visually.
- Screenshot saved to `tmp/enemy-domain-smoke.png`.

## Next: Add Focused Logic Tests

Goal: protect the new pure/domain logic from regressions before larger gameplay changes.

Current issue:

- The project has no test runner.
- Refactors are verified through TypeScript build and browser smoke tests only.

Recommended setup:

- Add `vitest` for pure logic tests.
- Keep tests out of renderer-heavy paths at first.
- Do not introduce browser/component testing yet unless gameplay UI starts changing.

Suggested tests:

1. `pathfinding.test.ts`
   - Finds a path between two walkable tiles.
   - Returns `undefined` when target is unreachable.
   - Returns `[]` when start equals target.

2. `movement.test.ts`
   - `moveOnWalkableLevel` moves fully on walkable tiles.
   - Falls back to axis movement when the full move is blocked.
   - Refuses movement when both axes are blocked.

3. `weaponDefinitions.test.ts`
   - Ability readiness uses resource + cooldown.
   - Primary projectile draft has expected damage/radius/life/collision layer.
   - Nova damages only enemies in the same collision layer and radius.

4. `enemyDefinitions.test.ts`
   - Lean/elite scaling preserves current health and speed formulas.
   - Spawn weights remain positive.
   - Weighted enemy selection can be made deterministic if an injected RNG is added.

Testability improvement to consider:

- Inject RNG into enemy selection and drop selection instead of calling `Math.random()` directly.

Verification:

- `npm run build`
- `npm test`
- Existing smoke test.

## Phase 3: Introduce Runtime Event Hooks

Goal: reduce direct cross-system calls as gameplay expands.

Current issue:

- Combat directly calls `damageEnemy`.
- Enemy deaths directly call pickup drops.
- Enemy damage directly spawns damage text through effects.
- These direct calls are okay now, but status effects, score bonuses, audio, screen shake, achievements, missions, and analytics will multiply coupling.

Recommended minimal event model:

```ts
type GameEvent =
  | { type: "enemyDamaged"; enemyId: number; amount: number; position: THREE.Vector3 }
  | { type: "enemyKilled"; enemyId: number; kind: EnemyKind; position: THREE.Vector3 }
  | { type: "playerDamaged"; amount: number }
  | { type: "pickupCollected"; kind: ResourceKind; amount: number };
```

Steps:

1. Add `eventQueue.ts` with `emit(event)` and `drain()`.
2. Let systems emit events during updates.
3. Let `Game` or a small `EventSystem` process events after core simulation:
   - enemy killed -> increment kills, maybe drop pickup
   - enemy damaged -> spawn damage text
   - player damaged -> flash player material
4. Keep event handling synchronous and frame-local for now.

Verification:

- Existing gameplay behavior should remain unchanged.
- Perf spans should still show combat/enemies/pickups/effects separately.

Risks:

- Do not introduce an overly generic event bus with global subscriptions yet.
- Avoid async events; this is still a frame simulation.

## Phase 4: Add Definition-Driven Drops And Enemy Attacks

Goal: make drops and attacks configurable per enemy type.

Current issue:

- Pickup drop odds live globally in `DROP_BALANCE`.
- Enemy attack damage/cooldown/range is global in `ENEMY_BALANCE`.
- Enemy definitions only describe spawn/scaling/view creation.

Proposed additions:

```ts
type DropTable = {
  chance: number;
  entries: Array<{ kind: ResourceKind; weight: number; amount: number }>;
};

type EnemyAttackDefinition = {
  damage: number;
  cooldown: number;
  proximity: number;
};
```

Steps:

1. Add `dropTable` and `attack` to `EnemyDefinition`.
2. Move current global drop odds into a default drop table.
3. Move current enemy attack settings into a default melee attack definition.
4. Update `EnemySystem` and `PickupSystem` to use definitions.
5. Preserve current behavior as the default.

Future benefits:

- Ranged enemies can drop ammo less often.
- Elites can drop larger pickups or guaranteed energy.
- Bosses can use different attack cadence/range.

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
