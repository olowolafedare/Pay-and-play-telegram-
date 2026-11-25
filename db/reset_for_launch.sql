-- RESET ALL PLAYER PROGRESS (run once, right before the public launch, and optionally after testing).
-- Keeps player accounts and who-invited-whom, but sets every balance back to the start:
-- 0 Gome, 0 ads watched (Level 1), full 1,000 energy, no daily claim today.
-- This cannot be undone. Neon: take a backup/branch first if unsure.
BEGIN;
UPDATE rewards_wallets SET points = 0, lifetime_earned = 0, ad_points_earned = 0, ads_watched = 0,
                           energy = 1000, energy_updated_at = NOW(), last_tap_at = NULL, updated_at = NOW();
DELETE FROM rewards_transactions;
DELETE FROM tap_sessions;
DELETE FROM daily_reward_claims;
DELETE FROM rewarded_ad_events;
UPDATE referrals SET bonus_awarded = 0;
COMMIT;
