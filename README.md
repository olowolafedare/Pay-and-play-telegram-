# Pay and Play — Telegram Mini App

Separate Telegram game and rewards experience. The existing Pay and Play financial application is a different project and must remain untouched.

## Pre-launch scope
- Telegram authentication (server-verified `initData` before enabling accounts)
- Points-only rewards wallet
- Tap-to-earn, daily rewards, referrals and leaderboard
- No deposits, withdrawals, crypto wallet or cash claims in the game

## Stack
Next.js, TypeScript, Telegram Mini Apps SDK, Neon PostgreSQL and Vercel.

## Development
```bash
npm install
npm run dev
```

Never put Telegram bot tokens or database credentials in browser code. Add secrets through Vercel environment variables only.
