import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { MdbListClient } from '../integrations/mdblist.client.js';
import { MdbListService } from '../integrations/mdblist.service.js';
import type { MdbContentView, MetadataView } from './metadata-detail.types.js';

export class MetadataEnrichmentService {
  private readonly mdblistService: MdbListService | null;

  constructor(mdblistService: MdbListService | null = env.mdblistApiKey ? new MdbListService(new MdbListClient(env.mdblistApiKey)) : null) {
    this.mdblistService = mdblistService;
  }

  async getTitleContent(item: MetadataView): Promise<MdbContentView> {
    if (!this.mdblistService) {
      throw new HttpError(412, 'MDBList is not configured. Set MDBLIST_API_KEY in your environment.');
    }

    const tmdbId = item.externalIds.tmdb;
    if (!tmdbId) {
      throw new HttpError(404, 'Title metadata not available for content lookup.');
    }

    const mediaType = item.mediaType === 'movie' ? 'movie' : 'show';
    const content = await this.mdblistService.getTitle(mediaType, tmdbId);
    if (!content) {
      throw new HttpError(404, 'MDBList content not found for this title.');
    }

    return content;
  }
}
