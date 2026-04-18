import { parseMediaKey } from '../identity/media-key.js';
import type { RegularCardView } from '../metadata/metadata-card.types.js';

export function fallbackRegularCard(
  mediaKey: string,
  title: string | null,
  posterUrl: string | null,
  subtitle: string | null,
  releaseYear: number | null,
  rating: number | null,
): RegularCardView | null {
  const parsed = parseMediaKey(mediaKey);
  if (
    (parsed.mediaType !== 'movie' && parsed.mediaType !== 'show')
    || !parsed.provider
    || !parsed.providerId
    || !title
    || !posterUrl
  ) {
    return null;
  }

  return {
    mediaType: parsed.mediaType,
    mediaKey,
    provider: parsed.provider,
    providerId: parsed.providerId,
    title,
    posterUrl,
    releaseYear,
    rating,
    genre: null,
    subtitle,
  };
}
