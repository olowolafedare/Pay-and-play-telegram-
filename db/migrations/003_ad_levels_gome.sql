-- Gome Coin rules: levels by ads watched, energy refilled by ads/daily, 100 energy = 1 Gome.
-- Safe to run more than once. Keeps all existing data.
ALTER TABLE rewards_wallets ADD COLUMN IF NOT EXISTS ads_watched INTEGER NOT NULL DEFAULT 0 CHECK (ads_watched >= 0);
ALTER TABLE rewarded_ad_events ADD COLUMN IF NOT EXISTS estimated_price NUMERIC;
ALTER TABLE rewarded_ad_events ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Count any confirmed ads already recorded toward each player's level.
UPDATE rewards_wallets w SET ads_watched = sub.n
FROM (SELECT user_id, COUNT(*)::int AS n FROM rewarded_ad_events GROUP BY user_id) sub
WHERE sub.user_id = w.user_id AND w.ads_watched < sub.n;
