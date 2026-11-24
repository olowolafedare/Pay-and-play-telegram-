"use client";
import { useCallback, useEffect, useState } from "react";

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
  const [message, setMessage] = useState("Open this Mini App inside Telegram to play.");

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

  async function tap() {
    if (!player || busy) return;
    setBusy(true);
    try {
      const d = await api("/api/game/tap", "POST", { tapCount: 1 });
      setPlayer({ ...player, points: d.points, lifetimeEarned: player.lifetimeEarned + d.awarded });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Tap failed.");
    } finally {
      setBusy(false);
    }
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
        setMessage("Monetag confirmed a valued ad. Your 50-point reward is awaiting secure server credit.");
      } else {
        setMessage("Ad completed, but Monetag did not mark it as a paid event. No points awarded.");
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
      setPlayer({ ...player, points: d.points, lifetimeEarned: player.lifetimeEarned + d.awarded, dailyClaimed: true });
      setMessage("Daily reward claimed: +" + d.awarded + " points. Rewarded ads are now unlocked.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Claim failed.");
    } finally {
      setBusy(false);
    }
  }

  function invite() {
    if (!player) return;
    const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
    if (!bot) {
      setMessage("Bot username is not configured yet.");
      return;
    }
    const link = "https://t.me/" + bot + "?startapp=" + player.referralCode;
    const shareUrl = "https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent("Join me on Gome and play to earn points!");
    const webApp = window.Telegram?.WebApp;
    if (webApp?.openTelegramLink) webApp.openTelegramLink(shareUrl);
    else if (navigator.share) void navigator.share({ title: "Join Gome", text: "Play Gome with me!", url: link }).catch(() => undefined);
    else void navigator.clipboard.writeText(link).then(() => setMessage("Referral link copied."));
  }

  const nextLevel = player ? Math.min(10, player.tapLevel + 1) : 2;

  return (
    <main className="game-shell">
      <header className="game-header">
        <div className="brand"><span className="brand-mark">G</span><span>GOME <b>COIN</b></span></div>
        <span className="tag">MINI APP</span>
      </header>

      <section className="game-hero">
        <div className="eyebrow"><span className="pulse" /> TAP • PLAY • GROW</div>
        <div className="balance-card">
          <span>YOUR POINTS</span>
          <strong>{player ? player.points.toLocaleString() : "—"}</strong>
          <small>Game points · no cash value</small>
        </div>

        <button className={"tap-coin " + (busy ? "is-busy" : "")} onClick={tap} disabled={!player || busy} aria-label="Tap Gome coin to earn points">
          <span>G</span><small>GOME</small>
        </button>
        <div className="tap-power">{player ? player.tapLevel : 1} <span>POINT{player?.tapLevel === 1 ? "" : "S"} PER TAP</span></div>

        <div className="upgrade-card">
          <div className="upgrade-heading"><span>LEVEL {player?.tapLevel ?? 1}</span><b>{player?.upgradeProgress ?? 0}%</b></div>
          <div className="progress-track"><div className="progress-fill" style={{ width: (player?.upgradeProgress ?? 0) + "%" }} /></div>
          <div className="upgrade-footer"><span>UPGRADE PROGRESS</span><strong>{player?.tapLevel === 10 ? "MAX LEVEL" : "NEXT: LEVEL " + nextLevel}</strong></div>
        </div>

        <p className="game-message" role="status">{message}</p>
        <div className="game-actions">
          <button className="ad-button" onClick={watchAd} disabled={!player?.dailyClaimed || busy} title={!player?.dailyClaimed ? "Claim your 100 daily points first" : "Watch a Monetag rewarded interstitial"}>▶ Watch ad · +50 <small>{!player?.dailyClaimed ? "CLAIM DAILY FIRST" : "REWARDED AD"}</small></button>
          <button onClick={daily} disabled={!player || busy || player.dailyClaimed}>🎁 {player?.dailyClaimed ? "Daily claimed" : "Claim 100 daily points"}</button>
          <button onClick={invite} disabled={!player}>↗ Share & invite</button>
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
