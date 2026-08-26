#!/usr/bin/env bash
set -euo pipefail
# Guards against retired media item DTO keys leaking into public OpenAPI specs.
# Hard-cutoff: no MediaItemDto, mediaItem, runTimeSeconds, trailerThumbnailUrl
# in public API response schemas. ClientMediaCard is the standard enriched card
# shape and legitimately owns camelCase fields such as runtimeSeconds/trailerUrl;
# only the retired intermediate MediaItem DTO stays banned.

SPEC_DIR="openapi"

FORBIDDEN_KEYS="MediaItemDto mediaItem runTimeSeconds trailerThumbnailUrl"

check_spec() {
  local spec="$1"
  local errors=0
  for key in $FORBIDDEN_KEYS; do
    if grep -q "$key" "$spec" 2>/dev/null; then
      echo "FAIL: legacy key '$key' found in $spec"
      grep -n "$key" "$spec"
      errors=$((errors + 1))
    fi
  done
  return "$errors"
}

exit_code=0
for spec in "$SPEC_DIR"/public-*.yaml; do
  if [ -f "$spec" ]; then
    check_spec "$spec" || exit_code=1
  fi
done

if [ "$exit_code" -eq 0 ]; then
  echo "✅ No retired media item DTO keys detected in public OpenAPI specs."
else
  echo "❌ Retired media item DTO keys must not appear in public API schemas."
  echo "   Remove them before committing."
fi
exit "$exit_code"
