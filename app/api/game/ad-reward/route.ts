import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { creditAdView } from "@/lib/ads";

export const runtime = "nodejs";

/**
 * Optional generic rewarded-ad provider adapter (Monetag uses /api/monetag/postback instead).
 * POST raw JSON { eventId, telegramUserId, completed: true, estimatedPrice? }
 * Header: x-reward-signature = hex HMAC-SHA256(rawBody, REWARDED_AD_WEBHOOK_SECRET)
 * Only call this endpoint from a trusted rewarded-ad provider server callback.
 * A confirmed ad refills energy to the level max and counts toward the next level.
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

  let payload: { eventId?: string; telegramUserId?: number; completed?: boolean; estimatedPrice?: number };
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
    const price = Number(payload.estimatedPrice);
    const result = await creditAdView(client, user.rows[0].id, "generic:" + payload.eventId, {
      estimatedPrice: Number.isFinite(price) && price >= 0 ? price : null,
      metadata: { provider: "generic" },
    });
    if (result.duplicate) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: true, duplicate: true });
    }
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, energy: result.energy, level: result.level, adsWatched: result.adsWatched });
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : "Reward callback failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
