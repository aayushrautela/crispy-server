import { withDbClient, type DbClient } from '../../lib/db.js';
import { env } from '../../config/env.js';
import type { ClientHomeSection } from '../recommendations/client-home.types.js';
import { TemplatesRepository } from './repos/templates.repo.js';
import { buildSectionProviders } from './section-provider-registry.js';
import type { SectionProviderContext, TemplateRecord } from './homescreen.types.js';

export class DefaultHomeBuilder {
  constructor(
    private readonly templatesRepository = new TemplatesRepository(),
  ) {}

  /**
   * Builds the profile-independent default home for a locale by running each
   * section provider listed in the active template. Returns hydrated sections
   * (cards resolved). Continue-watching is intentionally excluded here; it is
   * layered on per-request by the resolver.
   */
  async build(locale: string, region: string | null): Promise<ClientHomeSection[]> {
    const template = await withDbClient((client) => this.resolveTemplate(client, locale));
    const providers = buildSectionProviders();

    const ctx: SectionProviderContext = {
      locale,
      region,
      now: new Date(),
      profileSpecificRails: false,
    };

    const sections: ClientHomeSection[] = [];
    await withDbClient(async (client: DbClient) => {
      for (const sectionKey of template.sectionKeys) {
        const provider = providers.get(sectionKey);
        if (!provider) {
          continue;
        }
        try {
          const produced = await provider.build(ctx, client);
          if (!produced) {
            continue;
          }
          for (const section of produced) {
            if (section.items.length > 0) {
              sections.push(section);
            }
          }
        } catch (error) {
          // A single failing provider must not take down the whole home.
          if (env.nodeEnv !== 'test') {
            console.error(`[homescreen] provider ${sectionKey} failed for locale ${locale}:`, error);
          }
        }
      }
    });

    return sections;
  }

  private async resolveTemplate(client: DbClient, locale: string): Promise<TemplateRecord> {
    const active = await this.templatesRepository.getActive(client, locale);
    if (active) {
      return active;
    }
    const fallback = await this.templatesRepository.getActive(client, 'all');
    if (fallback) {
      return fallback;
    }
    // Hard-coded last resort so a brand new deployment still renders something.
    return {
      key: 'default',
      locale: 'all',
      title: 'Default',
      sectionKeys: ['tmdb-trending-hero', 'tmdb-trending-movies', 'tmdb-popular-movies', 'tmdb-popular-tv'],
      isActive: true,
      updatedBy: 'fallback',
      updatedAt: new Date(0).toISOString(),
    };
  }
}
