import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getInitData,verifyTelegramInitData } from "@/lib/telegram";
export const runtime="nodejs";
export async function POST(req:Request){
 try{
  const {user}=verifyTelegramInitData(getInitData(req)), body=await req.json().catch(()=>({}));
  const count=Math.max(1,Math.min(25,Math.floor(Number(body.tapCount??1)))), unit=Math.max(1,Number(process.env.GAME_POINTS_PER_TAP??1));
  const c=await db.connect();
  try{
   await c.query("BEGIN");
   const w=await c.query("SELECT w.user_id FROM rewards_wallets w JOIN app_users u ON u.id=w.user_id WHERE u.telegram_id=$1 FOR UPDATE OF w",[user.id]);
   if(!w.rowCount)throw new Error("Complete Telegram sign-in first");
   const recent=await c.query("SELECT id FROM tap_sessions WHERE user_id=$1 AND created_at>NOW()-INTERVAL '700 milliseconds' LIMIT 1",[w.rows[0].user_id]);
   if(recent.rowCount){await c.query("ROLLBACK");return NextResponse.json({error:"Please slow down."},{status:429});}
   const points=count*unit;
   await c.query("UPDATE rewards_wallets SET points=points+$1,lifetime_earned=lifetime_earned+$1,updated_at=NOW() WHERE user_id=$2",[points,w.rows[0].user_id]);
   await c.query("INSERT INTO tap_sessions(user_id,tap_count,points_awarded) VALUES($1,$2,$3)",[w.rows[0].user_id,count,points]);
   await c.query("INSERT INTO rewards_transactions(user_id,type,points,idempotency_key,metadata) VALUES($1,'tap',$2,$3,$4)",[w.rows[0].user_id,points,randomUUID(),JSON.stringify({count})]);
   const updated=await c.query("SELECT points FROM rewards_wallets WHERE user_id=$1",[w.rows[0].user_id]);
   await c.query("COMMIT");return NextResponse.json({points:Number(updated.rows[0].points),awarded:points});
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 }catch(e){const m=e instanceof Error?e.message:"Tap failed";return NextResponse.json({error:m},{status:m.includes("not configured")?503:400});}
}
