// Gome Coin game rules. All balances are stored as whole "energy units":
//   100 energy spent = 1 Gome coin, so the database stores Gome in hundredths (gomeCents).
//   e.g. points = 1234 in rewards_wallets means 12.34 Gome.

export const ENERGY_PER_GOME = 100;
/** Referral bonus: 10 Gome, paid to the inviter when the friend first opens the game. */
export const REFERRAL_BONUS_CENTS = 10 * ENERGY_PER_GOME;

/** Levels are reached by total confirmed ads watched. Tap power = level. */
export const LEVELS = [
  { level: 1, ads: 0, maxEnergy: 1000 },
  { level: 2, ads: 50, maxEnergy: 1000 },
  { level: 3, ads: 100, maxEnergy: 1200 },
  { level: 4, ads: 200, maxEnergy: 1400 },
  { level: 5, ads: 300, maxEnergy: 1600 },
  { level: 6, ads: 400, maxEnergy: 1800 },
  { level: 7, ads: 500, maxEnergy: 2100 },
  { level: 8, ads: 600, maxEnergy: 2400 },
  { level: 9, ads: 700, maxEnergy: 2700 },
  { level: 10, ads: 800, maxEnergy: 3000 },
] as const;

export const MAX_LEVEL = LEVELS[LEVELS.length - 1].level;

export type LevelInfo = {
  level: number;
  tapPower: number;
  maxEnergy: number;
  adsWatched: number;
  /** Total ads needed for the next level, or null at max level. */
  nextLevelAds: number | null;
  /** 0-99 progress towards the next level (100 at max level). */
  levelProgress: number;
};

export function levelInfo(adsWatched: number): LevelInfo {
  const ads = Math.max(0, Math.floor(Number(adsWatched) || 0));
  let idx = 0;
  for (let i = 1; i < LEVELS.length; i++) {
    if (ads >= LEVELS[i].ads) idx = i;
    else break;
  }
  const cur = LEVELS[idx];
  const next = LEVELS[idx + 1];
  const levelProgress = next
    ? Math.max(0, Math.min(99, Math.floor(((ads - cur.ads) / (next.ads - cur.ads)) * 100)))
    : 100;
  return { level: cur.level, tapPower: cur.level, maxEnergy: cur.maxEnergy, adsWatched: ads, nextLevelAds: next ? next.ads : null, levelProgress };
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(process.env[name]));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

/** Anti-cheat limits for tapping. */
export function tapConfig() {
  return {
    /** The most taps per second a human can sustain, plus a short burst allowance. */
    maxTapsPerSecond: envInt("GAME_MAX_TAPS_PER_SECOND", 15, 1, 100),
    tapBurst: envInt("GAME_TAP_BURST", 30, 1, 1000),
    /** Largest batch accepted in one request. */
    maxBatch: 300,
  };
}

/**
 * Work out what a batch of taps is worth.
 * Each tap spends `tapPower` energy (the last tap spends whatever is left). Energy spent = Gome cents earned.
 */
export function applyTaps(requested: number, energy: number, tapPower: number, secondsSinceLastBatch: number, cfg = tapConfig()) {
  const req = Math.max(0, Math.min(cfg.maxBatch, Math.floor(Number(requested) || 0)));
  const since = Math.max(0, Number.isFinite(secondsSinceLastBatch) ? secondsSinceLastBatch : 3600);
  const rateCap = Math.floor(since * cfg.maxTapsPerSecond) + cfg.tapBurst;
  const allowedTaps = Math.min(req, rateCap);
  const available = Math.max(0, Math.floor(Number(energy) || 0));
  const power = Math.max(1, Math.floor(tapPower));
  const energyUsed = Math.min(allowedTaps * power, available);
  const tapsUsed = energyUsed > 0 ? Math.ceil(energyUsed / power) : 0;
  return { tapsUsed, energyUsed, gomeCentsEarned: energyUsed };
}
