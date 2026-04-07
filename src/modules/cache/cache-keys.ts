export function calendarCacheKey(profileId: string): string {
  return `calendar:v2:${profileId}`;
}
