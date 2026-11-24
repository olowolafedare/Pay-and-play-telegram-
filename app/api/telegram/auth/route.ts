import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getInitData, verifyTelegramInitData } from "@/lib/telegram";

export const runtime = "nodejs";

const LEVEL_THRESHOLDS = [0, 12_500, 30_000, 55_000, 90_000, 135_000, 195_000, 270_000, 365_000, 500_000];

function progression(adPoints: number) {
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (adPoints >= LEVEL_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  if (level >= 10) return { level: 10, progress: 100 };
  const start = LEVEL_THRESHOLDS[level - 1];
  const end = LEVEL_THRESHOLDS[level];
  return { level, progress: Math.max(0, Math.min(99, Math.floor(((adPoints - start) / (end - start)) * 100))) };
}

export async function POST(req: Request) {
  try {
    const { user, startParam } = verifyTelegramInitData(getInitData(req));
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const rawReferrerId = startParam?.startsWith("ref_") ? Number(startParam.slice(4)) : null;
      let referrerDbId: number | null = null;
      if (Number.isSafeInteger(rawReferrerId) && rawReferrerId !== user.id) {
        const referrer = await client.query("SELECT id FROM app_users WHERE telegram_id = $1", [rawReferrerId]);
        if (referrer.rowCount) {
          referrerDbId = Number(referrer.rows[0].id);
          // tap_sessions and referrals are keyed by Telegram ID, so ensure
          // the inviter also exists in the legacy Telegram identity table.
          await client.query(
            `INSERT INTO telegram_users (telegram_user_id, username, first_name)
             SELECT telegram_id, username, first_name FROM app_users WHERE telegram_id = $1
             ON CONFLICT (telegram_user_id) DO NOTHING`,
            [rawReferrerId]
          );
        }
      }

      const saved = await client.query(
        `INSERT INTO app_users (telegram_id, username, first_name, last_name, language_code, referred_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name, language_code = EXCLUDED.language_code, last_seen_at = NOW()
         RETURNING id, telegram_id, username, first_name, (xmax = 0) AS is_new_user`,
        [user.id, user.username ?? null, user.first_name, user.last_name ?? null, user.language_code ?? null, referrerDbId]
      );
      const account = saved.rows[0];

      await client.query("INSERT INTO rewards_wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [account.id]);
      await client.query(
        `INSERT INTO telegram_users (telegram_user_id, username, first_name, last_name, language_code, referred_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (telegram_user_id) DO UPDATE SET username = EXCLUDED.username,
          first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
          language_code = EXCLUDED.language_code, last_seen_at = NOW()`,
        [user.id, user.username ?? null, user.first_name, user.last_name ?? null, user.language_code ?? null, referrerDbId ? rawReferrerId : null]
      );

      // A referral is rewarded once, only for a genuinely new Telegram account.
      // The referrals table stores Telegram IDs, while rewards_wallets stores app_users IDs.
      if (referrerDbId && account.is_new_user) {
        const referral = await client.query(
          `INSERT INTO referrals (referrer_user_id, referred_user_id, reward_points, status, qualified_at, rewarded_at)
           VALUES ($1, $2, 100, 'rewarded', NOW(), NOW())
           ON CONFLICT (referred_user_id) DO NOTHING
           RETURNING id`,
          [rawReferrerId, user.id]
        );
        if (referral.rowCount) {
          await client.query(
            "UPDATE rewards_wallets SET points = points + 100, lifetime_earned = lifetime_earned + 100, updated_at = NOW() WHERE user_id = $1",
            [referrerDbId]
          );
          await client.query(
            "INSERT INTO rewards_transactions(user_id, type, points, idempotency_key, metadata) VALUES($1, 'referral_bonus', 100, $2, $3)",
            [referrerDbId, `referral:${account.id}`, JSON.stringify({ referredUserId: String(account.telegram_id), gomeCoins: 10 })]
          );
        }
      }

      const wallet = await client.query("SELECT points, lifetime_earned, ad_points_earned FROM rewards_wallets WHERE user_id = $1", [account.id]);
      const dailyClaim = await client.query("SELECT 1 FROM daily_reward_claims WHERE user_id = $1 AND claim_date = CURRENT_DATE", [account.id]);
      const adPoints = Number(wallet.rows[0].ad_points_earned);
      const level = progression(adPoints);
      await client.query("COMMIT");
      return NextResponse.json({
        user: { id: String(account.telegram_id), name: account.first_name, username: account.username },
        points: Number(wallet.rows[0].points),
        lifetimeEarned: Number(wallet.rows[0].lifetime_earned),
        adPointsEarned: adPoints,
        tapLevel: level.level,
        upgradeProgress: level.progress,
        dailyClaimed: dailyClaim.rows.length > 0,
        referralCode: "ref_" + account.telegram_id,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed";
    return NextResponse.json({ error: message }, { status: message.includes("not configured") ? 503 : 401 });
  }
}
