import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const config = {
    telegramBotToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    monetagPostbackSecret: Boolean(process.env.MONETAG_POSTBACK_SECRET),
    monetagZone: "12342383",
  };
  try {
    await db.query("SELECT 1");
    return NextResponse.json({ status: "ok", database: "connected", ...config });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unavailable", ...config }, { status: 503 });
  }
}
