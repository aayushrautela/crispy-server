export type ListSourceProvider = 'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt' | 'simkl';

export type ListMediaType = 'movie' | 'tv';

export type HomeWriteItemLite = {
  type: ListMediaType;
  providerRefs: Array<{ provider: ListSourceProvider; providerId: string }>;
  score?: number | null;
  reason?: string | null;
  reasonCodes?: string[];
  metadata?: Record<string, unknown>;
};

export type ListSourceResult = {
  items: HomeWriteItemLite[];
  meta?: Record<string, unknown>;
};

export type ListSourceCtx = {
  client: unknown;
  profileId: string;
  locale: string;
  region: string | null;
  isKids: boolean;
  connectedProviders: ListSourceProvider[];
  tmdbLanguage: string | undefined;
  tmdbRegion: string | undefined;
  signal?: AbortSignal;
  limit: number;
};

export type ListSourceConfigOption = { value: string; label: string };

export type ListSourceConfigField = {
  key: string;
  label: string;
  type: 'select' | 'text' | 'number' | 'checkbox';
  required?: boolean;
  default?: unknown;
  options?: ListSourceConfigOption[];
};

export type ListSourceDescriptor = {
  id: string;
  name: string;
  description: string;
  mediaTypes: ListMediaType[];
  requiresProvider?: ListSourceProvider;
  configFields: ListSourceConfigField[];
};

export interface ListSource<IConfig = Record<string, unknown>> {
  descriptor(): ListSourceDescriptor;
  fetchItems(config: IConfig, ctx: ListSourceCtx): Promise<ListSourceResult>;
}
