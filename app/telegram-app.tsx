"use client";
import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData: string; ready: () => void; expand: () => void; openTelegramLink?: (url: string) => void } };
    show_12342383?: (options?: { ymid?: string; requestVar?: string }) => Promise<{ reward_event_type?: "valued" | "non_valued"; variable2?: string } | undefined>;
  }
}

type Player = {
  user: { id: string; name: string; username?: string };
  points: number;
  lifetimeEarned: number;
  adPointsEarned: number;
  tapLevel: number;
  upgradeProgress: number;
  dailyClaimed: boolean;
  referralCode: string;
};
type Leader = { rank: number; name: string; points: number };

export default function TelegramApp() {
  const [initData, setInitData] = useState("");
  const [player, setPlayer] = useState<Player | null>(null);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [busy, setBusy] = useState(false);
  const [tapPending, setTapPending] = useState(0);
  const [message, setMessage] = useState("Open this Mini App inside Telegram to play.");
  const tapQueue = useRef(0);
  const tapRunning = useRef(false);

  const api = useCallback(async (path: string, method: "GET" | "POST" = "GET", body?: unknown) => {
    const r = await fetch(path, {
      method,
      headers: { "x-telegram-init-data": initData, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Request failed");
    return d;
  }, [initData]);

  const refresh = useCallback(async () => {
    if (!initData) return;
    try {
      const p = await api("/api/telegram/auth", "POST");
      setPlayer(p);
      const l = await api("/api/leaderboard");
      setLeaders(l.leaderboard);
      setMessage("Tap the Gome coin to collect points.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to connect.");
    }
  }, [api, initData]);

  useEffect(() => {
    const w = window.Telegram?.WebApp;
    if (w) {
      w.ready();
      w.expand();
      setInitData(w.initData);
    }
  }, []);

  useEffect(() => {
    if (initData) void refresh();
  }, [initData, refresh]);

  const drainTapQueue = useCallback(async () => {
    if (tapRunning.current) return;
    tapRunning.current = true;
    while (tapQueue.current > 0) {
      tapQueue.current -= 1;
      setTapPending(tapQueue.current);
      try {
        const d = await api("/api/game/tap", "POST", { tapCount: 1 });
        setPlayer(previous => previous ? {
          ...previous,
          points: d.points,
          lifetimeEarned: previous.lifetimeEarned + d.awarded,
          tapLevel: d.tapPower ?? previous.tapLevel,
        } : previous);
        setMessage("+" + d.awarded + " point" + (d.awarded === 1 ? "" : "s") + " collected.");
      } catch (e) {
        tapQueue.current = 0;
        setTapPending(0);
        setMessage(e instanceof Error ? e.message : "Tap failed. Please try again.");
        break;
      }
      if (tapQueue.current > 0) await new Promise(resolve => setTimeout(resolve, 270));
    }
    tapRunning.current = false;
    setTapPending(0);
  }, [api]);

  function tap() {
    if (!player) return;
    tapQueue.current = Math.min(tapQueue.current + 1, 20);
    setTapPending(tapQueue.current);
    void drainTapQueue();
  }

  async function watchAd() {
    if (!player || !player.dailyClaimed || busy) return;
    const showAd = window.show_12342383;
    if (!showAd) { setMessage("Ad service is still loading. Please try again."); return; }
    setBusy(true);
    try {
      const ymid = "gome_" + player.user.id + "_" + crypto.randomUUID().replace(/-/g, "");
      const result = await showAd({ ymid, requestVar: "daily_reward_ad" });
      if (result?.reward_event_type === "valued") {
        setMessage("Valued ad confirmed. Checking for your secure 50-point credit…");
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 1800));
          const p = await api("/api/telegram/auth", "POST");
          setPlayer(p);
          if (p.adPointsEarned > player.adPointsEarned) {
            setMessage("Reward credited: +50 points.");
            break;
          }
          if (attempt === 4) setMessage("Ad confirmed. The server credit is still processing; your balance will refresh shortly.");
        }
      } else {
        setMessage("Ad completed, but Monetag did not mark it as a valued event. No points awarded.");
      }
    } catch {
      setMessage("The ad could not be verified. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function daily() {
    if (!player || busy) return;
    setBusy(true);
    try {
      const d = await api("/api/game/daily", "POST");
      setPlayer(previous => previous ? { ...previous, points: d.points, lifetimeEarned: previous.lifetimeEarned + d.awarded, dailyClaimed: true } : previous);
      setMessage("Daily reward claimed: +" + d.awarded + " points. Rewarded ads are now unlocked.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Claim failed.");
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    if (!player) return;
    const link = "https://t.me/Payandplayxedruobot/Gomecoin?startapp=" + encodeURIComponent(player.referralCode);
    const shareUrl = "https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent("Join me on Gome! You can earn points by playing. I get 10 Gome Coins when you join through my invite.");
    try {
      const webApp = window.Telegram?.WebApp;
      if (webApp?.openTelegramLink) {
        webApp.openTelegramLink(shareUrl);
        setMessage("Choose a Telegram chat to share your personal invite link.");
      } else if (navigator.share) {
        await navigator.share({ title: "Join Gome", text: "Play Gome with me! Join through my invite and help me earn 10 Gome Coins.", url: link });
        setMessage("Your invite link is ready to share.");
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        setMessage("Your personal invite link has been copied.");
      } else {
        window.prompt("Copy your Gome invite link:", link);
      }
    } catch {
      setMessage("Sharing was cancelled. You can try again.");
    }
  }

  const nextLevel = player ? Math.min(10, player.tapLevel + 1) : 2;
  const generatedCoins = player ? Math.floor(player.lifetimeEarned / 10) : 0;

  return (
    <main className="game-shell">
      <header className="game-header">
        <div className="brand"><span className="brand-mark">G</span><span>GOME <b>COIN</b></span></div>
        <span className="tag">TAP TO EARN</span>
      </header>

      <section className="game-hero">
        <div className="eyebrow"><span className="pulse" /> YOUR GOME JOURNEY</div>
        <div className="balance-card">
          <span>AVAILABLE GAME POINTS</span>
          <strong>{player ? player.points.toLocaleString() : "—"}</strong>
          <small>Points earned through play · not cash</small>
        </div>

        <div className="coin-total">
          <span>GOME COINS GENERATED</span>
          <strong>◈ {generatedCoins.toLocaleString()}</strong>
          <small>10 lifetime points = 1 Gome Coin · referral bonus: 10 Gome Coins</small>
        </div>

        <button className={"tap-coin " + (tapPending > 0 ? "is-busy" : "")} onClick={tap} disabled={!player} aria-label="Tap Gome coin to earn points">
          <span>G</span><small>GOME</small>
        </button>
        <div className="tap-power">{player ? player.tapLevel : 1} <span>POINT{player?.tapLevel === 1 ? "" : "S"} PER TAP</span></div>
        {tapPending > 0 && <p className="tap-queue">{tapPending} tap{tapPending === 1 ? "" : "s"} queued</p>}

        <div className="upgrade-card">
          <div className="upgrade-heading"><span>LEVEL {player?.tapLevel ?? 1}</span><b>{player?.upgradeProgress ?? 0}%</b></div>
          <div className="progress-track"><div className="progress-fill" style={{ width: (player?.upgradeProgress ?? 0) + "%" }} /></div>
          <div className="upgrade-footer"><span>AD POINT UPGRADE PROGRESS</span><strong>{player?.tapLevel === 10 ? "MAX LEVEL" : "NEXT: LEVEL " + nextLevel}</strong></div>
          <div className="ad-points-total">Verified ad points: {(player?.adPointsEarned ?? 0).toLocaleString()}</div>
        </div>

        <p className="game-message" role="status">{message}</p>
        <div className="game-actions">
          <button className="ad-button" onClick={watchAd} disabled={!player?.dailyClaimed || busy} title={!player?.dailyClaimed ? "Claim your 100 daily points first" : "Watch a Monetag rewarded interstitial"}>▶ Watch ad · +50 <small>{!player?.dailyClaimed ? "CLAIM DAILY FIRST" : "REWARDED AD"}</small></button>
          <button onClick={daily} disabled={!player || busy || player.dailyClaimed}>🎁 {player?.dailyClaimed ? "Daily claimed" : "Claim 100 daily points"}</button>
          <button onClick={invite} disabled={!player}>↗ Invite & earn 10 Gome Coins</button>
        </div>
      </section>

      <section className="leader-card">
        <div className="leader-heading"><div><span className="eyebrow">COMMUNITY</span><h2>Leaderboard</h2></div><span className="tag">TOP 20</span></div>
        {leaders.length ? leaders.slice(0, 10).map(x => <div className="leader-row" key={x.rank}><span className="rank">{x.rank}</span><span>{x.name}</span><b>{x.points.toLocaleString()} pts</b></div>) : <p className="leader-empty">Leaderboard appears when players join.</p>}
      </section>
      <footer><span>© {new Date().getFullYear()} Gome</span><span>PLAY FAIR. HAVE FUN.</span></footer>
    </main>
  );
}
