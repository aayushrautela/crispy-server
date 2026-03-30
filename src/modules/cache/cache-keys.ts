export function homeCacheKey(profileId: string): string {
  return `home:v2:${profileId}`;
}

export function calendarCacheKey(profileId: string): string {
  return `calendar:v2:${profileId}`;
}
