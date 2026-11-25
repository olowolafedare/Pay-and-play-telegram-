import type { PoolClient } from "pg";
import { levelInfo } from "@/lib/game";

/**
 * Credit one confirmed rewarded-ad view: count it toward the player's level and refill energy
 * to the max for their (possibly new) level. Idempotent per provider event id.
 * Must run inside a transaction.
 */
export async function creditAdView(
  c: PoolClient,
  userId: number | string,
  providerEventId: string,
  details: { estimatedPrice?: number | null; metadata?: Record<string, unknown> } = {}
): Promise<{ duplicate: boolean; level: number; energy: number; adsWatched: number }> {
  const w = await c.query("SELECT ads_watched FROM rewards_wallets WHERE user_id = $1 FOR UPDATE", [userId]);
  if (!w.rowCount) throw new Error("Player wallet not found.");
  const before = Number(w.rows[0].ads_watched);
  const after = levelInfo(before + 1);

  const inserted = await c.query(
    `INSERT INTO rewarded_ad_events(provider_event_id, user_id, points_awarded, estimated_price, metadata)
     VALUES($1, $2, $3, $4, $5) ON CONFLICT(provider_event_id) DO NOTHING RETURNING provider_event_id`,
    [providerEventId, userId, after.maxEnergy, details.estimatedPrice ?? null, JSON.stringify(details.metadata ?? {})]
  );
  if (!inserted.rowCount) {
    const cur = levelInfo(before);
    return { duplicate: true, level: cur.level, energy: -1, adsWatched: before };
  }

  await c.query(
    "UPDATE rewards_wallets SET ads_watched = $1, energy = $2, updated_at = NOW() WHERE user_id = $3",
    [after.adsWatched, after.maxEnergy, userId]
  );
  return { duplicate: false, level: after.level, energy: after.maxEnergy, adsWatched: after.adsWatched };
}
