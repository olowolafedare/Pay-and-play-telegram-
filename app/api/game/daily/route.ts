import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getInitData,verifyTelegramInitData } from "@/lib/telegram";
export const runtime="nodejs";
export async function POST(req:Request){
 try{
  const {user}=verifyTelegramInitData(getInitData(req)), points=Math.max(1,Number(process.env.GAME_DAILY_POINTS??100)), c=await db.connect();
  try{
   await c.query("BEGIN");const u=await c.query("SELECT id FROM app_users WHERE telegram_id=$1",[user.id]);if(!u.rowCount)throw new Error("Sign in first");
   const claim=await c.query("INSERT INTO daily_reward_claims(user_id,points_awarded) VALUES($1,$2) ON CONFLICT(user_id,claim_date) DO NOTHING RETURNING id",[u.rows[0].id,points]);
   if(!claim.rowCount){await c.query("ROLLBACK");return NextResponse.json({error:"Today's reward has already been claimed."},{status:409});}
   await c.query("UPDATE rewards_wallets SET points=points+$1,lifetime_earned=lifetime_earned+$1,updated_at=NOW() WHERE user_id=$2",[points,u.rows[0].id]);
   await c.query("INSERT INTO rewards_transactions(user_id,type,points,idempotency_key) VALUES($1,'daily_reward',$2,$3)",[u.rows[0].id,points,randomUUID()]);
   const w=await c.query("SELECT points FROM rewards_wallets WHERE user_id=$1",[u.rows[0].id]);await c.query("COMMIT");
   return NextResponse.json({points:Number(w.rows[0].points),awarded:points});
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 }catch(e){const m=e instanceof Error?e.message:"Claim failed";return NextResponse.json({error:m},{status:m.includes("not configured")?503:400});}
}
