export type AiSuggestedMediaType = 'movie' | 'show';

export type AiSearchCandidate = {
  title: string;
  mediaType: AiSuggestedMediaType | null;
  year: number | null;
};

export function parseSearchCandidates(items: unknown[]): AiSearchCandidate[] {
  const candidates: AiSearchCandidate[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const candidate = normalizeSearchCandidate(item);
    if (!candidate) {
      continue;
    }

    const key = `${normalizeTitle(candidate.title)}::${candidate.mediaType ?? '*'}::${candidate.year ?? '*'}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(candidate);
  }

  return candidates;
}

function normalizeSearchCandidate(value: unknown): AiSearchCandidate | null {
  const title = normalizeSuggestedTitle(value);
  if (!title) {
    return null;
  }

  const mediaType = value && typeof value === 'object'
    ? normalizeSuggestedMediaType(
        (value as Record<string, unknown>).mediaType
        ?? (value as Record<string, unknown>).media_type
        ?? (value as Record<string, unknown>).type,
      )
    : null;

  const year = value && typeof value === 'object'
    ? normalizeSuggestedYear(
        (value as Record<string, unknown>).year
        ?? (value as Record<string, unknown>).releaseYear
        ?? (value as Record<string, unknown>).release_year,
      )
    : null;

  return { title, mediaType, year };
}

function normalizeSuggestedTitle(value: unknown): string | null {
  const raw = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && typeof (value as Record<string, unknown>).title === 'string'
      ? String((value as Record<string, unknown>).title)
      : '';

  const normalized = raw
    .trim()
    .replace(/^\d+[.)\-:\s]+/, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();

  return normalized || null;
}

function normalizeSuggestedMediaType(value: unknown): AiSuggestedMediaType | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[^a-z]+/g, ' ');
  if (normalized === 'movie' || normalized === 'movies' || normalized === 'film' || normalized === 'films') {
    return 'movie';
  }
  if (normalized === 'show' || normalized === 'shows' || normalized === 'tv' || normalized === 'tv show' || normalized === 'tv shows' || normalized === 'series') {
    return 'show';
  }
  if (normalized === 'anime') {
    return 'show';
  }

  return null;
}

function normalizeSuggestedYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const match = value.match(/\d{4}/);
    if (match) {
      const year = Number.parseInt(match[0] ?? '', 10);
      return Number.isInteger(year) && year > 0 ? year : null;
    }
  }
  return null;
}

function normalizeTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
