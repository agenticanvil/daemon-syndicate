import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = ""] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const baseUrl = args.get("url") || process.env.PERF_URL || "http://127.0.0.1:5173";
const durationMs = Number(args.get("duration") || process.env.PERF_DURATION || 15000);
const warmupMs = Number(args.get("warmup") || process.env.PERF_WARMUP || 1000);
const seed = args.get("seed") || process.env.PERF_SEED || "perf";
const viewportWidth = Number(args.get("width") || process.env.PERF_WIDTH || 1440);
const viewportHeight = Number(args.get("height") || process.env.PERF_HEIGHT || 900);
const deviceScaleFactor = Number(args.get("device-scale-factor") || process.env.PERF_DEVICE_SCALE_FACTOR || 1);
const envHeadless =
  process.env.PERF_HEADLESS === undefined ? process.env.CI === "true" : parseBoolean(process.env.PERF_HEADLESS);
const headless = args.has("headed") ? false : readBooleanArg("headless", envHeadless);
const browserChannel = args.get("channel") || process.env.PERF_BROWSER_CHANNEL || (headless ? undefined : "chrome");
const outDir = resolve("tmp/perf");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const tracePath = resolve(outDir, `trace-${timestamp}.json`);
const summaryPath = resolve(outDir, `summary-${timestamp}.json`);
const fpsPath = resolve(outDir, `fps-${timestamp}.json`);
const reportPath = resolve(outDir, `report-${timestamp}.html`);

