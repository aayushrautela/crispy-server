export type DefaultTemplate = {
  listKey: string;
  regionOverride: string | null;
  sectionType: string;
  title: string;
  subtitle: string | null;
  rank: number;
  sourceId: string;
  sourceConfig: Record<string, unknown>;
};

export const DEFAULT_SECTION_LIMITS: Record<string, number> = {
  heroCarousel: 10,
  contentRail: 50,
  categoryTabs: 50,
  collectionRail: 50,
};
