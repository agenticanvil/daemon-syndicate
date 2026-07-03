type SoundUrl = `/assets/sfx/${string}.${"mp3" | "wav"}`;

const SOUND_URLS = {
  "primary-fire": "/assets/sfx/bolt-shot.mp3",
  "primary-impact": "/assets/sfx/primary-impact.wav",
  nova: "/assets/sfx/nova.wav",
  dash: "/assets/sfx/dash.wav",
  "player-hit": "/assets/sfx/player-hit.wav",
  "enemy-hit": "/assets/sfx/enemy-hit.wav",
  "enemy-death": "/assets/sfx/enemy-death.wav",
  "pickup-health": "/assets/sfx/pickup-health.wav",
  "pickup-ammo": "/assets/sfx/pickup-ammo.wav",
  "pickup-energy": "/assets/sfx/pickup-energy.wav",
  "level-transition": "/assets/sfx/level-transition.wav",
  "upgrade-select": "/assets/sfx/upgrade-select.wav",
  "ui-click": "/assets/sfx/ui-click.wav",
  "game-over": "/assets/sfx/game-over.wav",
  "hunter-moving": "/assets/sfx/hunter-moving.mp3",
} as const satisfies Record<string, SoundUrl>;

export type SoundId = keyof typeof SOUND_URLS;

export type AudioSettings = {
  muted: boolean;
  masterVolume: number;
  sfxVolume: number;
};

type PlaySoundOptions = {
  volume?: number;
  playbackRate?: number;
  pan?: number;
};

export type LoopingSound = {
  setVolume: (volume: number) => void;
  stop: () => void;
};

export type GameAudio = {
  preload: () => Promise<void>;
  resume: () => Promise<void>;
  play: (id: SoundId, options?: PlaySoundOptions) => void;
  playLoop: (id: SoundId, options?: PlaySoundOptions) => LoopingSound;
  applySettings: (settings: AudioSettings) => void;
};

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  muted: false,
  masterVolume: 0.82,
  sfxVolume: 0.9,
};

const MIN_SOUND_INTERVAL_MS: Partial<Record<SoundId, number>> = {
  "enemy-hit": 45,
  "primary-impact": 35,
  "pickup-health": 55,
  "pickup-ammo": 55,
  "pickup-energy": 55,
};

type WebAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export function createAudioSystem(): GameAudio {
  let context: AudioContext | undefined;
  let masterGain: GainNode | undefined;
  let sfxGain: GainNode | undefined;
  let loadPromise: Promise<void> | undefined;
  let settings = { ...DEFAULT_AUDIO_SETTINGS };
  const buffers = new Map<SoundId, AudioBuffer>();
  const lastPlayedAt = new Map<SoundId, number>();

  async function preload(): Promise<void> {
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
    if (!loadPromise) loadPromise = loadBuffers(ctx);
    await loadPromise;
  }

  async function resume(): Promise<void> {
    await preload();
    if (context?.state === "suspended") {
      await context.resume().catch(() => undefined);
    }
  }

  function play(id: SoundId, options: PlaySoundOptions = {}): void {
    void playAsync(id, options).catch(() => undefined);
  }

  function playLoop(id: SoundId, options: PlaySoundOptions = {}): LoopingSound {
    const ctx = ensureContext();
    let source: AudioBufferSourceNode | undefined;
    let gain: GainNode | undefined;
    let stopped = false;
    let volume = clamp(options.volume ?? 1, 0, 1);

    const handle: LoopingSound = {
      setVolume(nextVolume) {
        volume = clamp(nextVolume, 0, 1);
        if (gain) gain.gain.value = volume;
      },
      stop() {
        stopped = true;
        try {
          source?.stop();
        } catch {
          // Stopping an already-ended source is harmless; the loop should still be considered disposed.
        }
        source?.disconnect();
        gain?.disconnect();
      },
    };

    if (!ctx) return handle;

    void startLoop(ctx).catch(() => undefined);
    return handle;

    async function startLoop(loopContext: AudioContext): Promise<void> {
      if (!loadPromise) loadPromise = loadBuffers(loopContext);
      if (loopContext.state === "suspended") {
        await loopContext.resume().catch(() => undefined);
      }
      await loadPromise;
      if (stopped || !sfxGain) return;

      const buffer = buffers.get(id);
      if (!buffer) return;

      source = loopContext.createBufferSource();
      gain = loopContext.createGain();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = options.playbackRate ?? 1;
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(sfxGain);
      source.start();
    }
  }

  async function playAsync(id: SoundId, options: PlaySoundOptions): Promise<void> {
    const ctx = context;
    if (!ctx || settings.muted) return;

    const nowMs = performance.now();
    const minInterval = MIN_SOUND_INTERVAL_MS[id] ?? 0;
    const lastAt = lastPlayedAt.get(id) ?? -Infinity;
    if (nowMs - lastAt < minInterval) return;
    lastPlayedAt.set(id, nowMs);

    if (!loadPromise) loadPromise = loadBuffers(ctx);
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => undefined);
    }
    await loadPromise;

    const buffer = buffers.get(id);
    if (!buffer || !sfxGain) return;

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = options.playbackRate ?? 1;
    gain.gain.value = clamp(options.volume ?? 1, 0, 1);

    source.connect(gain);
    if (options.pan !== undefined && "createStereoPanner" in ctx) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(options.pan, -1, 1);
      gain.connect(panner);
      panner.connect(sfxGain);
    } else {
      gain.connect(sfxGain);
    }

    source.start();
  }

  function applySettings(nextSettings: AudioSettings): void {
    settings = {
      muted: nextSettings.muted,
      masterVolume: clamp(nextSettings.masterVolume, 0, 1),
      sfxVolume: clamp(nextSettings.sfxVolume, 0, 1),
    };
    applyGainSettings();
  }

  function ensureContext(): AudioContext | undefined {
    if (context) return context;
    const AudioContextCtor = window.AudioContext ?? (window as WebAudioWindow).webkitAudioContext;
    if (!AudioContextCtor) return undefined;

    context = new AudioContextCtor();
    masterGain = context.createGain();
    sfxGain = context.createGain();
    sfxGain.connect(masterGain);
    masterGain.connect(context.destination);
    applyGainSettings();
    return context;
  }

  function applyGainSettings(): void {
    if (masterGain) {
      masterGain.gain.value = settings.muted ? 0 : settings.masterVolume;
    }
    if (sfxGain) {
      sfxGain.gain.value = settings.sfxVolume;
    }
  }

  async function loadBuffers(ctx: AudioContext): Promise<void> {
    await Promise.all(
      (Object.entries(SOUND_URLS) as Array<[SoundId, string]>).map(async ([id, url]) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load sound ${id}: ${response.status}`);
        const data = await response.arrayBuffer();
        buffers.set(id, await ctx.decodeAudioData(data));
      }),
    );
  }

  return { preload, resume, play, playLoop, applySettings };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
