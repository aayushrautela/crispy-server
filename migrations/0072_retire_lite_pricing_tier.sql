-- Backfill pricing tier 'lite' -> 'free' and drop 'lite' from the allowed set.
-- The lite tier is retired; existing lite accounts move to the free tier.
-- account-settings.service.ts and the account contract enums are updated in
-- lockstep (PricingTier = 'free' | 'pro' | 'ultra').

UPDATE identity.account_preferences
SET settings_json = settings_json || '{"pricingTier":"free"}'::jsonb,
    updated_at = now()
WHERE settings_json ->> 'pricingTier' = 'lite';
