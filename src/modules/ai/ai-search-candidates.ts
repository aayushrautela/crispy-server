export type AiSuggestedMediaType = 'movie' | 'show';

export type AiSearchCandidate = {
  title: string;
  mediaType: AiSuggestedMediaType | null;
};

export function parseSearchCandidates(items: unknown[]): AiSearchCandidate[] {
  const candidates: AiSearchCandidate[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const candidate = normalizeSearchCandidate(item);
    if (!candidate) {
      continue;
    }

    const key = `${normalizeTitle(candidate.title)}::${candidate.mediaType ?? '*'}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(candidate);
  }

  return candidates;
}

export function resolveCandidateFilter(mediaType: AiSuggestedMediaType | null): Array<'movies' | 'series' | 'all'> {
  const hintedFilter = mapSuggestedMediaTypeToSearchFilter(mediaType);
  return hintedFilter ? [hintedFilter, 'all'] : ['all'];
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

  return { title, mediaType };
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

function mapSuggestedMediaTypeToSearchFilter(mediaType: AiSuggestedMediaType | null): 'movies' | 'series' | null {
  if (mediaType === 'movie') {
    return 'movies';
  }
  if (mediaType === 'show') {
    return 'series';
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
