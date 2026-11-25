# Pay and Play Telegram Mini App (Gome Coin)

Separate pre-launch game for tapping, rewards points, daily claims, rewarded ads and leaderboard. It is not the Pay and Play financial wallet.

## Stack
Next.js + TypeScript, Telegram Mini Apps signed initData verification, Neon PostgreSQL, Vercel, Monetag rewarded ads.

## Game rules
- **Watch → tap → earn.** Gome coin is only earned by spending energy: **100 energy = 1 Gome**.
- **Energy never refills by itself.** It is refilled to the level's max by **a confirmed Monetag ad**
  or by the **daily reward** (once per day; claiming it also unlocks ads for the day).
  New players start with a full 1,000.
- **Each tap spends energy equal to the tap power** (= level). Higher levels collect a bar faster,
  and their bigger bar is worth more Gome per ad.
- **Levels come from total confirmed ads watched:**

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Ads watched | 0 | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 |
| Max energy | 1000 | 1000 | 1200 | 1400 | 1600 | 1800 | 2100 | 2400 | 2700 | 3000 |
| Tap power | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| Gome per full bar | 10 | 10 | 12 | 14 | 16 | 18 | 21 | 24 | 27 | 30 |

- **Referral:** +10 Gome to the inviter when a brand-new player first opens the game through their link
  (no self-invites; each player can only be referred once).
- Rules live in `lib/game.ts` (level table, conversion, referral bonus).
- Balances are stored in hundredths of a Gome in `rewards_wallets.points` (1234 = 12.34 Gome).
- Every confirmed ad is stored in `rewarded_ad_events` with Monetag's `estimated_price`, so total ad revenue
  can be added up, e.g. `SELECT SUM(estimated_price), COUNT(*) FROM rewarded_ad_events;`

## How tapping works
Taps count instantly on the phone (floating +Gome and haptic buzz) and are sent to the server in batches
about once a second, plus when the app is closed or hidden. The server is the source of truth: it caps every
batch by the player's real energy, a human tap-rate limit (15/sec + burst of 30) and 300 taps per request.
Each batch has a unique id, so a retry after a dropped connection is never counted twice.

## Environment
See `.env.example`.
- `DATABASE_URL`: Neon connection string (dedicated Telegram branch).
- `TELEGRAM_BOT_TOKEN`: from @BotFather. Add privately in Vercel. Never commit it.
- `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`: bot username without @.
- `MONETAG_POSTBACK_SECRET`: shared secret for the Monetag postback URL.
- `REWARDED_AD_WEBHOOK_SECRET`: optional, for a non-Monetag ad provider.
- `GAME_MAX_TAPS_PER_SECOND` (default 15), `GAME_TAP_BURST` (default 30): optional anti-cheat tuning.

## Go-live steps
1. **Database:** create a Neon project, open its SQL editor and run `db/schema.sql`.
   (If the tables already exist from an older version, run the files in `db/migrations/` in order
   instead. Existing player data is kept.) Before the public launch, run `db/reset_for_launch.sql`
   to set every player back to 0 Gome / Level 1 / full energy.
2. **Bot:** in Telegram, message @BotFather → `/newbot` → copy the token and username.
3. **Deploy:** push this repo to GitHub, import it in Vercel, add the env variables, deploy.
   Check `https://<your-app>.vercel.app/api/health` returns `{"status":"ok"}`.
4. **Mini App:** in @BotFather → `/mybots` → your bot → Bot Settings → Configure Mini App →
   enable it and set the URL to `https://<your-app>.vercel.app`. Optionally set it as the menu button.
5. **Monetag:** in the Monetag dashboard for zone `12342383` (replace with your own zone in
   `app/layout.tsx`, `app/telegram-app.tsx` and `app/api/monetag/postback/route.ts` if different),
   set the postback URL to:
   `https://<your-app>.vercel.app/api/monetag/postback?secret=<MONETAG_POSTBACK_SECRET>&zone_id={zone_id}&event_type={event_type}&reward_event_type={reward_event_type}&ymid={ymid}&estimated_price={estimated_price}`
   (use the exact macro names Monetag shows in its postback settings).
6. Open the bot in Telegram and tap **Open** / the menu button to play.

Referral links look like `https://t.me/<bot>?startapp=ref_<telegramId>`.

## Run locally
`cp .env.example .env.local`, fill it in, then `npm install && npm run dev`.
The game only signs in inside Telegram (it needs signed `initData`), so test the real flow through
the bot, using a tunnel such as ngrok or a Vercel preview URL.

The server validates Telegram's HMAC-signed initData. It does not trust initDataUnsafe. Gome balances are in-app records only; this app has no deposits, withdrawals or crypto wallet. Launching Gome as a token with a real price will need published rules and a legal review of the countries it is offered in.
