import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getInitData, verifyTelegramInitData } from "@/lib/telegram";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { user, startParam } = verifyTelegramInitData(getInitData(req));
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Resolve the referral Telegram ID to the internal app_users.id.
      const rawReferrerId = startParam?.startsWith("ref_")
        ? Number(startParam.slice(4))
        : null;
      let referrerDbId: number | null = null;
      if (Number.isSafeInteger(rawReferrerId) && rawReferrerId !== user.id) {
        const referrer = await client.query(
          "SELECT id FROM app_users WHERE telegram_id = $1",
          [rawReferrerId]
        );
        if (referrer.rowCount) referrerDbId = Number(referrer.rows[0].id);
      }

      const saved = await client.query(
        `INSERT INTO app_users
          (telegram_id, username, first_name, last_name, language_code, referred_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (telegram_id) DO UPDATE SET
          username = EXCLUDED.username,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          language_code = EXCLUDED.language_code,
          last_seen_at = NOW()
         RETURNING id, telegram_id, username, first_name`,
        [
          user.id,
          user.username ?? null,
          user.first_name,
          user.last_name ?? null,
          user.language_code ?? null,
          referrerDbId,
        ]
      );

      const account = saved.rows[0];
      await client.query(
        "INSERT INTO rewards_wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
        [account.id]
      );

      if (referrerDbId) {
        await client.query(
          `INSERT INTO referrals (referrer_user_id, referred_user_id)
           VALUES ($1, $2)
           ON CONFLICT (referred_user_id) DO NOTHING`,
          [referrerDbId, account.id]
        );
      }

      const wallet = await client.query(
        "SELECT points, lifetime_earned FROM rewards_wallets WHERE user_id = $1",
        [account.id]
      );

      await client.query("COMMIT");
      return NextResponse.json({
        user: {
          id: String(account.telegram_id),
          name: account.first_name,
          username: account.username,
        },
        points: Number(wallet.rows[0].points),
        lifetimeEarned: Number(wallet.rows[0].lifetime_earned),
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
    return NextResponse.json(
      { error: message },
      { status: message.includes("not configured") ? 503 : 401 }
    );
  }
}
