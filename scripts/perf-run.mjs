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
const seed = args.get("seed") || process.env.PERF_SEED || "perf";
const outDir = resolve("tmp/perf");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const tracePath = resolve(outDir, `trace-${timestamp}.json`);
const summaryPath = resolve(outDir, `summary-${timestamp}.json`);

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

try {
  const url = new URL(baseUrl);
  url.searchParams.set("perf", "1");
  url.searchParams.set("autostart", "1");
  url.searchParams.set("seed", seed);

  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__daemonPerf?.enabled));

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
    summary: window.__daemonPerf?.summary(),
    trace: window.__daemonPerf?.exportTrace(),
  }));

  await writeFile(summaryPath, `${JSON.stringify(result.summary, null, 2)}\n`);
  await writeFile(tracePath, `${JSON.stringify(result.trace)}\n`);

  console.log(`Perf summary: ${summaryPath}`);
  console.log(`Perf trace: ${tracePath}`);
  console.log(JSON.stringify(result.summary, null, 2));
} finally {
  await browser.close();
}
