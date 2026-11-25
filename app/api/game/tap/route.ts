import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getInitData, verifyTelegramInitData } from "@/lib/telegram";
import { applyTaps, levelInfo, tapConfig } from "@/lib/game";

export const runtime = "nodejs";

/**
 * Batched taps.
 * Body: { taps: number, batchId: string }  (batchId = client UUID; retries reuse it so a batch is never credited twice)
 * Each tap spends `tapPower` energy; energy spent becomes Gome (100 energy = 1 Gome). Energy never refills by itself.
 */
export async function POST(req: Request) {
  try {
    const { user } = verifyTelegramInitData(getInitData(req));
    const body = await req.json().catch(() => ({}));
    const requested = Math.floor(Number(body.taps ?? 0));
    const batchId = typeof body.batchId === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(body.batchId) ? body.batchId : null;
    if (!batchId) return NextResponse.json({ error: "Missing batch id." }, { status: 400 });
    if (!Number.isFinite(requested) || requested < 0) return NextResponse.json({ error: "Invalid tap count." }, { status: 400 });

    const idempotencyKey = "tap:" + user.id + ":" + batchId;
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      const w = await c.query(
        `SELECT w.user_id, w.points, w.ads_watched, w.energy,
                EXTRACT(EPOCH FROM (NOW() - COALESCE(w.last_tap_at, NOW() - INTERVAL '1 hour')))::float8 AS since_last
           FROM rewards_wallets w JOIN app_users u ON u.id = w.user_id
          WHERE u.telegram_id = $1 FOR UPDATE OF w`,
        [user.id]
      );
      if (!w.rowCount) throw new Error("Complete Telegram sign-in first");
      const row = w.rows[0];
      const userId = row.user_id;
      const info = levelInfo(Number(row.ads_watched));
      const energy = Math.max(0, Math.min(info.maxEnergy, Number(row.energy)));

      // Same batch retried after a network error: don't credit again, just return current state.
      const dup = await c.query("SELECT 1 FROM rewards_transactions WHERE idempotency_key = $1", [idempotencyKey]);
      if (dup.rowCount) {
        await c.query("ROLLBACK");
        return NextResponse.json({ gomeCents: Number(row.points), energy, maxEnergy: info.maxEnergy, tapPower: info.tapPower, tapsUsed: 0, energyUsed: 0, duplicate: true });
      }

      const result = applyTaps(requested, energy, info.tapPower, Number(row.since_last), tapConfig());
      const newEnergy = energy - result.energyUsed;

      if (result.energyUsed > 0) {
        await c.query(
          `UPDATE rewards_wallets
              SET points = points + $1, lifetime_earned = lifetime_earned + $1, energy = $2,
                  last_tap_at = NOW(), updated_at = NOW()
            WHERE user_id = $3`,
          [result.gomeCentsEarned, newEnergy, userId]
        );
        await c.query("INSERT INTO tap_sessions(user_id, tap_count, points_awarded) VALUES($1, $2, $3)", [userId, result.tapsUsed, result.gomeCentsEarned]);
        await c.query(
          "INSERT INTO rewards_transactions(user_id, type, points, idempotency_key, metadata) VALUES($1, 'tap', $2, $3, $4)",
          [userId, result.gomeCentsEarned, idempotencyKey, JSON.stringify({ requested, tapsUsed: result.tapsUsed, tapPower: info.tapPower })]
        );
      }
      const updated = await c.query("SELECT points FROM rewards_wallets WHERE user_id = $1", [userId]);
      await c.query("COMMIT");
      return NextResponse.json({
        gomeCents: Number(updated.rows[0].points),
        energy: newEnergy,
        maxEnergy: info.maxEnergy,
        tapPower: info.tapPower,
        tapsUsed: result.tapsUsed,
        energyUsed: result.energyUsed,
      });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : "Tap failed";
    return NextResponse.json({ error: m }, { status: m.includes("not configured") ? 503 : m.includes("signature") || m.includes("expired") ? 401 : 400 });
  }
}
