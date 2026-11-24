import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const expectedSecret = process.env.MONETAG_POSTBACK_SECRET;
  const suppliedSecret = params.get("secret") ?? "";

  if (!expectedSecret) {
    return NextResponse.json({ error: "Postback is not configured." }, { status: 503 });
  }
  const a = Buffer.from(suppliedSecret);
  const b = Buffer.from(expectedSecret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const zoneId = params.get("zone_id");
  const eventType = params.get("event_type");
  const rewardType = params.get("reward_event_type");
  const ymid = params.get("ymid") ?? "";

  if (zoneId !== "12342383" || !ymid.startsWith("gome_")) {
    return NextResponse.json({ error: "Invalid ad event." }, { status: 400 });
  }

  // Only valued impression events earn points. Clicks and non-valued events do not.
  if (eventType !== "impression" || rewardType !== "valued") {
    return NextResponse.json({ ok: true, awarded: 0 });
  }

  const match = /^gome_(\d{1,20})_([a-f0-9]{32})$/.exec(ymid);
  if (!match) return NextResponse.json({ error: "Invalid ad reference." }, { status: 400 });
  const telegramId = match[1];

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query(
      "SELECT id FROM app_users WHERE telegram_id = $1 FOR UPDATE",
      [telegramId]
    );
    if (!user.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Player not found." }, { status: 404 });
    }
    const userId = user.rows[0].id;

    // New and returning users may watch rewarded ads without first claiming
    // the daily reward. The valued server postback is the only credit authority.
    const inserted = await client.query(
      "INSERT INTO rewarded_ad_events(provider_event_id, user_id, points_awarded) VALUES($1, $2, 50) ON CONFLICT(provider_event_id) DO NOTHING RETURNING provider_event_id",
      [ymid, userId]
    );
    if (!inserted.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: true, duplicate: true, awarded: 0 });
    }

    await client.query(
      "UPDATE rewards_wallets SET points = points + 50, lifetime_earned = lifetime_earned + 50, ad_points_earned = ad_points_earned + 50, updated_at = NOW() WHERE user_id = $1",
      [userId]
    );
    await client.query(
      "INSERT INTO rewards_transactions(user_id, type, points, idempotency_key, metadata) VALUES($1, 'ad_reward', 50, $2, $3)",
      [userId, `monetag:${ymid}`, JSON.stringify({ provider: "monetag", ymid, zoneId, estimatedPrice: params.get("estimated_price") })]
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, awarded: 50 });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Unable to process reward." }, { status: 500 });
  } finally {
    client.release();
  }
}
