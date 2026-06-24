# Performance Instrumentation

Daemon Syndicate includes lightweight frame and span timing instrumentation for profiling gameplay performance. It is disabled by default and only records when the game is opened with `?perf=1`.

## Quick Run

Use the existing local dev server, then run:

```sh
npm run perf -- --duration=30000
```

The runner opens the game with:

```text
/?perf=1&autostart=1&seed=perf
```

It drives a repeatable gameplay sample with Playwright and writes artifacts to:

```text
tmp/perf/
```

Each run produces:

- `summary-*.json`: frame timing and named span statistics.
- `trace-*.json`: Chrome Trace JSON for flamegraph-style inspection.

## Manual Browser Use

Open the game with tracing enabled:

```text
/?perf=1
```

Useful query parameters:

- `perf=1`: enables the recorder.
- `autostart=1`: starts a run automatically.
- `seed=perf`: makes random spawning deterministic for comparisons.

From the browser console:

```js
window.__daemonPerf.summary()
window.__daemonPerf.exportTrace()
window.__daemonPerf.reset()
```

`summary()` returns aggregate frame stats and per-system spans. `exportTrace()` returns a Chrome Trace payload that can be saved and opened in Perfetto or Chrome tracing.

## What Is Measured

The recorder wraps the main animation frame and selected gameplay systems in `src/game.ts`:

- `frame`: total measured work inside the game frame.
- `timers`
- `regenerate`
- `movement`
- `camera`
- `pointer.world`
- `player.aim`
- `player.rig`
- `spawning`
- `projectiles`
- `enemies`
- `pickups`
- `effects/dom`
- `hud/dom`
- `three.render.cpu`

Frame trace events also include useful context such as `dtMs`, paused/started state, enemy and projectile counts, level, wave, kills, render calls, triangles, geometries, and textures.

## Reading Results

Use `summary-*.json` first for a quick regression check:

- `avg`: overall average duration.
- `p50`: typical frame or span duration.
- `p95` and `p99`: tail latency; usually more important than average for visible stutter.
- `max`: worst recorded sample.

Short captures can be dominated by startup or first-render work. For meaningful comparisons, prefer 15-30 second runs with the same seed and similar gameplay conditions.

Use `trace-*.json` when you need to inspect where time is spent across frames. Open it in:

```text
https://ui.perfetto.dev/
```

or Chrome's tracing viewer, then look for long `frame` events and the nested game-system spans around them.

## Implementation Notes

The recorder lives in `src/perf.ts`. `createPerfRecorder(false)` returns a no-op implementation, so normal gameplay avoids collecting timing arrays or trace events.

The automated runner is `scripts/perf-run.mjs`. It accepts:

- `--url=http://127.0.0.1:5173`
- `--duration=30000`
- `--seed=perf`

The same values can be provided with `PERF_URL`, `PERF_DURATION`, and `PERF_SEED`.
