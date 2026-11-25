"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready: () => void;
        expand: () => void;
        openTelegramLink?: (url: string) => void;
        HapticFeedback?: { impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void; notificationOccurred?: (type: "error" | "success" | "warning") => void };
      };
    };
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
  energy: number;
  maxEnergy: number;
  energyRegenPerSecond: number;
};
type Leader = { rank: number; name: string; points: number };
type Float = { id: number; x: number; y: number; value: number };
type Batch = { taps: number; batchId: string };

class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const FLUSH_INTERVAL_MS = 1000;
const MAX_BATCH = 300;

export default function TelegramApp() {
  const [initData, setInitData] = useState("");
  const [player, setPlayer] = useState<Player | null>(null);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [busy, setBusy] = useState(false); // daily / ad actions only — never blocks tapping
  const [message, setMessage] = useState("Open this Mini App inside Telegram to play.");
  const [energy, setEnergy] = useState(0);
  const [unsent, setUnsent] = useState(0); // taps shown on screen but not yet confirmed by the server
  const [floats, setFloats] = useState<Float[]>([]);

  // Refs hold the live tap state so rapid taps never wait on React re-renders or the network.
  const energyRef = useRef(0);
  const pendingRef = useRef(0);
  const inflightRef = useRef<Batch | null>(null);
  const sendingRef = useRef(false);
  const playerRef = useRef<Player | null>(null);
  const floatId = useRef(0);
  const coinRef = useRef<HTMLButtonElement>(null);
  const lastEmptyWarn = useRef(0);

  useEffect(() => { playerRef.current = player; }, [player]);

  const syncUnsent = () => setUnsent(pendingRef.current + (inflightRef.current?.taps ?? 0));
  const setEnergyBoth = (v: number) => { energyRef.current = v; setEnergy(v); };

  const api = useCallback(async (path: string, method: "GET" | "POST" = "GET", body?: unknown, keepalive = false) => {
    const r = await fetch(path, {
      method,
      keepalive,
      headers: { "x-telegram-init-data": initData, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(d.error ?? "Request failed", r.status);
    return d;
  }, [initData]);

  const refresh = useCallback(async () => {
    if (!initData) return;
    try {
      const p: Player = await api("/api/telegram/auth", "POST");
      setPlayer(p);
      setEnergyBoth(Math.max(0, p.energy - pendingRef.current));
      const l = await api("/api/leaderboard");
      setLeaders(l.leaderboard);
      setMessage("Tap the Gome coin to collect points.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to connect.");
    }
  }, [api, initData]);

  /** Send queued taps as one batch. A failed network send is retried with the same batchId, so it can't be double-counted. */
  const flush = useCallback(async (keepalive = false) => {
    if (sendingRef.current || !playerRef.current) return;
    if (!inflightRef.current && pendingRef.current > 0) {
      const taps = Math.min(MAX_BATCH, pendingRef.current);
      pendingRef.current -= taps;
      inflightRef.current = { taps, batchId: crypto.randomUUID() };
    }
    const batch = inflightRef.current;
    if (!batch) return;
    sendingRef.current = true;
    try {
      const d = await api("/api/game/tap", "POST", { taps: batch.taps, batchId: batch.batchId }, keepalive);
      inflightRef.current = null;
      setPlayer(p => (p ? { ...p, points: d.points, tapLevel: d.tapPower ?? p.tapLevel, lifetimeEarned: p.lifetimeEarned + (d.awarded ?? 0) } : p));
      setEnergyBoth(Math.max(0, Number(d.energy) - pendingRef.current));
      if (!d.duplicate && d.accepted < batch.taps) setMessage("Some taps weren't counted. Slow down a little or wait for energy to refill.");
    } catch (e) {
      if (e instanceof ApiError) {
        // The server rejected it (e.g. session expired) — drop the batch instead of retrying forever.
        inflightRef.current = null;
        setMessage(e.status === 401 ? "Session expired. Close and reopen the Mini App." : e.message);
      }
      // Otherwise it's a network error: keep the batch and retry on the next tick.
    } finally {
      sendingRef.current = false;
      syncUnsent();
    }
  }, [api]);

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

  // Background batching + send whatever is left when the app is hidden or closed.
  useEffect(() => {
    const t = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    const onHide = () => { if (document.visibilityState === "hidden") void flush(true); };
    const onPageHide = () => void flush(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", onPageHide); };
  }, [flush]);

  // Energy refills locally between server confirmations.
  useEffect(() => {
    if (!player) return;
    const t = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      if (energyRef.current < p.maxEnergy) setEnergyBoth(Math.min(p.maxEnergy, energyRef.current + p.energyRegenPerSecond));
    }, 1000);
    return () => clearInterval(t);
  }, [player]);

  function registerTap(clientX?: number, clientY?: number) {
    const p = playerRef.current;
    if (!p) return;
    if (energyRef.current < 1) {
      const now = Date.now();
      if (now - lastEmptyWarn.current > 1500) {
        lastEmptyWarn.current = now;
        setMessage("Out of energy. It refills automatically, so come back in a bit.");
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("warning");
      }
      return;
    }
    setEnergyBoth(energyRef.current - 1);
    pendingRef.current += 1;
    syncUnsent();
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");

    const rect = coinRef.current?.getBoundingClientRect();
    const x = rect && clientX !== undefined ? clientX - rect.left : (rect?.width ?? 180) / 2;
    const y = rect && clientY !== undefined ? clientY - rect.top : (rect?.height ?? 180) / 2;
    const id = ++floatId.current;
    setFloats(f => [...f.slice(-24), { id, x, y, value: p.tapLevel }]);
    setTimeout(() => setFloats(f => f.filter(item => item.id !== id)), 900);

    if (pendingRef.current >= MAX_BATCH) void flush();
  }

  function onCoinPointerDown(e: PointerEvent<HTMLButtonElement>) {
    e.preventDefault(); // every finger counts; no double-firing from click
    registerTap(e.clientX, e.clientY);
  }
  function onCoinKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); registerTap(); }
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
        setMessage("Ad confirmed. Your 50 points will appear in a few seconds.");
        setTimeout(() => void refresh(), 5000);
        setTimeout(() => void refresh(), 15000);
      } else {
        setMessage("Ad completed, but it wasn't marked as a rewarded view. No points awarded.");
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
      setPlayer(p => (p ? { ...p, points: d.points, lifetimeEarned: p.lifetimeEarned + d.awarded, dailyClaimed: true } : p));
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
  const shownPoints = player ? player.points + unsent * player.tapLevel : null;
  const maxEnergy = player?.maxEnergy ?? 1000;
  const energyPct = player ? Math.round((energy / maxEnergy) * 100) : 0;
  const empty = !!player && energy < 1;

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
          <strong>{shownPoints !== null ? shownPoints.toLocaleString() : "—"}</strong>
          <small>Game points · no cash value</small>
        </div>

        <div className="coin-wrap">
          <button
            ref={coinRef}
            className={"tap-coin" + (empty ? " is-empty" : "")}
            onPointerDown={onCoinPointerDown}
            onKeyDown={onCoinKey}
            onContextMenu={(e: { preventDefault: () => void }) => e.preventDefault()}
            disabled={!player}
            aria-label="Tap Gome coin to earn points"
          >
            <span>G</span><small>GOME</small>
            {floats.map(f => <i key={f.id} className="tap-float" style={{ left: f.x, top: f.y }}>+{f.value}</i>)}
          </button>
        </div>
        <div className="tap-power">{player ? player.tapLevel : 1} <span>POINT{player?.tapLevel === 1 ? "" : "S"} PER TAP</span></div>

        <div className="energy-card" aria-label={"Energy " + energy + " of " + maxEnergy}>
          <div className="energy-heading"><span>⚡ ENERGY</span><b>{player ? energy.toLocaleString() : "—"} <small>/ {maxEnergy.toLocaleString()}</small></b></div>
          <div className="energy-track"><div className="energy-fill" style={{ width: energyPct + "%" }} /></div>
          <div className="energy-footer">{player ? (energy >= maxEnergy ? "FULL" : "+" + player.energyRegenPerSecond + " / SEC") : ""}</div>
        </div>

        <div className="upgrade-card">
          <div className="upgrade-heading"><span>LEVEL {player?.tapLevel ?? 1}</span><b>{player?.upgradeProgress ?? 0}%</b></div>
          <div className="progress-track"><div className="progress-fill" style={{ width: (player?.upgradeProgress ?? 0) + "%" }} /></div>
          <div className="upgrade-footer"><span>UPGRADE PROGRESS</span><strong>{player?.tapLevel === 10 ? "MAX LEVEL" : "NEXT: LEVEL " + nextLevel}</strong></div>
        </div>

        <p className="game-message" role="status">{message}</p>
        <div className="game-actions">
          <button className="ad-button" onClick={watchAd} disabled={!player?.dailyClaimed || busy} title={!player?.dailyClaimed ? "Claim your daily points first" : "Watch a Monetag rewarded interstitial"}>▶ Watch ad · +50 <small>{!player?.dailyClaimed ? "CLAIM DAILY FIRST" : "REWARDED AD"}</small></button>
          <button onClick={daily} disabled={!player || busy || player.dailyClaimed}>🎁 {player?.dailyClaimed ? "Daily claimed" : "Claim daily points"}</button>
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
