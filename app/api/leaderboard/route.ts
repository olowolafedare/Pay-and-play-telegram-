import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getInitData,verifyTelegramInitData } from "@/lib/telegram";
export const runtime="nodejs";
export async function GET(req:Request){
 try{verifyTelegramInitData(getInitData(req));const r=await db.query(`SELECT COALESCE(u.username,u.first_name,'Player') AS name,w.points FROM rewards_wallets w JOIN app_users u ON u.id=w.user_id ORDER BY w.points DESC,w.updated_at ASC LIMIT 20`);
 return NextResponse.json({leaderboard:r.rows.map((x,i)=>({rank:i+1,name:x.name,points:Number(x.points)}))});}
 catch(e){const m=e instanceof Error?e.message:"Could not load leaderboard";return NextResponse.json({error:m},{status:m.includes("not configured")?503:401});}
}
