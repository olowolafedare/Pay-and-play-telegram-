# Pay and Play Telegram Mini App

Separate pre-launch game for tapping, rewards points, daily claims and leaderboard. It is not the Pay and Play financial wallet.

## Stack
Next.js + TypeScript, Telegram Mini Apps signed initData verification, Neon PostgreSQL, Vercel.

## Environment
- DATABASE_URL: encrypted Vercel variable, dedicated Telegram Neon branch.
- TELEGRAM_BOT_TOKEN: add privately in Vercel Project Settings > Environment Variables. Never commit it.
- NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: bot username without @.
- GAME_POINTS_PER_TAP (default 1), GAME_DAILY_POINTS (default 25).

## Run
npm install && npm run dev

The server validates Telegram's HMAC-signed initData. It does not trust initDataUnsafe. Points are game scores only; no deposits, withdrawals, crypto wallet or guaranteed cash conversion. Any later reward claim requires published rules, funding, eligibility/KYC and a separate financial ledger.
