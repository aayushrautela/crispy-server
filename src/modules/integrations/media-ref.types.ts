export type IntegrationMediaType = 'movie' | 'series' | 'season' | 'episode';

export type ProviderIds = Record<string, string | number | Array<string | number>>;

export interface MediaRefSeriesRef {
  canonicalId?: string;
  providerIds?: ProviderIds;
}

export interface MediaRef {
  mediaType: IntegrationMediaType;
  canonicalId?: string;
  providerIds?: ProviderIds;

  series?: MediaRefSeriesRef;

  seasonNumber?: number;
  episodeNumber?: number;

  seasonProviderIds?: ProviderIds;
  episodeProviderIds?: ProviderIds;
}

export interface MetadataHint {
  title?: string;
  originalTitle?: string;
  overview?: string;
  releaseYear?: number;
  releaseDate?: string;
  posterUrl?: string;
  backdropUrl?: string;
  runtimeMinutes?: number;
  genres?: string[];
  rating?: string;
  externalUrl?: string;
}

export interface RecommendationMediaRefInput extends MediaRef {
  metadataHint?: MetadataHint;
}
