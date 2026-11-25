// Shared game rules used by the API routes. Tune via environment variables.

export const LEVEL_THRESHOLDS = [0, 12_500, 30_000, 55_000, 90_000, 135_000, 195_000, 270_000, 365_000, 500_000];

/** Tap power (points per tap) = level, driven by points earned from rewarded ads. */
export function levelFor(adPoints: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (adPoints >= LEVEL_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return level;
}

export function progression(adPoints: number): { level: number; progress: number } {
  const level = levelFor(adPoints);
  if (level >= LEVEL_THRESHOLDS.length) return { level, progress: 100 };
  const start = LEVEL_THRESHOLDS[level - 1];
  const end = LEVEL_THRESHOLDS[level];
  return { level, progress: Math.max(0, Math.min(99, Math.floor(((adPoints - start) / (end - start)) * 100))) };
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(process.env[name]));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export function gameConfig() {
  return {
    maxEnergy: envInt("GAME_MAX_ENERGY", 1000, 10, 100_000),
    regenPerSecond: envInt("GAME_ENERGY_REGEN_PER_SECOND", 1, 1, 1000),
    /** Anti-cheat: the most taps per second a human can sustain, plus a short burst allowance. */
    maxTapsPerSecond: envInt("GAME_MAX_TAPS_PER_SECOND", 15, 1, 100),
    tapBurst: envInt("GAME_TAP_BURST", 30, 1, 1000),
    /** Largest batch accepted in one request. */
    maxBatch: 300,
  };
}

export type EnergyState = {
  /** Energy available right now. */
  energy: number;
  /** True when energy had refilled to the max (regen clock restarts from now). */
  full: boolean;
  /** Seconds to move the stored regen clock forward when not full (keeps partial-second progress). */
  anchorAdvanceSeconds: number;
};

/** Energy regenerates continuously from the stored value since energy_updated_at. */
export function currentEnergy(stored: number, elapsedSeconds: number, cfg = gameConfig()): EnergyState {
  const elapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
  const base = Math.max(0, Math.min(cfg.maxEnergy, Math.floor(stored)));
  const gained = Math.floor(elapsed * cfg.regenPerSecond);
  if (base + gained >= cfg.maxEnergy) return { energy: cfg.maxEnergy, full: true, anchorAdvanceSeconds: 0 };
  return { energy: base + gained, full: false, anchorAdvanceSeconds: gained / cfg.regenPerSecond };
}

/** How many of the requested taps the server will accept. */
export function acceptedTaps(requested: number, energy: number, secondsSinceLastBatch: number, cfg = gameConfig()): number {
  const req = Math.max(0, Math.min(cfg.maxBatch, Math.floor(Number(requested) || 0)));
  const since = Math.max(0, Number.isFinite(secondsSinceLastBatch) ? secondsSinceLastBatch : 3600);
  const rateCap = Math.floor(since * cfg.maxTapsPerSecond) + cfg.tapBurst;
  return Math.max(0, Math.min(req, energy, rateCap));
}
