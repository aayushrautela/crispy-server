/**
 * Static TMDB reference data used by the admin UI and list sources.
 *
 * Kept static (not fetched from TMDB) to avoid a runtime dependency for form
 * rendering. These lists change slowly; expand as needed. ISO 639-1 language
 * codes and ISO 3166-1 region codes.
 */

export type SelectOption = { value: string; label: string };

/** TMDB original-language filter options. '' = any language. */
export const TMDB_LANGUAGES: ReadonlyArray<SelectOption> = [
  { value: '', label: 'Any language' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'sv', label: 'Swedish' },
  { value: 'da', label: 'Danish' },
  { value: 'fi', label: 'Finnish' },
  { value: 'no', label: 'Norwegian' },
  { value: 'cs', label: 'Czech' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'el', label: 'Greek' },
  { value: 'he', label: 'Hebrew' },
  { value: 'th', label: 'Thai' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'id', label: 'Indonesian' },
  { value: 'ms', label: 'Malay' },
  { value: 'ro', label: 'Romanian' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'bg', label: 'Bulgarian' },
  { value: 'hr', label: 'Croatian' },
  { value: 'sk', label: 'Slovak' },
  { value: 'lt', label: 'Lithuanian' },
  { value: 'lv', label: 'Latvian' },
  { value: 'et', label: 'Estonian' },
  { value: 'fa', label: 'Persian' },
  { value: 'ur', label: 'Urdu' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ta', label: 'Tamil' },
  { value: 'te', label: 'Telugu' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'fil', label: 'Filipino' },
];

/** Locales offered when an admin pins a rail to a specific locale. */
export const TMDB_LOCALE_OPTIONS: ReadonlyArray<SelectOption> = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'hi', label: 'Hindi' },
  { value: 'pl', label: 'Polish' },
  { value: 'nl', label: 'Dutch' },
  { value: 'tr', label: 'Turkish' },
  { value: 'ar', label: 'Arabic' },
  { value: 'sv', label: 'Swedish' },
  { value: 'cs', label: 'Czech' },
  { value: 'el', label: 'Greek' },
  { value: 'he', label: 'Hebrew' },
  { value: 'th', label: 'Thai' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'id', label: 'Indonesian' },
  { value: 'ro', label: 'Romanian' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'fa', label: 'Persian' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ta', label: 'Tamil' },
  { value: 'fil', label: 'Filipino' },
];

/** Region filter options. '' = use the viewer's region at resolve time. */
export const TMDB_REGIONS: ReadonlyArray<SelectOption> = [
  { value: '', label: 'Any (use viewer region)' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'IN', label: 'India' },
  { value: 'CA', label: 'Canada' },
  { value: 'AU', label: 'Australia' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'ES', label: 'Spain' },
  { value: 'IT', label: 'Italy' },
  { value: 'BR', label: 'Brazil' },
  { value: 'MX', label: 'Mexico' },
  { value: 'JP', label: 'Japan' },
  { value: 'KR', label: 'South Korea' },
  { value: 'CN', label: 'China' },
  { value: 'RU', label: 'Russia' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'PL', label: 'Poland' },
  { value: 'SE', label: 'Sweden' },
  { value: 'NO', label: 'Norway' },
  { value: 'DK', label: 'Denmark' },
  { value: 'FI', label: 'Finland' },
  { value: 'TR', label: 'Turkey' },
  { value: 'AE', label: 'United Arab Emirates' },
  { value: 'SA', label: 'Saudi Arabia' },
  { value: 'ZA', label: 'South Africa' },
  { value: 'ID', label: 'Indonesia' },
  { value: 'TH', label: 'Thailand' },
  { value: 'VN', label: 'Vietnam' },
  { value: 'PH', label: 'Philippines' },
];

/** Genre options shared by movie + tv (TMDB genre IDs differ per type). */
export const TMDB_GENRES: ReadonlyArray<{ value: string; label: string; movieId: number; tvId: number }> = [
  { value: 'action', label: 'Action', movieId: 28, tvId: 10759 },
  { value: 'adventure', label: 'Adventure', movieId: 12, tvId: 10759 },
  { value: 'animation', label: 'Animation', movieId: 16, tvId: 16 },
  { value: 'comedy', label: 'Comedy', movieId: 35, tvId: 35 },
  { value: 'crime', label: 'Crime', movieId: 18, tvId: 80 },
  { value: 'documentary', label: 'Documentary', movieId: 99, tvId: 99 },
  { value: 'drama', label: 'Drama', movieId: 18, tvId: 18 },
  { value: 'family', label: 'Family', movieId: 10751, tvId: 10751 },
  { value: 'fantasy', label: 'Fantasy', movieId: 14, tvId: 10765 },
  { value: 'history', label: 'History', movieId: 36, tvId: 36 },
  { value: 'horror', label: 'Horror', movieId: 27, tvId: 9648 },
  { value: 'music', label: 'Music', movieId: 10402, tvId: 10402 },
  { value: 'mystery', label: 'Mystery', movieId: 9648, tvId: 9648 },
  { value: 'romance', label: 'Romance', movieId: 10749, tvId: 10749 },
  { value: 'sci-fi', label: 'Sci-Fi', movieId: 878, tvId: 10765 },
  { value: 'thriller', label: 'Thriller', movieId: 53, tvId: 53 },
  { value: 'war', label: 'War', movieId: 10752, tvId: 10768 },
  { value: 'western', label: 'Western', movieId: 37, tvId: 37 },
];

export function resolveGenreId(value: unknown, mediaType: 'movie' | 'tv'): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  if (/^\d+$/.test(value)) return Number(value);
  const match = TMDB_GENRES.find((g) => g.value === value);
  return match ? (mediaType === 'tv' ? match.tvId : match.movieId) : null;
}

/** Current year used as the upper bound for the year dropdown. */
export function currentYear(): number {
  return new Date().getFullYear();
}

/** Year dropdown options (newest first), '' = any year. */
export function tmdbYearOptions(): ReadonlyArray<SelectOption> {
  const start = currentYear();
  const end = 1960;
  const options: SelectOption[] = [{ value: '', label: 'Any year' }];
  for (let y = start; y >= end; y--) {
    options.push({ value: String(y), label: String(y) });
  }
  return options;
}
