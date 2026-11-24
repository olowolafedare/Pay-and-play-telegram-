import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getInitData, verifyTelegramInitData } from "@/lib/telegram";

export const runtime = "nodejs";
const LEVEL_THRESHOLDS = [0, 12_500, 30_000, 55_000, 90_000, 135_000, 195_000, 270_000, 365_000, 500_000];

function tapPower(adPoints: number) {
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (adPoints >= LEVEL_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return level;
}

export async function POST(req: Request) {
  try {
    const { user } = verifyTelegramInitData(getInitData(req));
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      const w = await c.query(
        "SELECT w.user_id, w.ad_points_earned, w.updated_at FROM rewards_wallets w JOIN app_users u ON u.id = w.user_id WHERE u.telegram_id = $1 FOR UPDATE OF w",
        [user.id]
      );
      if (!w.rowCount) throw new Error("Complete Telegram sign-in first");

      // The live Neon tap_sessions table belongs to an older schema and does
      // not contain tap_count/points_awarded. Throttle against the locked wallet
      // row instead, so tapping uses the current rewards schema safely.
      const lastUpdate = new Date(w.rows[0].updated_at).getTime();
      if (Date.now() - lastUpdate < 250) {
        await c.query("ROLLBACK");
        return NextResponse.json({ error: "Please slow down." }, { status: 429 });
      }

      const power = tapPower(Number(w.rows[0].ad_points_earned));
      const points = power;
      await c.query(
        "UPDATE rewards_wallets SET points = points + $1, lifetime_earned = lifetime_earned + $1, updated_at = NOW() WHERE user_id = $2",
        [points, w.rows[0].user_id]
      );
      await c.query(
        "INSERT INTO rewards_transactions(user_id, type, points, idempotency_key, metadata) VALUES($1, 'tap', $2, $3, $4)",
        [w.rows[0].user_id, points, randomUUID(), JSON.stringify({ count: 1, tapPower: power })]
      );
      const updated = await c.query(
        "SELECT points, lifetime_earned FROM rewards_wallets WHERE user_id = $1",
        [w.rows[0].user_id]
      );
      await c.query("COMMIT");
      return NextResponse.json({
        points: Number(updated.rows[0].points),
        lifetimeEarned: Number(updated.rows[0].lifetime_earned),
        awarded: points,
        tapPower: power,
      });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : "Tap failed";
    return NextResponse.json({ error: m }, { status: m.includes("not configured") ? 503 : 400 });
  }
}
