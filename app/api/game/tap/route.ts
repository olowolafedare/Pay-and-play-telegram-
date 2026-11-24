import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getInitData, verifyTelegramInitData } from "@/lib/telegram";
export const runtime = "nodejs";
const LEVEL_THRESHOLDS = [0, 12_500, 30_000, 55_000, 90_000, 135_000, 195_000, 270_000, 365_000, 500_000];
function tapPower(adPoints: number) {
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) { if (adPoints >= LEVEL_THRESHOLDS[i]) level = i + 1; else break; }
  return level;
}
export async function POST(req: Request) {
  try {
    const { user } = verifyTelegramInitData(getInitData(req));
    const body = await req.json().catch(() => ({}));
    const requested = Number(body.tapCount ?? 1);
    const count = Number.isFinite(requested) ? Math.max(1, Math.min(5, Math.floor(requested))) : 1;
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      const w = await c.query("SELECT w.user_id,w.points,w.ad_points_earned,w.gome_coins,w.conversion_remainder FROM rewards_wallets w JOIN app_users u ON u.id=w.user_id WHERE u.telegram_id=$1 FOR UPDATE OF w", [user.id]);
      if (!w.rowCount) throw new Error("Complete Telegram sign-in first");
      const recent = await c.query("SELECT COALESCE(SUM(tap_count),0)::int AS taps FROM tap_sessions WHERE user_id=$1 AND created_at>NOW()-INTERVAL '20 seconds'", [w.rows[0].user_id]);
      if (Number(recent.rows[0].taps) + count > 5) {
        await c.query("ROLLBACK");
        return NextResponse.json({ error: "Tap limit reached. You can make up to 5 taps every 20 seconds." }, { status: 429 });
      }
      const power = tapPower(Number(w.rows[0].ad_points_earned));
      const spend = count * power;
      if (Number(w.rows[0].points) < spend) {
        await c.query("ROLLBACK");
        return NextResponse.json({ error: "Not enough Live Points. Earn more points before tapping." }, { status: 409 });
      }
      const remainder = Number(w.rows[0].conversion_remainder) + spend;
      const coinsEarned = Math.floor(remainder / 10);
      const newRemainder = remainder % 10;
      const updated = await c.query("UPDATE rewards_wallets SET points=points-$1,gome_coins=gome_coins+$2,conversion_remainder=$3,updated_at=NOW() WHERE user_id=$4 RETURNING points,gome_coins,conversion_remainder", [spend, coinsEarned, newRemainder, w.rows[0].user_id]);
      await c.query("INSERT INTO tap_sessions(user_id,tap_count,points_awarded) VALUES($1,$2,0)", [w.rows[0].user_id, count]);
      await c.query("INSERT INTO rewards_transactions(user_id,type,points,idempotency_key,metadata) VALUES($1,'tap_spend',$2,$3,$4)", [w.rows[0].user_id, spend, randomUUID(), JSON.stringify({ count, tapPower: power, gomeCoinsEarned: coinsEarned })]);
      await c.query("COMMIT");
      return NextResponse.json({ points:Number(updated.rows[0].points),gomeCoins:Number(updated.rows[0].gome_coins),conversionRemainder:Number(updated.rows[0].conversion_remainder),spent:spend,gomeCoinsEarned:coinsEarned,tapPower:power,taps:count });
    } catch (e) { await c.query("ROLLBACK"); throw e; }
    finally { c.release(); }
  } catch (e) {
    const m=e instanceof Error?e.message:"Tap failed";
    return NextResponse.json({error:m},{status:m.includes("not configured")?503:400});
  }
}