await mkdir(outDir, { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage({
  viewport: { width: viewportWidth, height: viewportHeight },
  deviceScaleFactor,
});

try {
  const url = new URL(baseUrl);
  url.searchParams.set("perf", "1");
  url.searchParams.set("autostart", "1");
  url.searchParams.set("seed", seed);

  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__daemonPerf?.enabled));
  await page.waitForTimeout(warmupMs);
  await page.evaluate(() => window.__daemonPerf?.reset());
  await page.evaluate(() => {
    window.__daemonFpsSamples = [];
    window.__daemonFpsStart = performance.now();
    window.__daemonFpsLast = undefined;
    const tick = (timestamp) => {
      if (window.__daemonFpsLast !== undefined) {
        window.__daemonFpsSamples.push(timestamp - window.__daemonFpsLast);
      }
      window.__daemonFpsLast = timestamp;
      window.__daemonFpsRaf = requestAnimationFrame(tick);
    };
    window.__daemonFpsRaf = requestAnimationFrame(tick);
  });

  await page.keyboard.down("w");
  await page.keyboard.down("d");

  const startedAt = Date.now();
  let step = 0;
  while (Date.now() - startedAt < durationMs) {
    const angle = step * 0.42;
    const x = 720 + Math.cos(angle) * 320;
    const y = 450 + Math.sin(angle) * 220;
    await page.mouse.move(x, y);
    if (step % 3 === 0) {
      await page.mouse.click(x, y, { button: "left" });
    }
    if (step % 15 === 0) {
      await page.keyboard.press("Space");
    }
    step += 1;
    await page.waitForTimeout(100);
  }

  await page.keyboard.up("w");
  await page.keyboard.up("d");

  const result = await page.evaluate(() => ({
    elapsedMs: performance.now() - window.__daemonFpsStart,
    fpsIntervals: window.__daemonFpsSamples,
    summary: window.__daemonPerf?.summary(),
    trace: window.__daemonPerf?.exportTrace(),
  }));
  await page.evaluate(() => {
    if (window.__daemonFpsRaf) cancelAnimationFrame(window.__daemonFpsRaf);
  });

  const fpsProfile = createFpsProfile(result.fpsIntervals, result.elapsedMs);
  const runMetadata = {
    browser: {
      channel: browserChannel || "chromium",
      headless,
      viewport: `${viewportWidth}x${viewportHeight}`,
      deviceScaleFactor,
    },
    url: url.toString(),
    seed,
    warmupMs,
    durationMs: Math.round(result.elapsedMs),
  };
  await writeFile(summaryPath, `${JSON.stringify(result.summary, null, 2)}\n`);
  await writeFile(tracePath, `${JSON.stringify(result.trace)}\n`);
  await writeFile(
    fpsPath,
    `${JSON.stringify(
      {
        ...runMetadata,
        fps: fpsProfile,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    reportPath,
    createHtmlReport({
      fps: fpsProfile,
      cpu: result.summary,
      metadata: runMetadata,
      paths: {
        fps: fpsPath,
        summary: summaryPath,
        trace: tracePath,
      },
    }),
  );

  console.log(`Perf summary: ${summaryPath}`);
  console.log(`Perf trace: ${tracePath}`);
  console.log(`FPS profile: ${fpsPath}`);
  console.log(`HTML report: ${reportPath}`);
  console.log(JSON.stringify({ fps: fpsProfile, cpu: result.summary }, null, 2));
} finally {
  await browser.close();
}

async function launchBrowser() {
  const options = { headless };
  if (browserChannel && browserChannel !== "chromium") {
    options.channel = browserChannel;
  }

  try {
    return await chromium.launch(options);
  } catch (error) {
    if (!options.channel) throw error;
    console.warn(`Could not launch Chrome channel "${options.channel}", falling back to bundled Chromium.`);
    return chromium.launch({ headless });
  }
}

function createFpsProfile(intervals, elapsedMs) {
  const frameIntervals = intervals.filter((value) => Number.isFinite(value) && value > 0);
  const fpsValues = frameIntervals.map((interval) => 1000 / interval);

  return {
    frames: frameIntervals.length + 1,
    fpsByElapsed: round((frameIntervals.length + 1) / (elapsedMs / 1000)),
    rafIntervalMs: summarize(frameIntervals),
    instantaneousFps: summarize(fpsValues),
    intervalBuckets: {
      le8_34: frameIntervals.filter((interval) => interval <= 8.34).length,
      gt8_34_le16_67: frameIntervals.filter((interval) => interval > 8.34 && interval <= 16.67).length,
      gt16_67_le25: frameIntervals.filter((interval) => interval > 16.67 && interval <= 25).length,
      gt25_le33_34: frameIntervals.filter((interval) => interval > 25 && interval <= 33.34).length,
      gt33_34: frameIntervals.filter((interval) => interval > 33.34).length,
    },
  };
}

function createHtmlReport({ fps, cpu, metadata, paths }) {
  const interpretation = interpretPerformance(fps, cpu);
  const spans = Object.entries(cpu?.spans ?? {})
    .sort(([, a], [, b]) => b.p95 - a.p95)
    .map(([name, stat]) => ({ name, ...stat }));
  const topSpans = spans.slice(0, 8);
  const bucketTotal = Math.max(
    1,
    Object.values(fps.intervalBuckets).reduce((sum, value) => sum + value, 0),
  );
  const generatedAt = new Date().toLocaleString();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Daemon Syndicate Performance Report</title>
  <style>
    :root {
      color: #dceff3;
      background: #050708;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-synthesis: none;
      text-rendering: optimizeLegibility;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background:
        radial-gradient(circle at 18% 0%, rgba(94, 236, 218, 0.12), transparent 28rem),
        radial-gradient(circle at 86% 12%, rgba(255, 200, 87, 0.08), transparent 24rem),
        linear-gradient(135deg, #050708 0%, #101414 58%, #070809 100%);
      color: #dceff3;
    }

    main {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 34px 0 44px;
    }

    header {
      display: grid;
      gap: 14px;
      margin-bottom: 18px;
    }

    h1, h2, p { margin: 0; }

    h1 {
      color: #f6feff;
      font-size: clamp(2rem, 5vw, 4.4rem);
      line-height: 0.95;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    h2 {
      color: #f6feff;
      font-size: 0.88rem;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .summary {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
      gap: 14px;
      align-items: stretch;
    }

    .panel, .metric, .note, .artifact {
      border: 1px solid rgba(151, 255, 237, 0.16);
      background: rgba(4, 10, 12, 0.72);
      box-shadow: inset 0 0 30px rgba(79, 236, 224, 0.045);
    }

    .panel {
      padding: 16px;
    }

    .hero {
      display: grid;
      align-content: space-between;
      min-height: 245px;
      border-color: ${interpretation.border};
      background:
        linear-gradient(135deg, ${interpretation.tint}, rgba(4, 10, 12, 0.75)),
        rgba(4, 10, 12, 0.72);
    }

    .status {
      display: inline-flex;
      width: fit-content;
      align-items: center;
      gap: 8px;
      border: 1px solid ${interpretation.border};
      color: ${interpretation.accent};
      padding: 6px 9px;
      font-size: 0.74rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .status::before {
      width: 8px;
      height: 8px;
      background: ${interpretation.accent};
      content: "";
    }

    .big-number {
      margin-top: 18px;
      color: #f6feff;
      font-size: clamp(4.6rem, 13vw, 9rem);
      font-weight: 850;
      line-height: 0.8;
      font-variant-numeric: tabular-nums;
    }

    .label {
      color: #8ea8ac;
      font-size: 0.72rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .hero-copy {
      max-width: 66ch;
      color: #c8dde0;
      line-height: 1.55;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .metric {
      min-height: 112px;
      padding: 12px;
    }

    .metric strong {
      display: block;
      margin-top: 9px;
      color: #f6feff;
      font-size: 1.75rem;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }

    .metric span {
      display: block;
      margin-top: 8px;
      color: #91a8ac;
      font-size: 0.78rem;
      line-height: 1.35;
    }

    .section-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-top: 14px;
    }

    .wide {
      grid-column: 1 / -1;
    }

    .bar-list {
      display: grid;
      gap: 9px;
      margin-top: 14px;
    }

    .bar-row {
      display: grid;
      grid-template-columns: 120px minmax(0, 1fr) 54px;
      gap: 10px;
      align-items: center;
      color: #b9d0d4;
      font-size: 0.78rem;
    }

    .bar-track {
      height: 10px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.08);
    }

    .bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #55e7d4, #ffe078);
    }

    table {
      width: 100%;
      margin-top: 12px;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
    }

    th, td {
      border-bottom: 1px solid rgba(151, 255, 237, 0.1);
      padding: 9px 8px;
      text-align: right;
      white-space: nowrap;
    }

    th:first-child, td:first-child {
      text-align: left;
      white-space: normal;
    }

    th {
      color: #8ea8ac;
      font-size: 0.68rem;
      text-transform: uppercase;
    }

    td {
      color: #e8f7ff;
      font-size: 0.82rem;
    }

    .notes {
      display: grid;
      gap: 10px;
      margin-top: 14px;
    }

    .note {
      padding: 12px;
      color: #c8dde0;
      line-height: 1.45;
    }

    .artifacts {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 12px;
    }

    .artifact {
      display: grid;
      gap: 5px;
      padding: 12px;
      color: #dceff3;
      text-decoration: none;
    }

    .artifact strong {
      color: #f6feff;
      font-size: 0.82rem;
      text-transform: uppercase;
    }

    .artifact span {
      overflow: hidden;
      color: #8ea8ac;
      font-size: 0.72rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .metadata {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: #8ea8ac;
      font-size: 0.76rem;
    }

    .metadata span {
      border: 1px solid rgba(151, 255, 237, 0.12);
      background: rgba(255, 255, 255, 0.035);
      padding: 5px 7px;
    }

    @media (max-width: 860px) {
      main { width: min(100% - 20px, 1180px); padding-top: 20px; }
      .summary, .section-grid, .artifacts { grid-template-columns: 1fr; }
      .metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .bar-row { grid-template-columns: 92px minmax(0, 1fr) 44px; }
    }

    @media (max-width: 560px) {
      .metrics-grid { grid-template-columns: 1fr; }
      th, td { padding-inline: 5px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Performance Report</h1>
      <div class="metadata">
        <span>${escapeHtml(generatedAt)}</span>
        <span>${escapeHtml(metadata.browser.channel)} ${metadata.browser.headless ? "headless" : "headed"}</span>
        <span>${escapeHtml(metadata.browser.viewport)} @ ${metadata.browser.deviceScaleFactor}x</span>
        <span>seed ${escapeHtml(metadata.seed)}</span>
        <span>${formatMs(metadata.durationMs)} sample after ${formatMs(metadata.warmupMs)} warmup</span>
      </div>
    </header>

    <section class="summary">
      <article class="panel hero">
        <div>
          <div class="status">${escapeHtml(interpretation.status)}</div>
          <div class="big-number">${formatNumber(fps.instantaneousFps.p50, 0)}</div>
          <div class="label">median displayed FPS</div>
        </div>
        <p class="hero-copy">${escapeHtml(interpretation.summary)}</p>
      </article>

      <aside class="metrics-grid">
        ${metric("Average FPS", formatNumber(fps.fpsByElapsed, 1), "Whole-run average from elapsed time.")}
        ${metric("rAF p95", `${formatNumber(fps.rafIntervalMs.p95, 1)}ms`, "Player-visible frame interval tail.")}
        ${metric("CPU p95", `${formatNumber(cpu.frameMs.p95, 1)}ms`, "Game frame CPU work, after warmup.")}
        ${metric("Render p95", `${formatNumber(cpu.spans?.["three.render.cpu"]?.p95 ?? 0, 1)}ms`, "CPU time spent issuing Three.js render.")}
      </aside>
    </section>

    <section class="section-grid">
      <article class="panel">
        <h2>Frame Pacing</h2>
        <div class="bar-list">
          ${bucket("<= 8.34ms", fps.intervalBuckets.le8_34, bucketTotal)}
          ${bucket("8.34-16.67ms", fps.intervalBuckets.gt8_34_le16_67, bucketTotal)}
          ${bucket("16.67-25ms", fps.intervalBuckets.gt16_67_le25, bucketTotal)}
          ${bucket("25-33.34ms", fps.intervalBuckets.gt25_le33_34, bucketTotal)}
          ${bucket("> 33.34ms", fps.intervalBuckets.gt33_34, bucketTotal)}
        </div>
      </article>

      <article class="panel">
        <h2>Readout</h2>
        <table>
          <tbody>
            ${readoutRow("Frames", fps.frames)}
            ${readoutRow("rAF p50", `${formatNumber(fps.rafIntervalMs.p50, 2)}ms`)}
            ${readoutRow("rAF p99", `${formatNumber(fps.rafIntervalMs.p99, 2)}ms`)}
            ${readoutRow("CPU frame p50", `${formatNumber(cpu.frameMs.p50, 2)}ms`)}
            ${readoutRow("CPU frame p99", `${formatNumber(cpu.frameMs.p99, 2)}ms`)}
            ${readoutRow("CPU frame max", `${formatNumber(cpu.frameMs.max, 2)}ms`)}
          </tbody>
        </table>
      </article>

      <article class="panel wide">
        <h2>Slowest CPU Spans by p95</h2>
        <table>
          <thead>
            <tr><th>Span</th><th>Avg</th><th>p50</th><th>p95</th><th>p99</th><th>Max</th></tr>
          </thead>
          <tbody>
            ${topSpans.map((span) => spanRow(span)).join("")}
          </tbody>
        </table>
      </article>

      <article class="panel wide">
        <h2>Interpretation</h2>
        <div class="notes">
          ${interpretation.notes.map((note) => `<div class="note">${escapeHtml(note)}</div>`).join("")}
        </div>
      </article>

      <article class="panel wide">
        <h2>Artifacts</h2>
        <div class="artifacts">
          ${artifact("FPS JSON", paths.fps)}
          ${artifact("CPU Summary", paths.summary)}
          ${artifact("Trace JSON", paths.trace)}
        </div>
      </article>
    </section>
  </main>
</body>
</html>
`;
}

function interpretPerformance(fps, cpu) {
  const medianFps = fps.instantaneousFps.p50;
  const averageFps = fps.fpsByElapsed;
  const p95Interval = fps.rafIntervalMs.p95;
  const cpuP95 = cpu?.frameMs?.p95 ?? 0;
  const renderP95 = cpu?.spans?.["three.render.cpu"]?.p95 ?? 0;
  const longFrames = fps.intervalBuckets.gt16_67_le25 + fps.intervalBuckets.gt25_le33_34 + fps.intervalBuckets.gt33_34;
  const refreshLabel = medianFps >= 100 ? "120 FPS" : medianFps >= 55 ? "60 FPS" : `${formatNumber(medianFps, 0)} FPS`;

  if (medianFps >= 110 && p95Interval <= 12 && cpuP95 <= 4) {
    return {
      status: "Excellent",
      accent: "#72ffcf",
      border: "rgba(114, 255, 207, 0.46)",
      tint: "rgba(43, 236, 180, 0.13)",
      summary: `This run is pacing at roughly ${refreshLabel}. The game loop has substantial CPU headroom, and the displayed frame intervals are tightly clustered.`,
      notes: [
        `Median displayed FPS is ${formatNumber(medianFps, 1)} with rAF p95 at ${formatNumber(p95Interval, 2)}ms.`,
        `CPU frame p95 is ${formatNumber(cpuP95, 2)}ms; Three.js render p95 is ${formatNumber(renderP95, 2)}ms.`,
        longFrames > 0
          ? `${longFrames} intervals exceeded the 60 FPS budget. Inspect the trace only if those line up with visible stutter.`
          : "No intervals exceeded the 60 FPS budget during the measured sample.",
      ],
    };
  }

  if (medianFps >= 55 && p95Interval <= 20) {
    return {
      status: "Good",
      accent: "#ffe078",
      border: "rgba(255, 224, 120, 0.42)",
      tint: "rgba(255, 200, 87, 0.11)",
      summary: `This run is stable around ${refreshLabel}. There is enough headroom for 60 FPS, but the report still shows some pacing variance worth watching.`,
      notes: [
        `Average FPS is ${formatNumber(averageFps, 1)} and median displayed FPS is ${formatNumber(medianFps, 1)}.`,
        `CPU frame p95 is ${formatNumber(cpuP95, 2)}ms; if visual stutter appears, compare this with rAF interval spikes.`,
        "Use the trace artifact to inspect isolated long frames before optimizing steady-state systems.",
      ],
    };
  }

  return {
    status: "Needs attention",
    accent: "#ff7474",
    border: "rgba(255, 116, 116, 0.48)",
    tint: "rgba(255, 116, 116, 0.12)",
    summary: `This run is below a stable 60 FPS target. The next step is to compare rAF spikes with CPU span spikes in the trace.`,
    notes: [
      `Median displayed FPS is ${formatNumber(medianFps, 1)} and rAF p95 is ${formatNumber(p95Interval, 2)}ms.`,
      `CPU frame p95 is ${formatNumber(cpuP95, 2)}ms; Three.js render p95 is ${formatNumber(renderP95, 2)}ms.`,
      "If CPU spans stay low while rAF intervals are high, suspect browser/GPU/presentation constraints before rewriting gameplay systems.",
    ],
  };
}

function metric(label, value, detail) {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

function bucket(label, count, total) {
  const percent = round((count / total) * 100);
  return `<div class="bar-row"><span>${escapeHtml(label)}</span><div class="bar-track"><div class="bar-fill" style="width: ${percent}%"></div></div><strong>${formatNumber(percent, 0)}%</strong></div>`;
}

function readoutRow(label, value) {
  return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(String(value))}</td></tr>`;
}

function spanRow(span) {
  return `<tr><td>${escapeHtml(span.name)}</td><td>${formatNumber(span.avg, 2)}</td><td>${formatNumber(span.p50, 2)}</td><td>${formatNumber(span.p95, 2)}</td><td>${formatNumber(span.p99, 2)}</td><td>${formatNumber(span.max, 2)}</td></tr>`;
}

function artifact(label, path) {
  const href = `./${escapeHtml(path.split("/").at(-1))}`;
  return `<a class="artifact" href="${href}"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(path)}</span></a>`;
}

function summarize(values) {
  if (values.length === 0) {
    return { count: 0, avg: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    avg: round(total / sorted.length),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
  };
}

function percentile(sorted, percent) {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percent) - 1);
  return sorted[Math.max(0, index)];
}

function readBooleanArg(name, fallback) {
  if (!args.has(name)) return fallback;
  return parseBoolean(args.get(name));
}

function parseBoolean(value) {
  if (value === "" || value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no") return false;
  return Boolean(value);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function formatMs(value) {
  return `${formatNumber(value, 0)}ms`;
}

function formatNumber(value, digits) {
  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
