import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getInitData, verifyTelegramInitData } from "@/lib/telegram";
import { levelInfo } from "@/lib/game";

export const runtime = "nodejs";

/** Daily reward: once per day, refill energy to the max for the player's level. Also unlocks ads for the day. */
export async function POST(req: Request) {
  try {
    const { user } = verifyTelegramInitData(getInitData(req));
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      const w = await c.query(
        "SELECT w.user_id, w.ads_watched FROM rewards_wallets w JOIN app_users u ON u.id = w.user_id WHERE u.telegram_id = $1 FOR UPDATE OF w",
        [user.id]
      );
      if (!w.rowCount) throw new Error("Sign in first");
      const userId = w.rows[0].user_id;
      const info = levelInfo(Number(w.rows[0].ads_watched));

      const claim = await c.query(
        "INSERT INTO daily_reward_claims(user_id, points_awarded) VALUES($1, $2) ON CONFLICT(user_id, claim_date) DO NOTHING RETURNING id",
        [userId, info.maxEnergy]
      );
      if (!claim.rowCount) {
        await c.query("ROLLBACK");
        return NextResponse.json({ error: "Today's daily refill has already been claimed." }, { status: 409 });
      }
      await c.query("UPDATE rewards_wallets SET energy = $1, updated_at = NOW() WHERE user_id = $2", [info.maxEnergy, userId]);
      await c.query("COMMIT");
      return NextResponse.json({ energy: info.maxEnergy, maxEnergy: info.maxEnergy });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : "Claim failed";
    return NextResponse.json({ error: m }, { status: m.includes("not configured") ? 503 : 400 });
  }
}
