import type { DbClient } from '../../../lib/db.js';
import { CollectionRegistry } from '../collections/collection-registry.js';
import { CollectionResolver } from '../collections/collection-resolver.js';
import type { ClientHomeSection } from '../../recommendations/client-home.types.js';
import type { SectionProvider, SectionProviderContext } from '../homescreen.types.ts';

/**
 * Expands the collections registry into one collection rail per active
 * collection. Trakt-sourced collections are handled by a sibling provider so
 * admins can order them independently in a template.
 */
export class CollectionsProvider implements SectionProvider {
  readonly key = 'collections';

  constructor(
    private readonly registry = new CollectionRegistry(),
    private readonly resolver = new CollectionResolver(),
  ) {}

  async build(ctx: SectionProviderContext, _client: DbClient): Promise<ClientHomeSection[]> {
    const collections = await this.registry.list('manual');
    return this.resolveAll(collections, ctx.locale);
  }

  private async resolveAll(collections: Awaited<ReturnType<CollectionRegistry['list']>>, locale: string): Promise<ClientHomeSection[]> {
    const sections: ClientHomeSection[] = [];
    for (const collection of collections) {
      const section = await this.resolver.resolveToSection(collection, locale);
      if (section) {
        sections.push(section);
      }
    }
    return sections;
  }
}

export const collectionsProvider: CollectionsProvider = new CollectionsProvider();
