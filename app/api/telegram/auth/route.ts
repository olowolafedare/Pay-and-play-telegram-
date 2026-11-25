import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getInitData, verifyTelegramInitData } from "@/lib/telegram";
import { levelInfo, REFERRAL_BONUS_CENTS } from "@/lib/game";

export const runtime = "nodejs";

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
        if (referrer.rowCount) referrerDbId = Number(referrer.rows[0].id);
      }
      const saved = await client.query(
        `INSERT INTO app_users (telegram_id, username, first_name, last_name, language_code, referred_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name, language_code = EXCLUDED.language_code, last_seen_at = NOW()
         RETURNING id, telegram_id, username, first_name, (xmax = 0) AS inserted`,
        // referred_by references app_users(telegram_id), so store the referrer's Telegram ID, not the internal row id.
        [user.id, user.username ?? null, user.first_name, user.last_name ?? null, user.language_code ?? null, referrerDbId ? rawReferrerId : null]
      );
      const account = saved.rows[0];
      // New wallets start with full Level 1 energy (column default 1000).
      await client.query("INSERT INTO rewards_wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [account.id]);

      // Referral: 10 Gome to the inviter, only when this player is brand new and has never been referred before.
      if (referrerDbId && account.inserted === true) {
        const ref = await client.query(
          `INSERT INTO referrals (referrer_user_id, referred_user_id, status, bonus_awarded, qualified_at)
           VALUES ($1, $2, 'qualified', $3, NOW()) ON CONFLICT (referred_user_id) DO NOTHING RETURNING id`,
          [referrerDbId, account.id, REFERRAL_BONUS_CENTS]
        );
        if (ref.rowCount) {
          await client.query(
            "UPDATE rewards_wallets SET points = points + $1, lifetime_earned = lifetime_earned + $1, updated_at = NOW() WHERE user_id = $2",
            [REFERRAL_BONUS_CENTS, referrerDbId]
          );
          await client.query(
            `INSERT INTO rewards_transactions(user_id, type, points, idempotency_key, metadata)
             VALUES($1, 'referral_bonus', $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING`,
            [referrerDbId, REFERRAL_BONUS_CENTS, "referral:" + account.id, JSON.stringify({ referredUserId: String(account.id) })]
          );
        }
      }

      const wallet = await client.query("SELECT points, ads_watched, energy FROM rewards_wallets WHERE user_id = $1", [account.id]);
      const dailyClaim = await client.query("SELECT 1 FROM daily_reward_claims WHERE user_id = $1 AND claim_date = CURRENT_DATE", [account.id]);
      const invited = await client.query("SELECT COUNT(*)::int AS n FROM referrals WHERE referrer_user_id = $1", [account.id]);
      await client.query("COMMIT");

      const info = levelInfo(Number(wallet.rows[0].ads_watched));
      return NextResponse.json({
        user: { id: String(account.telegram_id), name: account.first_name, username: account.username },
        gomeCents: Number(wallet.rows[0].points),
        energy: Math.max(0, Math.min(info.maxEnergy, Number(wallet.rows[0].energy))),
        maxEnergy: info.maxEnergy,
        tapPower: info.tapPower,
        level: info.level,
        adsWatched: info.adsWatched,
        nextLevelAds: info.nextLevelAds,
        levelProgress: info.levelProgress,
        dailyClaimed: dailyClaim.rows.length > 0,
        friendsInvited: Number(invited.rows[0].n),
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
