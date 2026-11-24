import { createHmac, timingSafeEqual } from "node:crypto";
export type TelegramUser = { id:number; first_name:string; last_name?:string; username?:string; language_code?:string };
export function verifyTelegramInitData(initData:string): {user:TelegramUser; startParam?:string} {
 const token=process.env.TELEGRAM_BOT_TOKEN;
 if(!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
 if(!initData || initData.length>10000) throw new Error("Missing Telegram initData");
 const params=new URLSearchParams(initData), hash=params.get("hash");
 if(!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error("Invalid Telegram signature");
 params.delete("hash");
 const check=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
 const secret=createHmac("sha256","WebAppData").update(token).digest();
 const expected=createHmac("sha256",secret).update(check).digest(), supplied=Buffer.from(hash,"hex");
 if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) throw new Error("Invalid Telegram signature");
 const authDate=Number(params.get("auth_date")), now=Math.floor(Date.now()/1000);
 if(!Number.isFinite(authDate)||now-authDate>86400||authDate>now+60) throw new Error("Telegram session expired. Reopen the Mini App.");
 const raw=params.get("user"); if(!raw) throw new Error("Telegram user missing");
 const user=JSON.parse(raw) as TelegramUser;
 if(!Number.isSafeInteger(user.id)||user.id<=0||!user.first_name) throw new Error("Invalid Telegram user");
 return {user,startParam:params.get("start_param")??undefined};
}
export const getInitData=(r:Request)=>r.headers.get("x-telegram-init-data")??"";
