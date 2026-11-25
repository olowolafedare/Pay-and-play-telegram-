# Pay and Play Telegram Mini App (Gome Coin)

Separate pre-launch game for tapping, rewards points, daily claims, rewarded ads and leaderboard. It is not the Pay and Play financial wallet.

## Stack
Next.js + TypeScript, Telegram Mini Apps signed initData verification, Neon PostgreSQL, Vercel, Monetag rewarded ads.

## How tapping works
Taps count instantly on the phone (with a floating +N and haptic buzz) and are sent to the server in
batches about once a second, plus when the app is closed or hidden. Each tap costs 1 energy; energy refills
over time. The server is the source of truth: it caps every batch by the player's real energy, a human
tap-rate limit (15/sec + burst of 30) and 300 taps per request. Each batch has a unique id, so a retry
after a dropped connection is never counted twice.

## Environment
See `.env.example`.
- `GAME_MAX_ENERGY` (default 1000), `GAME_ENERGY_REGEN_PER_SECOND` (default 1),
  `GAME_MAX_TAPS_PER_SECOND` (default 15), `GAME_TAP_BURST` (default 30): optional tuning.
- `DATABASE_URL`: Neon connection string (dedicated Telegram branch).
- `TELEGRAM_BOT_TOKEN`: from @BotFather. Add privately in Vercel. Never commit it.
- `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`: bot username without @.
- `GAME_DAILY_POINTS` (default 100).
- `MONETAG_POSTBACK_SECRET`: shared secret for the Monetag postback URL.
- `REWARDED_AD_WEBHOOK_SECRET`: optional, for a non-Monetag ad provider.

## Go-live steps
1. **Database:** create a Neon project, open its SQL editor and run `db/schema.sql`.
   (If the tables already exist from the old schema, run `db/migrations/001_ad_rewards.sql`
   then `db/migrations/002_energy.sql` instead. Existing player data is kept.)
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

The server validates Telegram's HMAC-signed initData. It does not trust initDataUnsafe. Points are game scores only; no deposits, withdrawals, crypto wallet or guaranteed cash conversion. Any later reward claim requires published rules, funding, eligibility/KYC and a separate financial ledger.
