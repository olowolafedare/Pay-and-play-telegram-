"use client";
import { useCallback,useEffect,useState } from "react";
declare global { interface Window { Telegram?: { WebApp?: { initData:string; ready:()=>void; expand:()=>void } } } }
type Player={user:{id:string;name:string;username?:string};points:number;lifetimeEarned:number;referralCode:string};
type Leader={rank:number;name:string;points:number};
export default function TelegramApp(){
 const [initData,setInitData]=useState(""),[player,setPlayer]=useState<Player|null>(null),[leaders,setLeaders]=useState<Leader[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState("Open this Mini App inside Telegram to sign in.");
 const api=useCallback(async(path:string,method:"GET"|"POST"="GET",body?:unknown)=>{
  const r=await fetch(path,{method,headers:{"x-telegram-init-data":initData,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
  const d=await r.json();if(!r.ok)throw new Error(d.error??"Request failed");return d;
 },[initData]);
 const refresh=useCallback(async()=>{if(!initData)return;try{const p=await api("/api/telegram/auth","POST");setPlayer(p);const l=await api("/api/leaderboard");setLeaders(l.leaderboard);setMessage("You're signed in. Tap the coin to collect points.");}catch(e){setMessage(e instanceof Error?e.message:"Unable to connect.");}},[api,initData]);
 useEffect(()=>{const w=window.Telegram?.WebApp;if(w){w.ready();w.expand();setInitData(w.initData);}},[]);
 useEffect(()=>{if(initData)void refresh();},[initData,refresh]);
 async function tap(){if(!player||busy)return;setBusy(true);try{const d=await api("/api/game/tap","POST",{tapCount:1});setPlayer({...player,points:d.points,lifetimeEarned:player.lifetimeEarned+d.awarded});}catch(e){setMessage(e instanceof Error?e.message:"Tap failed.");}finally{setBusy(false);}}
 async function daily(){if(!player||busy)return;setBusy(true);try{const d=await api("/api/game/daily","POST");setPlayer({...player,points:d.points,lifetimeEarned:player.lifetimeEarned+d.awarded});setMessage("Daily reward claimed: +"+d.awarded+" points.");}catch(e){setMessage(e instanceof Error?e.message:"Claim failed.");}finally{setBusy(false);}}
 async function invite(){if(!player)return;const bot=process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;if(!bot){setMessage("Bot username is not configured yet.");return;}const link="https://t.me/"+bot+"?startapp="+player.referralCode;try{await navigator.clipboard.writeText(link);setMessage("Referral link copied.");}catch{setMessage(link);}}
 return <main className="game-shell"><header className="game-header"><div className="brand"><span className="brand-mark">P</span><span>PAY <b>AND</b> PLAY</span></div><span className="tag">TELEGRAM MINI APP</span></header>
 <section className="game-hero"><div className="eyebrow"><span className="pulse"/> PRE-LAUNCH REWARDS GAME</div><h1>Play more.<br/><span>Earn points.</span></h1><p className="intro">{player?"Welcome, "+player.user.name+". Your points are ready.":"Tap the coin, collect points and climb the leaderboard."}</p>
 <div className="balance-card"><span>YOUR POINTS</span><strong>{player?player.points.toLocaleString():"—"}</strong><small>Points only · no cash value at pre-launch</small></div>
 <button className={"tap-coin "+(busy?"is-busy":"")} onClick={tap} disabled={!player||busy} aria-label="Tap to earn points"><span>✦</span><small>TAP TO EARN</small></button>
 <p className="game-message" role="status">{message}</p><div className="game-actions"><button onClick={daily} disabled={!player||busy}>🎁 Claim daily reward</button><button onClick={invite} disabled={!player}>👥 Invite friends</button></div></section>
 <section className="leader-card"><div className="leader-heading"><div><span className="eyebrow">COMMUNITY</span><h2>Leaderboard</h2></div><span className="tag">TOP 20</span></div>
 {leaders.length?leaders.slice(0,10).map(x=><div className="leader-row" key={x.rank}><span className="rank">{x.rank}</span><span>{x.name}</span><b>{x.points.toLocaleString()} pts</b></div>):<p className="leader-empty">Leaderboard appears when players join.</p>}</section>
 <footer><span>© {new Date().getFullYear()} Pay and Play</span><span>PLAY FAIR. HAVE FUN.</span></footer></main>;
}