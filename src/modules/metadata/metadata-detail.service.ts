import { MetadataTitlePageService } from './metadata-title-page.service.js';
import type { MetadataTitleDetail } from './metadata-detail.types.js';

export class MetadataDetailService {
  constructor(
    private readonly metadataTitlePageService = new MetadataTitlePageService(),
  ) {}

  async getItemDetail(itemId: string, language?: string | null): Promise<MetadataTitleDetail> {
    return this.metadataTitlePageService.getTitlePage(itemId, language ?? null);
  }

  async getSeriesEpisodes(seriesItemId: string, language?: string | null, season?: number | null) {
    return this.metadataTitlePageService.getSeriesEpisodes(seriesItemId, language ?? null, season ?? null);
  }
}
