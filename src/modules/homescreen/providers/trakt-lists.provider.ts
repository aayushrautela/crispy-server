import type { DbClient } from '../../../lib/db.js';
import { CollectionRegistry } from '../collections/collection-registry.js';
import { CollectionResolver } from '../collections/collection-resolver.js';
import type { ClientHomeSection } from '../../recommendations/client-home.types.js';
import type { SectionProvider, SectionProviderContext } from '../homescreen.types.ts';

/**
 * Like CollectionsProvider but only includes trakt-sourced collections, so the
 * default template can place public trakt rails independently of curated ones.
 */
export class TraktListsProvider implements SectionProvider {
  readonly key = 'trakt-lists';

  constructor(
    private readonly registry = new CollectionRegistry(),
    private readonly resolver = new CollectionResolver(),
  ) {}

  async build(ctx: SectionProviderContext, _client: DbClient): Promise<ClientHomeSection[]> {
    const collections = await this.registry.list('trakt');
    const sections: ClientHomeSection[] = [];
    for (const collection of collections) {
      const section = await this.resolver.resolveToSection(collection, ctx.locale);
      if (section) {
        sections.push(section);
      }
    }
    return sections;
  }
}

export const traktListsProvider: TraktListsProvider = new TraktListsProvider();
