export function calendarCacheKey(profileId: string): string {
  return `calendar:v3:${profileId}`;
}
