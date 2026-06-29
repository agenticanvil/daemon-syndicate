type PerfSummary = {
  enabled: boolean;
  frames: number;
  frameMs: StatSummary;
  spans: Record<string, StatSummary>;
};

type StatSummary = {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

type TraceEvent = {
  name: string;
  cat: string;
  ph: "X";
  pid: number;
  tid: number;
  ts: number;
  dur: number;
  args?: Record<string, number | string | boolean>;
};

export type PerfRecorder = {
  readonly enabled: boolean;
  frame: <T>(args: Record<string, number | string | boolean>, run: () => T) => T;
  span: <T>(name: string, run: () => T) => T;
  reset: () => void;
  summary: () => PerfSummary;
  exportTrace: () => { traceEvents: TraceEvent[]; displayTimeUnit: "ms" };
};

const TRACE_PID = 1;
const TRACE_TID = 1;
const MAX_FRAMES = 7200;

export function createPerfRecorder(enabled: boolean): PerfRecorder {
  if (!enabled) return new NoopPerfRecorder();
  return new TracePerfRecorder();
}

class NoopPerfRecorder implements PerfRecorder {
  readonly enabled = false;

  frame<T>(_args: Record<string, number | string | boolean>, run: () => T): T {
    return run();
  }

  span<T>(_name: string, run: () => T): T {
    return run();
  }

  reset(): void {}

  summary(): PerfSummary {
    return {
      enabled: false,
      frames: 0,
      frameMs: emptyStats(),
      spans: {},
    };
  }

  exportTrace(): { traceEvents: TraceEvent[]; displayTimeUnit: "ms" } {
    return { traceEvents: [], displayTimeUnit: "ms" };
  }
}

class TracePerfRecorder implements PerfRecorder {
  readonly enabled = true;

  private readonly events: TraceEvent[] = [];
  private readonly frameDurations: number[] = [];
  private readonly spanDurations = new Map<string, number[]>();
  private firstTimestamp = performance.now();

  frame<T>(args: Record<string, number | string | boolean>, run: () => T): T {
    const start = performance.now();
    try {
      return run();
    } finally {
      const duration = performance.now() - start;
      this.frameDurations.push(duration);
      this.events.push(toTraceEvent("frame", "frame", start - this.firstTimestamp, duration, args));
      this.trim();
    }
  }

  span<T>(name: string, run: () => T): T {
    const start = performance.now();
    try {
      return run();
    } finally {
      const duration = performance.now() - start;
      const durations = this.spanDurations.get(name) ?? [];
      durations.push(duration);
      this.spanDurations.set(name, durations);
      this.events.push(toTraceEvent(name, "game", start - this.firstTimestamp, duration));
    }
  }

  reset(): void {
    this.events.length = 0;
    this.frameDurations.length = 0;
    this.spanDurations.clear();
    this.firstTimestamp = performance.now();
  }

  summary(): PerfSummary {
    const spans: Record<string, StatSummary> = {};
    for (const [name, durations] of this.spanDurations) {
      spans[name] = summarize(durations);
    }

    return {
      enabled: true,
      frames: this.frameDurations.length,
      frameMs: summarize(this.frameDurations),
      spans,
    };
  }

  exportTrace(): { traceEvents: TraceEvent[]; displayTimeUnit: "ms" } {
    return {
      traceEvents: [...this.events].sort((a, b) => a.ts - b.ts),
      displayTimeUnit: "ms",
    };
  }

  private trim(): void {
    if (this.frameDurations.length <= MAX_FRAMES) return;

    const dropFrames = this.frameDurations.length - MAX_FRAMES;
    this.frameDurations.splice(0, dropFrames);
    for (const durations of this.spanDurations.values()) {
      durations.splice(0, Math.max(0, durations.length - MAX_FRAMES));
    }
    this.events.splice(0, Math.max(0, this.events.length - MAX_FRAMES * 16));
  }
}

function toTraceEvent(
  name: string,
  cat: string,
  startMs: number,
  durationMs: number,
  args?: Record<string, number | string | boolean>,
): TraceEvent {
  return {
    name,
    cat,
    ph: "X",
    pid: TRACE_PID,
    tid: TRACE_TID,
    ts: startMs * 1000,
    dur: durationMs * 1000,
    args,
  };
}

function summarize(values: number[]): StatSummary {
  if (values.length === 0) return emptyStats();

  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    avg: round(total / sorted.length),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted[sorted.length - 1]),
  };
}

function percentile(sorted: number[], percent: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percent) - 1);
  return sorted[Math.max(0, index)];
}

function emptyStats(): StatSummary {
  return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
