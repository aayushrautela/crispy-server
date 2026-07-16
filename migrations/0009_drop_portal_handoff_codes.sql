-- Remove the portal handoff codes table. The portal session/handoff flow has
-- been removed in favour of clients sending the Supabase JWT as a bearer token
-- directly to the regular /v1/* endpoints (the same flow used by the native
-- and desktop apps).
DROP TABLE IF EXISTS private.portal_handoff_codes CASCADE;
