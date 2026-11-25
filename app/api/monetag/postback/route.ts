import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { creditAdView } from "@/lib/ads";

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

  // Monetag sends both impression and click callbacks for rewarded interstitials.
  // Only process the impression so one ad show can never earn twice.
  if (eventType !== "impression" || rewardType !== "valued") {
    return NextResponse.json({ ok: true, awarded: 0 });
  }

  // The app creates ymid as gome_<Telegram user ID>_<unique UUID>.
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

    const claim = await client.query(
      "SELECT 1 FROM daily_reward_claims WHERE user_id = $1 AND claim_date = CURRENT_DATE",
      [userId]
    );
    if (!claim.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: true, awarded: 0, reason: "daily_claim_required" });
    }

    // A confirmed ad refills energy to the max for the player's level and counts toward the next level.
    // The estimated price Monetag reports is stored per ad, so total ad revenue can be reported later.
    const rawPrice = Number(params.get("estimated_price"));
    const result = await creditAdView(client, userId, ymid, {
      estimatedPrice: Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : null,
      metadata: { provider: "monetag", zoneId, eventType, rewardType },
    });
    if (result.duplicate) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: true, duplicate: true });
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, energy: result.energy, level: result.level, adsWatched: result.adsWatched });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Unable to process reward." }, { status: 500 });
  } finally {
    client.release();
  }
}
