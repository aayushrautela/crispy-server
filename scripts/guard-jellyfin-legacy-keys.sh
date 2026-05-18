#!/usr/bin/env bash
set -euo pipefail
# Guards against legacy media item DTO keys leaking into public OpenAPI specs.
# Hard-cutoff: no MediaItemDto, mediaItem, runTimeSeconds, trailerUrl, trailerThumbnailUrl
# in public API response schemas. Only BaseItemDto/BaseItemDtoQueryResult should appear.

SPEC_DIR="openapi"

FORBIDDEN_KEYS="MediaItemDto mediaItem runTimeSeconds trailerUrl trailerThumbnailUrl"

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
  echo "✅ No legacy media item DTO keys detected in public OpenAPI specs."
else
  echo "❌ Legacy media item DTO keys must not appear in public API schemas."
  echo "   Remove them before committing."
fi
exit "$exit_code"
