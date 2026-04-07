import type {
  ProviderEpisodeRecord,
  ProviderSeasonRecord,
  ProviderTitleRecord,
} from '../metadata-card.types.js';

export type ProviderBundleExtras = {
  characters?: Record<string, unknown> | null;
  staff?: Record<string, unknown> | null;
  relationships?: Record<string, unknown> | null;
  productions?: Record<string, unknown> | null;
  reviews?: Record<string, unknown> | null;
};

export type ProviderTitleBundle = {
  title: ProviderTitleRecord;
  seasons: ProviderSeasonRecord[];
  episodes: ProviderEpisodeRecord[];
  extras?: ProviderBundleExtras;
};

export type TvdbTitleBundlePayload = {
  seriesPayload: Record<string, unknown>;
  episodesPayload: Record<string, unknown>;
};

export type KitsuTitleBundlePayload = {
  animePayload: Record<string, unknown>;
  episodesPayload: Record<string, unknown>;
  charactersPayload: Record<string, unknown>;
  staffPayload: Record<string, unknown>;
  relationshipsPayload: Record<string, unknown>;
  productionsPayload: Record<string, unknown>;
  reviewsPayload: Record<string, unknown>;
};

export type CachedTvdbTitleBundleRecord = {
  providerId: string;
  payload: TvdbTitleBundlePayload;
  fetchedAt: string;
  expiresAt: string;
};

export type CachedKitsuTitleBundleRecord = {
  providerId: string;
  payload: KitsuTitleBundlePayload;
  fetchedAt: string;
  expiresAt: string;
};
