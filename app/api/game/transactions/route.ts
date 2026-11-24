import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getInitData, verifyTelegramInitData } from "@/lib/telegram";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { user } = verifyTelegramInitData(getInitData(req));
    const result = await db.query(
      `SELECT t.id, t.type, t.points, t.metadata, t.created_at
       FROM rewards_transactions t
       JOIN app_users u ON u.id = t.user_id
       WHERE u.telegram_id = $1
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT 30`,
      [user.id]
    );
    return NextResponse.json({
      transactions: result.rows.map(row => ({
        id: String(row.id),
        type: row.type,
        points: Number(row.points),
        metadata: row.metadata ?? {},
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load transactions";
    return NextResponse.json({ error: message }, { status: message.includes("not configured") ? 503 : 401 });
  }
}
