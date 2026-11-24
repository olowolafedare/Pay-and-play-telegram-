import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getInitData,verifyTelegramInitData } from "@/lib/telegram";
export const runtime="nodejs";
export async function POST(req:Request){
 try{
  const {user,startParam}=verifyTelegramInitData(getInitData(req)), c=await db.connect();
  try{
   await c.query("BEGIN");
   const refRaw=startParam?.startsWith("ref_")?Number(startParam.slice(4)):null;
   const ref=Number.isSafeInteger(refRaw)&&refRaw!==user.id?refRaw:null;
   const saved=await c.query(`INSERT INTO app_users(telegram_id,username,first_name,last_name,language_code,referred_by) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(telegram_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,language_code=EXCLUDED.language_code,last_seen_at=NOW()
   RETURNING id,telegram_id,username,first_name`,[user.id,user.username??null,user.first_name,user.last_name??null,user.language_code??null,ref]);
   const u=saved.rows[0]; await c.query("INSERT INTO rewards_wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING",[u.id]);
   if(ref){const r=await c.query("SELECT id FROM app_users WHERE telegram_id=$1",[ref]);if(r.rowCount)await c.query("INSERT INTO referrals(referrer_user_id,referred_user_id) VALUES($1,$2) ON CONFLICT(referred_user_id) DO NOTHING",[r.rows[0].id,u.id]);}
   const w=await c.query("SELECT points,lifetime_earned FROM rewards_wallets WHERE user_id=$1",[u.id]);
   await c.query("COMMIT");
   return NextResponse.json({user:{id:String(u.telegram_id),name:u.first_name,username:u.username},points:Number(w.rows[0].points),lifetimeEarned:Number(w.rows[0].lifetime_earned),referralCode:"ref_"+u.telegram_id});
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 }catch(e){const m=e instanceof Error?e.message:"Authentication failed";return NextResponse.json({error:m},{status:m.includes("not configured")?503:401});}
}
