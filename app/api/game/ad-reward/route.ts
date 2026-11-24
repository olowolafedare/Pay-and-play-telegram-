import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Provider adapter contract:
 * POST raw JSON { eventId, telegramUserId, completed: true }
 * Header: x-reward-signature = hex HMAC-SHA256(rawBody, REWARDED_AD_WEBHOOK_SECRET)
 * Only call this endpoint from a trusted rewarded-ad provider server callback.
 */
export async function POST(req: Request) {
  const secret = process.env.REWARDED_AD_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Rewarded ads are not configured." }, { status: 503 });

  const raw = await req.text();
  const supplied = req.headers.get("x-reward-signature") ?? "";
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(supplied, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Invalid provider signature." }, { status: 401 });
  }

  let payload: { eventId?: string; telegramUserId?: number; completed?: boolean };
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid event payload." }, { status: 400 }); }
  if (!payload.eventId || !Number.isSafeInteger(payload.telegramUserId) || payload.completed !== true) {
    return NextResponse.json({ error: "Incomplete rewarded-ad event." }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query("SELECT id FROM app_users WHERE telegram_id = $1", [payload.telegramUserId]);
    if (!user.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Player not found." }, { status: 404 });
    }
    const inserted = await client.query(
      "INSERT INTO rewarded_ad_events(provider_event_id, user_id, points_awarded) VALUES($1, $2, 50) ON CONFLICT(provider_event_id) DO NOTHING RETURNING provider_event_id",
      [payload.eventId, user.rows[0].id]
    );
    if (!inserted.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: true, duplicate: true });
    }
    await client.query(
      "UPDATE rewards_wallets SET points = points + 50, lifetime_earned = lifetime_earned + 50, ad_points_earned = ad_points_earned + 50, updated_at = NOW() WHERE user_id = $1",
      [user.rows[0].id]
    );
    await client.query(
      "INSERT INTO rewards_transactions(user_id, type, points, idempotency_key, metadata) VALUES($1, 'ad_reward', 50, $2, $3)",
      [user.rows[0].id, randomUUID(), JSON.stringify({ providerEventId: payload.eventId })]
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, awarded: 50 });
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : "Reward callback failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
