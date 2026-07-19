import { LocalUserWatchService } from '../../../integrations/local-user-watch.service.js';
import type { ListSource, ListSourceCtx, ListSourceDescriptor, ListSourceResult, HomeWriteItemLite } from '../list-source.types.js';

const CONTINUE_WATCHING_LIMIT = 20;

/**
 * Continue-watching rail sourced from the profile's local playback progress.
 * Emits raw provider refs so the unified write pipeline resolves them like any
 * other source. Locale-aware (used for localized hydration downstream).
 */
export class HomeContinueWatchingSource implements ListSource<Record<string, never>> {
  constructor(private readonly watchService = new LocalUserWatchService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'home.continue-watching',
      name: 'Continue Watching',
      description: 'Titles the profile started watching and has not finished.',
      mediaTypes: ['movie', 'tv'],
      configFields: [],
    };
  }

  async fetchItems(_config: Record<string, never>, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const page = await this.watchService.listContinueWatchingPage({
      accountId: '',
      profileId: ctx.profileId,
      limit: CONTINUE_WATCHING_LIMIT,
      cursor: null,
    });
    const items: HomeWriteItemLite[] = [];
    for (const item of page.items) {
      const providerIds = (item as { ProviderIds?: Record<string, string | null> }).ProviderIds;
      if (!providerIds?.Tmdb) continue;
      const mediaType = item.Type === 'Movie' ? 'movie' : 'tv';
      items.push({
        type: mediaType,
        providerRefs: [{ provider: 'tmdb', providerId: String(providerIds.Tmdb) }],
        reason: 'Continue watching',
        reasonCodes: ['continue-watching'],
        metadata: { progress: item.UserData?.PlayedPercentage ?? null },
      });
    }
    return { items, meta: { sourceCount: items.length } };
  }
}
