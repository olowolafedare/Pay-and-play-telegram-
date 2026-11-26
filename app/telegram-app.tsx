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
  /** Gome coin in hundredths (100 energy = 1 Gome). */
  gomeCents: number;
  energy: number;
  maxEnergy: number;
  tapPower: number;
  level: number;
  adsWatched: number;
  nextLevelAds: number | null;
  levelProgress: number;
  dailyClaimed: boolean;
  friendsInvited: number;
  referralCode: string;
};
type Leader = { rank: number; name: string; gomeCents: number };
type Float = { id: number; x: number; y: number; label: string };
type Batch = { taps: number; used: number; batchId: string };

class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const FLUSH_INTERVAL_MS = 1000;
const MAX_BATCH = 300;
const formatGome = (cents: number) => (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TelegramApp() {
  const [initData, setInitData] = useState("");
  const [player, setPlayer] = useState<Player | null>(null);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [busy, setBusy] = useState(false); // daily / ad actions only — never blocks tapping
  const [message, setMessage] = useState("Open this Mini App inside Telegram to play.");
  const [energy, setEnergy] = useState(0);
  const [unsentCents, setUnsentCents] = useState(0); // Gome shown on screen but not yet confirmed by the server
  const [floats, setFloats] = useState<Float[]>([]);

  // Refs hold the live tap state so rapid taps never wait on React re-renders or the network.
  const energyRef = useRef(0);
  const pendingTapsRef = useRef(0);
  const pendingUsedRef = useRef(0);
  const inflightRef = useRef<Batch | null>(null);
  const sendingRef = useRef(false);
  const playerRef = useRef<Player | null>(null);
  const floatId = useRef(0);
  const coinRef = useRef<HTMLButtonElement>(null);
  const lastEmptyWarn = useRef(0);

  useEffect(() => { playerRef.current = player; }, [player]);

  const unconfirmedUsed = () => pendingUsedRef.current + (inflightRef.current?.used ?? 0);
  const syncUnsent = () => setUnsentCents(unconfirmedUsed());
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

  const refresh = useCallback(async (afterAd = false) => {
    if (!initData) return;
    try {
      const before = playerRef.current;
      const p: Player = await api("/api/telegram/auth", "POST");
      setPlayer(p);
      setEnergyBoth(Math.max(0, p.energy - unconfirmedUsed()));
      const l = await api("/api/leaderboard");
      setLeaders(l.leaderboard);
      if (before && p.level > before.level) {
        setMessage("🎉 Level up! You're now Level " + p.level + ": " + p.tapPower + " energy per tap, " + p.maxEnergy.toLocaleString() + " max energy.");
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
      } else if (afterAd && before && p.adsWatched > before.adsWatched) {
        setMessage("Energy refilled! Tap the coin to collect your Gome.");
      } else if (!afterAd) {
        setMessage(p.energy > 0 ? "Tap the Gome coin to turn your energy into Gome." : "Out of energy. Watch an ad to refill.");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to connect.");
    }
  }, [api, initData]);

  /** Send queued taps as one batch. A failed network send is retried with the same batchId, so it can't be double-counted. */
  const flush = useCallback(async (keepalive = false) => {
    if (sendingRef.current || !playerRef.current) return;
    if (!inflightRef.current && pendingTapsRef.current > 0) {
      const taps = Math.min(MAX_BATCH, pendingTapsRef.current);
      const share = taps === pendingTapsRef.current ? pendingUsedRef.current : Math.round(pendingUsedRef.current * (taps / pendingTapsRef.current));
      pendingTapsRef.current -= taps;
      pendingUsedRef.current -= share;
      inflightRef.current = { taps, used: share, batchId: crypto.randomUUID() };
    }
    const batch = inflightRef.current;
    if (!batch) return;
    sendingRef.current = true;
    try {
      const d = await api("/api/game/tap", "POST", { taps: batch.taps, batchId: batch.batchId }, keepalive);
      inflightRef.current = null;
      setPlayer(p => (p ? { ...p, gomeCents: d.gomeCents, maxEnergy: d.maxEnergy ?? p.maxEnergy, tapPower: d.tapPower ?? p.tapPower } : p));
      setEnergyBoth(Math.max(0, Number(d.energy) - pendingUsedRef.current));
      if (!d.duplicate && d.energyUsed < batch.used) setMessage("Some taps weren't counted. Slow down a little.");
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

  function registerTap(clientX?: number, clientY?: number) {
    const p = playerRef.current;
    if (!p) return;
    if (energyRef.current < 1) {
      const now = Date.now();
      if (now - lastEmptyWarn.current > 1500) {
        lastEmptyWarn.current = now;
        setMessage(p.dailyClaimed ? "Out of energy. Watch an ad to refill your energy." : "Out of energy. Claim your daily full energy, then watch ads to refill.");
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("warning");
      }
      return;
    }
    const used = Math.min(p.tapPower, energyRef.current);
    setEnergyBoth(energyRef.current - used);
    pendingTapsRef.current += 1;
    pendingUsedRef.current += used;
    syncUnsent();
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");

    const rect = coinRef.current?.getBoundingClientRect();
    const x = rect && clientX !== undefined ? clientX - rect.left : (rect?.width ?? 180) / 2;
    const y = rect && clientY !== undefined ? clientY - rect.top : (rect?.height ?? 180) / 2;
    const id = ++floatId.current;
    setFloats(f => [...f.slice(-24), { id, x, y, label: "+" + (used / 100).toFixed(2) }]);
    setTimeout(() => setFloats(f => f.filter(item => item.id !== id)), 900);

    if (pendingTapsRef.current >= MAX_BATCH) void flush();
  }

  function onCoinPointerDown(e: PointerEvent<HTMLButtonElement>) {
    e.preventDefault(); // every finger counts; no double-firing from click
    registerTap(e.clientX, e.clientY);
  }
  function onCoinKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); registerTap(); }
  }

  /** After an ad closes, poll the server (the source of truth) until Monetag's confirmation lands. */
  async function waitForAdCredit(adsBefore: number) {
    for (const delay of [3000, 5000, 8000, 12000, 15000]) {
      await new Promise(r => setTimeout(r, delay));
      try {
        const p: Player = await api("/api/telegram/auth", "POST");
        if (p.adsWatched > adsBefore) {
          const leveledUp = playerRef.current ? p.level > playerRef.current.level : false;
          setPlayer(p);
          setEnergyBoth(Math.max(0, p.energy - unconfirmedUsed()));
          setMessage(leveledUp
            ? "🎉 Level up! You're now Level " + p.level + ": " + p.tapPower + " energy per tap, " + p.maxEnergy.toLocaleString() + " max energy."
            : "⚡ Energy refilled! Tap the coin to collect your Gome.");
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
          return;
        }
      } catch { /* network hiccup: keep waiting */ }
    }
    setMessage("No reward was confirmed for that ad. Only fully watched, paid ads refill energy. Please try another.");
  }

  async function watchAd() {
    if (!player || !player.dailyClaimed || busy) return;
    const showAd = window.show_12342383;
    if (!showAd) { setMessage("Ad service is still loading. Please try again in a moment."); return; }
    setBusy(true);
    setMessage("Loading ad...");
    const adsBefore = player.adsWatched;
    try {
      await flush(); // save taps first so the refill isn't overwritten on screen
      const ymid = "gome_" + player.user.id + "_" + crypto.randomUUID().replace(/-/g, "");
      const result = await showAd({ ymid, requestVar: "energy_refill_ad" });
      if (result?.reward_event_type === "non_valued") {
        setMessage("That ad wasn't a paid view, so there's no refill this time. Please try another.");
      } else {
        setMessage("Checking your reward...");
        await waitForAdCredit(adsBefore);
      }
    } catch {
      // The ad may have been closed early or failed to load; the server still decides, so check once more.
      setMessage("Checking your reward...");
      await waitForAdCredit(adsBefore);
    } finally {
      setBusy(false);
    }
  }

  async function daily() {
    if (!player || busy) return;
    setBusy(true);
    try {
      await flush();
      const d = await api("/api/game/daily", "POST");
      setPlayer(p => (p ? { ...p, dailyClaimed: true, maxEnergy: d.maxEnergy } : p));
      setEnergyBoth(Math.max(0, d.energy - unconfirmedUsed()));
      setMessage("Daily energy claimed: full " + Number(d.energy).toLocaleString() + " energy. Ads are now unlocked.");
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
    const shareUrl = "https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent("Join me on Gome Coin: watch, tap and earn Gome!");
    const webApp = window.Telegram?.WebApp;
    if (webApp?.openTelegramLink) webApp.openTelegramLink(shareUrl);
    else if (navigator.share) void navigator.share({ title: "Join Gome Coin", text: "Watch, tap and earn Gome!", url: link }).catch(() => undefined);
    else void navigator.clipboard.writeText(link).then(() => setMessage("Referral link copied."));
  }

  const shownCents = player ? player.gomeCents + unsentCents : null;
  const maxEnergy = player?.maxEnergy ?? 1000;
  const energyPct = player ? Math.min(100, Math.round((energy / maxEnergy) * 100)) : 0;
  const empty = !!player && energy < 1;
  const atMax = !!player && player.nextLevelAds === null;

  return (
    <main className="game-shell">
      <header className="game-header">
        <div className="brand"><span className="brand-mark">G</span><span>GOME <b>COIN</b></span></div>
        <span className="tag">MINI APP</span>
      </header>

      <section className="game-hero">
        <div className="eyebrow"><span className="pulse" /> WATCH • TAP • EARN</div>
        <div className="balance-card">
          <span>YOUR GOME COIN</span>
          <strong>{shownCents !== null ? formatGome(shownCents) : "—"}</strong>
          <small>100 energy = 1 Gome</small>
        </div>

        <div className="coin-wrap">
          <button
            ref={coinRef}
            className={"tap-coin" + (empty ? " is-empty" : "")}
            onPointerDown={onCoinPointerDown}
            onKeyDown={onCoinKey}
            onContextMenu={(e: { preventDefault: () => void }) => e.preventDefault()}
            disabled={!player}
            aria-label="Tap Gome coin to turn energy into Gome"
          >
            <span>G</span><small>GOME</small>
            {floats.map(f => <i key={f.id} className="tap-float" style={{ left: f.x, top: f.y }}>{f.label}</i>)}
          </button>
        </div>
        <div className="tap-power">{player ? player.tapPower : 1} <span>ENERGY PER TAP · +{((player?.tapPower ?? 1) / 100).toFixed(2)} GOME</span></div>

        <div className="energy-card" aria-label={"Energy " + energy + " of " + maxEnergy}>
          <div className="energy-heading"><span>⚡ ENERGY</span><b>{player ? energy.toLocaleString() : "—"} <small>/ {maxEnergy.toLocaleString()}</small></b></div>
          <div className="energy-track"><div className="energy-fill" style={{ width: energyPct + "%" }} /></div>
          <div className="energy-footer">{player ? (energy >= maxEnergy ? "FULL" : "WATCH AN AD TO REFILL") : ""}</div>
        </div>

        <div className="upgrade-card">
          <div className="upgrade-heading"><span>LEVEL {player?.level ?? 1}</span><b>{atMax ? "MAX" : (player?.levelProgress ?? 0) + "%"}</b></div>
          <div className="progress-track"><div className="progress-fill" style={{ width: (player?.levelProgress ?? 0) + "%" }} /></div>
          <div className="upgrade-footer">
            <span>{player ? player.adsWatched.toLocaleString() + (atMax ? " ADS WATCHED" : " / " + (player.nextLevelAds ?? 0).toLocaleString() + " ADS") : "ADS WATCHED"}</span>
            <strong>{atMax ? "MAX LEVEL" : "NEXT: LEVEL " + ((player?.level ?? 1) + 1)}</strong>
          </div>
        </div>

        <p className="game-message" role="status">{message}</p>
        <div className="game-actions">
          <button className="ad-button" onClick={watchAd} disabled={!player?.dailyClaimed || busy} title={!player?.dailyClaimed ? "Claim your daily energy first" : "Watch a rewarded ad to refill your energy"}>▶ Watch ad · Refill energy <small>{!player?.dailyClaimed ? "CLAIM DAILY ENERGY FIRST" : "COUNTS TOWARD NEXT LEVEL"}</small></button>
          <button onClick={daily} disabled={!player || busy || player.dailyClaimed}>🎁 {player?.dailyClaimed ? "Daily claimed" : "Daily full energy"}</button>
          <button onClick={invite} disabled={!player}>↗ Invite · +10 Gome</button>
        </div>
        {player && player.friendsInvited > 0 ? <p className="invite-note">{player.friendsInvited} friend{player.friendsInvited === 1 ? "" : "s"} invited</p> : null}
      </section>

      <section className="leader-card">
        <div className="leader-heading"><div><span className="eyebrow">COMMUNITY</span><h2>Leaderboard</h2></div><span className="tag">TOP 20</span></div>
        {leaders.length ? leaders.slice(0, 10).map(x => <div className="leader-row" key={x.rank}><span className="rank">{x.rank}</span><span>{x.name}</span><b>{formatGome(x.gomeCents)} GOME</b></div>) : <p className="leader-empty">Leaderboard appears when players join.</p>}
      </section>
      <footer><span>© {new Date().getFullYear()} Gome</span><span>PLAY FAIR. HAVE FUN.</span></footer>
    </main>
  );
}
