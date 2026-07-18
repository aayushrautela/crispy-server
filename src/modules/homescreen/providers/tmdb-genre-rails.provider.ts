import type { DbClient } from '../../../lib/db.js';
import { TmdbClient } from '../../metadata/providers/tmdb.client.js';
import { TmdbSectionBuilder } from './tmdb-section-builder.js';
import type { ClientHomeSection, ClientHomeSectionType } from '../../recommendations/client-home.types.js';
import type { SectionProvider, SectionProviderContext } from '../homescreen.types.ts';

const MAJOR_GENRES = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Adventure' },
  { id: 35, name: 'Comedy' },
  { id: 18, name: 'Drama' },
  { id: 27, name: 'Horror' },
  { id: 878, name: 'Sci-Fi' },
  { id: 10749, name: 'Romance' },
  { id: 53, name: 'Thriller' },
];

const MAX_PER_GENRE = 20;

/**
 * Expands into one content rail per major genre. Returns multiple sections so
 * the template only needs a single "tmdb-genre-rails" key to get a full set of
 * genre rails.
 */
export class TmdbGenreRailsProvider implements SectionProvider {
  readonly key = 'tmdb-genre-rails';

  constructor(
    private readonly tmdbClient = new TmdbClient(),
    private readonly builder = new TmdbSectionBuilder(),
  ) {}

  async build(ctx: SectionProviderContext, client: DbClient): Promise<ClientHomeSection[]> {
    const locale = ctx.locale || 'en-US';
    const sections: ClientHomeSection[] = [];

    for (const genre of MAJOR_GENRES) {
      try {
        const built = await this.builder.build(
          {
            key: `tmdb-genre-${genre.id}`,
            title: `${genre.name} Movies`,
            sectionType: 'contentRail' as ClientHomeSectionType,
            maxItems: MAX_PER_GENRE,
            path: `/discover/movie`,
            query: {
              with_genres: genre.id,
              sort_by: 'popularity.desc',
              include_adult: 'false',
            },
          },
          ctx,
          client,
        );
        for (const section of built) {
          if (section.items.length > 0) {
            sections.push(section);
          }
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
          console.error(`[homescreen] genre rail ${genre.name} failed:`, error);
        }
      }
    }
    return sections;
  }
}

export const tmdbGenreRailsProvider: TmdbGenreRailsProvider = new TmdbGenreRailsProvider();
