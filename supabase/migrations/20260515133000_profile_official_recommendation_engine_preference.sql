CREATE OR REPLACE FUNCTION public.is_safe_profile_preferences(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT
    jsonb_typeof(value) = 'object'
    AND NOT (value ?| ARRAY['ai', 'ai.api_key', 'mdblist.api_key', 'addons'])
    AND (
      NOT (value ? 'recommendations')
      OR (
        jsonb_typeof(value -> 'recommendations') = 'object'
        AND NOT ((value -> 'recommendations') ?| ARRAY[]::text[])
        AND (
          NOT ((value -> 'recommendations') ? 'enabled')
          OR jsonb_typeof(value #> '{recommendations,enabled}') = 'boolean'
        )
        AND (
          NOT ((value -> 'recommendations') ? 'useOfficialEngine')
          OR jsonb_typeof(value #> '{recommendations,useOfficialEngine}') = 'boolean'
        )
      )
    );
$function$;

CREATE INDEX IF NOT EXISTS profile_preferences_official_reco_enabled_idx
  ON public.profile_preferences (profile_id)
  WHERE COALESCE((settings_json #>> '{recommendations,useOfficialEngine}')::boolean, true) = true;
