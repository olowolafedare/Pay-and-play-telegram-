import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { creditAdView } from "@/lib/ads";

export const runtime = "nodejs";

/**
 * Monetag postback. Monetag calls this URL from its servers after each ad event:
 *   /api/monetag/postback?secret=...&zone_id={zone_id}&event_type={event_type}
 *     &reward_event_type={reward_event_type}&ymid={ymid}&estimated_price={estimated_price}
 * A paid ("valued") impression refills the player's energy and counts toward their level.
 * Every call is logged (without the secret) so it can be checked in Vercel > Logs.
 */
type Result = { status: number; body: Record<string, unknown>; outcome: string };

function log(outcome: string, p: URLSearchParams, extra: Record<string, unknown> = {}) {
  const ymid = p.get("ymid") ?? "";
  console.log("[monetag-postback] " + JSON.stringify({
    outcome,
    zone_id: p.get("zone_id"),
    event_type: p.get("event_type"),
    reward_event_type: p.get("reward_event_type"),
    estimated_price: p.get("estimated_price"),
    ymid: ymid.slice(0, 40),
    has_secret: p.has("secret"),
    ...extra,
  }));
}

async function handle(params: URLSearchParams): Promise<Result> {
  const expectedSecret = process.env.MONETAG_POSTBACK_SECRET;
  const suppliedSecret = params.get("secret") ?? "";
  if (!expectedSecret) return { status: 503, outcome: "not_configured", body: { error: "Postback is not configured." } };
  const a = Buffer.from(suppliedSecret);
  const b = Buffer.from(expectedSecret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { status: 401, outcome: "wrong_secret", body: { error: "Unauthorized." } };
  }

  const zoneId = params.get("zone_id");
  const eventType = params.get("event_type");
  const rewardType = params.get("reward_event_type");
  const ymid = params.get("ymid") ?? "";

  // Monetag sends both impression and click callbacks. Only a paid impression refills,
  // so one ad show can never be credited twice.
  if (eventType !== "impression" || rewardType !== "valued") {
    return { status: 200, outcome: "ignored_not_valued_impression", body: { ok: true, awarded: 0 } };
  }

  // The app creates ymid as gome_<Telegram user ID>_<unique 32-hex id>.
  const match = /^gome_(\d{1,20})_([a-f0-9]{32})$/.exec(ymid);
  if (!match) return { status: 400, outcome: "bad_ymid", body: { error: "Invalid ad reference." } };
  const telegramId = match[1];

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query("SELECT id FROM app_users WHERE telegram_id = $1 FOR UPDATE", [telegramId]);
    if (!user.rowCount) {
      await client.query("ROLLBACK");
      return { status: 404, outcome: "player_not_found", body: { error: "Player not found." } };
    }
    const userId = user.rows[0].id;

    const claim = await client.query("SELECT 1 FROM daily_reward_claims WHERE user_id = $1 AND claim_date = CURRENT_DATE", [userId]);
    if (!claim.rowCount) {
      await client.query("ROLLBACK");
      return { status: 200, outcome: "daily_claim_required", body: { ok: true, awarded: 0, reason: "daily_claim_required" } };
    }

    // Refill energy to the level max, count the ad toward the next level, and store Monetag's price estimate.
    const rawPrice = Number(params.get("estimated_price"));
    const result = await creditAdView(client, userId, ymid, {
      estimatedPrice: Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : null,
      metadata: { provider: "monetag", zoneId, eventType, rewardType },
    });
    if (result.duplicate) {
      await client.query("ROLLBACK");
      return { status: 200, outcome: "duplicate", body: { ok: true, duplicate: true } };
    }
    await client.query("COMMIT");
    return { status: 200, outcome: "credited", body: { ok: true, energy: result.energy, level: result.level, adsWatched: result.adsWatched } };
  } catch (e) {
    await client.query("ROLLBACK");
    return { status: 500, outcome: "server_error:" + (e instanceof Error ? e.message.slice(0, 120) : "unknown"), body: { error: "Unable to process reward." } };
  } finally {
    client.release();
  }
}

async function respond(params: URLSearchParams) {
  const r = await handle(params);
  log(r.outcome, params, { status: r.status });
  return NextResponse.json(r.body, { status: r.status });
}

export async function GET(req: Request) {
  return respond(new URL(req.url).searchParams);
}

/** Some ad networks send postbacks as POST; accept query string and/or form/JSON body. */
export async function POST(req: Request) {
  const params = new URL(req.url).searchParams;
  const text = await req.text().catch(() => "");
  if (text) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      for (const [k, v] of Object.entries(json)) if (!params.has(k) && v != null) params.set(k, String(v));
    } catch {
      for (const [k, v] of new URLSearchParams(text)) if (!params.has(k)) params.set(k, v);
    }
  }
  return respond(params);
}
