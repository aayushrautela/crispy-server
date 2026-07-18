import type { ClientHomeSection, ClientMediaType } from '../recommendations/client-home.types.js';
import type { DbClient } from '../../lib/db.js';

export type HomeMode = 'recommended' | 'custom';

export const HOME_MODES: HomeMode[] = ['recommended', 'custom'];

export function isHomeMode(value: unknown): value is HomeMode {
  return value === 'recommended' || value === 'custom';
}

export type ProviderRef = {
  provider: string;
  providerId: string;
  type?: string;
};

export type SectionProviderKey = string;

export type SectionProviderContext = {
  locale: string;
  region: string | null;
  now: Date;
  /** When true, include profile-specific rails (continue-watching). */
  profileSpecificRails: boolean;
  profileId?: string;
};

export type SectionProviderResult = ClientHomeSection[] | null;

export interface SectionProvider {
  readonly key: SectionProviderKey;
  build(ctx: SectionProviderContext, client: DbClient): Promise<SectionProviderResult>;
}

export type TemplateRecord = {
  key: string;
  locale: string;
  title: string | null;
  sectionKeys: string[];
  isActive: boolean;
  updatedBy: string;
  updatedAt: string;
};

export type CollectionSource = 'manual' | 'trakt';

export type CollectionRecord = {
  key: string;
  title: string;
  subtitle: string | null;
  providerRefs: ProviderRef[];
  source: CollectionSource;
  sourceRef: string | null;
  lastSyncedAt: string | null;
  updatedBy: string;
  updatedAt: string;
};

export type TraktImportRecord = {
  id: string;
  traktListId: string | null;
  slug: string;
  title: string | null;
  templateKey: string;
  active: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

export type DefaultSnapshotRecord = {
  locale: string;
  sections: ClientHomeSection[];
  generatedAt: string;
  expiresAt: string | null;
  lastError: string | null;
  updatedBy: string | null;
  updatedAt: string;
};

/** Legacy list keys produced by the reco engine, kept as aliases. */
export const LEGACY_RECO_LIST_KEYS: Record<string, string> = {
  'tmdb-trending-hero': 'hero-carousel',
  'category-tabs': 'category-tabs',
  'content-rails': 'content-rails',
  'collection-rails': 'collection-rails',
};

export type ClientMediaTypeLike = ClientMediaType;
