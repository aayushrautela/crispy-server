import {
  stringSchema,
  nonEmptyStringSchema,
  nullableStringSchema,
  booleanSchema,
  numberSchema,
  nullableNumberSchema,
  nullableIntegerSchema,
  recordSchema,
  successEnvelope,
  responseMetaSchema,
  withDefaultErrorResponses,
} from './shared.js';

// ── Shared primitives ──────────────────────────────────────────

export const dateTimeSchema = { type: 'string', format: 'date-time' } as const;
export const nullableDateTimeSchema = { anyOf: [dateTimeSchema, { type: 'null' }] } as const;
export const integerSchema = { type: 'integer' } as const;
export const cursorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['nextCursor', 'hasMore'],
  properties: {
    nextCursor: nullableStringSchema,
    hasMore: booleanSchema,
  },
} as const;

// ── AppSelf ────────────────────────────────────────────────────

export const rateLimitPolicySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'profileChangesReadsPerMinute', 'profileSignalReadsPerMinute',
    'recommendationWritesPerMinute', 'batchWritesPerMinute',
    'configBundleReadsPerMinute', 'runsPerHour',
    'snapshotsPerDay', 'maxProfilesPerBatch', 'maxItemsPerList',
  ],
  properties: {
    profileChangesReadsPerMinute: numberSchema,
    profileSignalReadsPerMinute: numberSchema,
    recommendationWritesPerMinute: numberSchema,
    batchWritesPerMinute: numberSchema,
    configBundleReadsPerMinute: numberSchema,
    runsPerHour: numberSchema,
    snapshotsPerDay: numberSchema,
    maxProfilesPerBatch: numberSchema,
    maxItemsPerList: numberSchema,
  },
} as const;

export const appSelfDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['appId', 'name', 'status', 'principalType', 'scopes', 'ownedSources', 'rateLimitPolicy'],
  properties: {
    appId: stringSchema,
    name: stringSchema,
    description: nullableStringSchema,
    status: stringSchema,
    principalType: stringSchema,
    scopes: { type: 'array', items: stringSchema },
    ownedSources: { type: 'array', items: stringSchema },
    rateLimitPolicy: rateLimitPolicySchema,
  },
} as const;
export const appSelfResponseSchema = successEnvelope(appSelfDataSchema);
export const appSelfRouteSchema = withDefaultErrorResponses({
  response: { 200: appSelfResponseSchema },
});

// ── Eligible Profile Changes ───────────────────────────────────

export const eligibleProfileChangeEventTypeSchema = {
  type: 'string',
  enum: ['initial', 'profile_updated', 'signals_changed', 'consent_changed', 'settings_changed', 'eligibility_changed', 'account_changed'],
} as const;

export const eligibleProfileChangeEventSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['changeId', 'accountId', 'profileId', 'eventType', 'eligible', 'eligibilityVersion', 'signalsVersion', 'changedAt', 'reasons', 'recommendedActions'],
  properties: {
    changeId: stringSchema,
    accountId: stringSchema,
    profileId: stringSchema,
    eventType: eligibleProfileChangeEventTypeSchema,
    eligible: booleanSchema,
    eligibilityVersion: integerSchema,
    signalsVersion: integerSchema,
    changedAt: dateTimeSchema,
    reasons: { type: 'array', items: stringSchema },
    recommendedActions: { type: 'array', items: stringSchema },
  },
} as const;

export const eligibleProfileChangesDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'cursor'],
  properties: {
    items: { type: 'array', items: eligibleProfileChangeEventSchema },
    cursor: cursorSchema,
  },
} as const;
export const eligibleProfileChangesResponseSchema = successEnvelope(eligibleProfileChangesDataSchema);

export const eligibleProfileChangesQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: stringSchema,
    limit: stringSchema,
    reason: eligibleProfileChangeEventTypeSchema,
    accountId: stringSchema,
    profileId: stringSchema,
  },
} as const;
export const eligibleProfileChangesRouteSchema = withDefaultErrorResponses({
  querystring: eligibleProfileChangesQuerySchema,
  response: { 200: eligibleProfileChangesResponseSchema },
});

// ── Create Eligible Profile Snapshot ─────────────────────────

export const eligibleProfileSnapshotStatusSchema = {
  type: 'string',
  enum: ['draft', 'pending_approval', 'active', 'paused', 'cancelled', 'completed', 'expired'],
} as const;

export const eligibleProfileSnapshotSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['snapshotId', 'appId', 'purpose', 'status', 'filters', 'estimatedProfileCount', 'createdAt'],
  properties: {
    snapshotId: stringSchema,
    appId: stringSchema,
    purpose: { type: 'string', enum: ['recommendation-generation'] },
    status: eligibleProfileSnapshotStatusSchema,
    filters: recordSchema,
    estimatedProfileCount: integerSchema,
    createdAt: dateTimeSchema,
    approvedBy: nullableStringSchema,
    approvedAt: nullableDateTimeSchema,
  },
} as const;

export const eligibleProfileSnapshotIdempotencySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'replayed'],
  properties: {
    key: stringSchema,
    replayed: booleanSchema,
  },
} as const;

export const eligibleProfileSnapshotFiltersSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accountIds: { type: 'array', items: stringSchema },
    profileIds: { type: 'array', items: stringSchema },
    languages: { type: 'array', items: stringSchema },
    minSignalsVersion: integerSchema,
    includeProfilesWithNoPriorRecommendations: booleanSchema,
  },
} as const;

export const createEligibleProfileSnapshotBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['purpose', 'reason'],
  properties: {
    purpose: { type: 'string', enum: ['recommendation-generation'] },
    filters: eligibleProfileSnapshotFiltersSchema,
    reason: stringSchema,
    requestedBy: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'id'],
      properties: {
        type: { type: 'string', enum: ['admin', 'system'] },
        id: stringSchema,
      },
    },
  },
} as const;

export const createSnapshotDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['snapshot'],
  properties: { snapshot: eligibleProfileSnapshotSchema },
} as const;
export const createEligibleProfileSnapshotResponseSchema = successEnvelope(createSnapshotDataSchema);
export const createEligibleProfileSnapshotRouteSchema = withDefaultErrorResponses({
  body: createEligibleProfileSnapshotBodySchema,
  response: { 201: createEligibleProfileSnapshotResponseSchema },
});

// ── Eligible Profile Snapshot Items ──────────────────────────

export const eligibleProfileSnapshotItemStatusSchema = {
  type: 'string',
  enum: ['pending', 'leased', 'completed', 'failed', 'skipped', 'cancelled', 'expired'],
} as const;

export const eligibleProfileSnapshotItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['snapshotItemId', 'snapshotId', 'accountId', 'profileId', 'eligibilityVersion', 'signalsVersion', 'status'],
  properties: {
    snapshotItemId: stringSchema,
    snapshotId: stringSchema,
    accountId: stringSchema,
    profileId: stringSchema,
    eligibilityVersion: integerSchema,
    signalsVersion: integerSchema,
    status: eligibleProfileSnapshotItemStatusSchema,
    lease: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['leaseId', 'expiresAt'],
          properties: {
            leaseId: stringSchema,
            expiresAt: dateTimeSchema,
          },
        },
        { type: 'null' },
      ],
    },
  },
} as const;

export const snapshotItemsDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['snapshot', 'items', 'cursor'],
  properties: {
    snapshot: eligibleProfileSnapshotSchema,
    items: { type: 'array', items: eligibleProfileSnapshotItemSchema },
    cursor: cursorSchema,
  },
} as const;
export const getEligibleProfileSnapshotItemsResponseSchema = successEnvelope(snapshotItemsDataSchema);

export const getEligibleProfileSnapshotItemsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: stringSchema,
    limit: stringSchema,
    leaseSeconds: stringSchema,
  },
} as const;
export const getEligibleProfileSnapshotItemsRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['snapshotId'],
    properties: { snapshotId: nonEmptyStringSchema },
  },
  querystring: getEligibleProfileSnapshotItemsQuerySchema,
  response: { 200: getEligibleProfileSnapshotItemsResponseSchema },
});

// ── Profile Eligibility ──────────────────────────────────────

export const profileEligibilityReasonSchema = {
  type: 'string',
  enum: [
    'account_inactive', 'profile_inactive', 'profile_deleted', 'profile_locked',
    'profile_disabled_recommendations', 'ai_personalization_disabled',
    'account_personalization_disabled', 'consent_denied', 'maturity_policy_denied',
    'privacy_policy_denied', 'app_grant_denied',
  ],
} as const;

export const profileEligibilityPolicySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'accountActive', 'profileActive', 'profileDeleted', 'profileLocked',
    'useOfficialRecommendationEngine', 'recommendationsEnabled', 'aiPersonalizationEnabled', 'accountAllowsPersonalization',
    'consentAllowsProcessing', 'maturityPolicyAllowsReco', 'appGrantAllowsProfile',
  ],
  properties: {
    accountActive: booleanSchema,
    profileActive: booleanSchema,
    profileDeleted: booleanSchema,
    profileLocked: booleanSchema,
    useOfficialRecommendationEngine: booleanSchema,
    recommendationsEnabled: booleanSchema,
    aiPersonalizationEnabled: booleanSchema,
    accountAllowsPersonalization: booleanSchema,
    consentAllowsProcessing: booleanSchema,
    maturityPolicyAllowsReco: booleanSchema,
    appGrantAllowsProfile: booleanSchema,
  },
} as const;

export const profileEligibilityDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accountId', 'profileId', 'purpose', 'eligible', 'eligibilityVersion', 'reasons', 'policy', 'checkedAt'],
  properties: {
    accountId: stringSchema,
    profileId: stringSchema,
    purpose: { type: 'string', enum: ['recommendation-generation'] },
    eligible: booleanSchema,
    eligibilityVersion: integerSchema,
    reasons: { type: 'array', items: profileEligibilityReasonSchema },
    policy: profileEligibilityPolicySchema,
    checkedAt: dateTimeSchema,
  },
} as const;
export const profileEligibilityResponseSchema = successEnvelope(profileEligibilityDataSchema);

export const profileEligibilityQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requireAiPersonalization: { type: 'string', enum: ['true', 'false'] },
  },
} as const;
export const profileEligibilityRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['accountId', 'profileId'],
    properties: {
      accountId: nonEmptyStringSchema,
      profileId: nonEmptyStringSchema,
    },
  },
  querystring: profileEligibilityQuerySchema,
  response: { 200: profileEligibilityResponseSchema },
});

// ── Profile Signal Bundle ─────────────────────────────────────

export const profileContextSignalSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profileName', 'isKids', 'watchDataOrigin'],
  properties: {
    profileName: stringSchema,
    isKids: booleanSchema,
    watchDataOrigin: { type: 'string', enum: ['server_sync'] },
    language: nullableStringSchema,
    region: nullableStringSchema,
  },
} as const;

export const profileLanguageSignalsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['secondary', 'audioPreferences', 'subtitlePreferences'],
  properties: {
    primary: nullableStringSchema,
    secondary: { type: 'array', items: stringSchema },
    audioPreferences: { type: 'array', items: stringSchema },
    subtitlePreferences: { type: 'array', items: stringSchema },
  },
} as const;

export const profileGenreSignalSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'score'],
  properties: { id: stringSchema, score: numberSchema },
} as const;

export const profilePersonSignalSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'score'],
  properties: { id: stringSchema, score: numberSchema },
} as const;

export const profileKeywordSignalSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'score'],
  properties: { id: stringSchema, score: numberSchema },
} as const;

export const profileTasteMaturitySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    maxAllowedRating: nullableStringSchema,
  },
} as const;

export const profileTasteSignalsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['genres', 'people', 'keywords'],
  properties: {
    genres: { type: 'array', items: profileGenreSignalSchema },
    people: { type: 'array', items: profilePersonSignalSchema },
    keywords: { type: 'array', items: profileKeywordSignalSchema },
    maturity: profileTasteMaturitySchema,
  },
} as const;

export const recoProviderSchema = { type: 'string', enum: ['tmdb', 'tvdb', 'imdb', 'kitsu'] } as const;
export const recoMediaTypeSchema = { type: 'string', enum: ['movie', 'tv'] } as const;
export const recoHomeSectionTypeSchema = { type: 'string', enum: ['categoryTabs', 'heroCarousel', 'contentRail', 'collectionRail'] } as const;

export const recoProviderRefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'providerId'],
  properties: {
    provider: recoProviderSchema,
    providerId: nonEmptyStringSchema,
  },
} as const;

export const recoItemRefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'providerRefs'],
  properties: {
    type: recoMediaTypeSchema,
    providerRefs: { type: 'array', items: recoProviderRefSchema, minItems: 1 },
  },
} as const;

// ── Per-signal read routes (history, ratings, watchlist, continue-watching,
//    episodic-follow) — shared shape with the public watch routes. The reco
//    engine hits these individually (parallel) instead of one bundle.
//    Response is the same BaseItemDtoQueryResult envelope used by /v1.
//    NOTE: enrichment is NOT run on these routes — display fields are null.
//    Consumers needing display metadata must enrich via ProviderIds.Tmdb. ▼▼▼

export const profileSignalReadQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: stringSchema,
    cursor: stringSchema,
    extended: { type: 'string', enum: ['true', 'false'] },
  },
} as const;

export const profileSignalReadRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['accountId', 'profileId'],
    properties: {
      accountId: nonEmptyStringSchema,
      profileId: nonEmptyStringSchema,
    },
  },
  querystring: profileSignalReadQuerySchema,
});

// ── Profile metadata read (reco pulls profileContext fields) ──────────
//    Returns the profile-scoped fields reco needs to assemble its
//    GenerateRequest.profileContext (profileName, isKids, language,
//    region, watchDataOrigin). These are not part of any watch signal.

export const profileMetaReadResponseSchema = successEnvelope({
  type: 'object',
  additionalProperties: false,
  required: ['profileName', 'isKids', 'language', 'region', 'watchDataOrigin'],
  properties: {
    profileName: stringSchema,
    isKids: { type: 'boolean' },
    language: nullableStringSchema,
    region: nullableStringSchema,
    watchDataOrigin: stringSchema,
  },
} as const);

export const profileMetaReadRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['accountId', 'profileId'],
    properties: {
      accountId: nonEmptyStringSchema,
      profileId: nonEmptyStringSchema,
    },
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  } as const,
  response: { 200: profileMetaReadResponseSchema },
});

// ── Taste profile read (GET) and write-back (PUT) ─────────────────────

export const tasteProfileReadQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sourceKey: stringSchema,
  },
} as const;

export const tasteTagConnectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['to', 'weight'],
  properties: {
    to: nonEmptyStringSchema,
    weight: numberSchema,
  },
} as const;

export const tasteWeightedEntrySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'shortScore', 'shortCount', 'longScore', 'longCount'],
  properties: {
    name: nonEmptyStringSchema,
    shortScore: numberSchema,
    shortCount: numberSchema,
    longScore: numberSchema,
    longCount: numberSchema,
    shortHistogram: { type: 'array', items: numberSchema },
    longHistogram: { type: 'array', items: numberSchema },
  },
} as const;

export const tastePersonEntrySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'shortScore', 'shortCount', 'longScore', 'longCount', 'roles'],
  properties: {
    name: nonEmptyStringSchema,
    shortScore: numberSchema,
    shortCount: numberSchema,
    longScore: numberSchema,
    longCount: numberSchema,
    shortHistogram: { type: 'array', items: numberSchema },
    longHistogram: { type: 'array', items: numberSchema },
    roles: { type: 'array', items: { type: 'string', enum: ['actor', 'director'] } },
  },
} as const;

export const tasteTagVectorEntrySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'shortScore', 'shortCount', 'longScore', 'longCount'],
  properties: {
    name: nonEmptyStringSchema,
    shortScore: numberSchema,
    shortCount: numberSchema,
    longScore: numberSchema,
    longCount: numberSchema,
    shortHistogram: { type: 'array', items: numberSchema },
    longHistogram: { type: 'array', items: numberSchema },
    connections: { type: 'array', items: tasteTagConnectionSchema, maxItems: 8 },
  },
} as const;

export const tasteVectorsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'genres', 'tags', 'people', 'mood', 'decades'],
  properties: {
    schemaVersion: { type: 'integer', enum: [2] },
    genres: { type: 'array', items: tasteWeightedEntrySchema },
    tags: { type: 'array', items: tasteTagVectorEntrySchema },
    people: { type: 'array', items: tastePersonEntrySchema },
    mood: { type: 'array', items: tasteWeightedEntrySchema },
    decades: { type: 'array', items: tasteWeightedEntrySchema },
    ratingTiers: { type: 'array', items: tasteWeightedEntrySchema },
  },
} as const;

export const tasteProfileRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profileId', 'sourceKey', 'contentTypePref', 'ratingTendency', 'watchingPace', 'aiSummary', 'source', 'version', 'createdAt', 'updatedAt', 'vectors'],
  properties: {
    profileId: stringSchema,
    sourceKey: stringSchema,
    contentTypePref: recordSchema,
    ratingTendency: recordSchema,
    watchingPace: nullableStringSchema,
    aiSummary: nullableStringSchema,
    source: stringSchema,
    vectors: tasteVectorsSchema,
    version: integerSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  },
} as const;

export const tasteProfileReadResponseSchema = successEnvelope({
  type: 'object',
  additionalProperties: false,
  required: ['tasteProfile'],
  properties: {
    tasteProfile: {
      anyOf: [tasteProfileRecordSchema, { type: 'null' }],
    },
  },
} as const);

export const tasteProfileReadRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['accountId', 'profileId'],
    properties: {
      accountId: nonEmptyStringSchema,
      profileId: nonEmptyStringSchema,
    },
  },
  querystring: tasteProfileReadQuerySchema,
  response: { 200: tasteProfileReadResponseSchema },
});

export const tasteProfileWriteBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceKey', 'contentTypePref', 'ratingTendency', 'watchingPace', 'aiSummary', 'source', 'vectors'],
  properties: {
    sourceKey: nonEmptyStringSchema,
    contentTypePref: recordSchema,
    ratingTendency: recordSchema,
    watchingPace: nullableStringSchema,
    aiSummary: nullableStringSchema,
    source: nonEmptyStringSchema,
    vectors: tasteVectorsSchema,
  },
} as const;
export type TasteTagConnection = {
  to: string;
  weight: number;
};

export type TasteWeightedEntry = {
  name: string;
  shortScore: number;
  shortCount: number;
  longScore: number;
  longCount: number;
  shortHistogram?: number[];
  longHistogram?: number[];
};

export type TastePersonEntry = TasteWeightedEntry & {
  roles: ('actor' | 'director')[];
};

export type TasteTagVectorEntry = TasteWeightedEntry & {
  connections?: TasteTagConnection[];
};

export type TasteVectors = {
  schemaVersion: 2;
  genres: TasteWeightedEntry[];
  tags: TasteTagVectorEntry[];
  people: TastePersonEntry[];
  mood: TasteWeightedEntry[];
  decades: TasteWeightedEntry[];
  ratingTiers: TasteWeightedEntry[];
};

export type TasteProfileWriteBody = {
  sourceKey: string;
  contentTypePref: Record<string, unknown>;
  ratingTendency: Record<string, unknown>;
  watchingPace: string | null;
  aiSummary: string | null;
  source: string;
  vectors: TasteVectors;
};

export const tasteProfileWriteRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['accountId', 'profileId'],
    properties: {
      accountId: nonEmptyStringSchema,
      profileId: nonEmptyStringSchema,
    },
  },
  body: tasteProfileWriteBodySchema,
  response: { 200: tasteProfileReadResponseSchema },
});

// ── Upsert Service Recommendation List ────────────────────────

export const serviceRecommendationWriteItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'providerRefs'],
  properties: {
    type: recoMediaTypeSchema,
    providerRefs: { type: 'array', items: recoProviderRefSchema, minItems: 1 },
    score: nullableNumberSchema,
    description: nullableStringSchema,
    metadata: recordSchema,
  },
} as const;

export const recoModelInfoSchema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['runId', 'algorithmVersion', 'modelVersion'],
      properties: {
        runId: nullableStringSchema,
        algorithmVersion: nonEmptyStringSchema,
        modelVersion: nullableStringSchema,
      },
    },
    { type: 'null' },
  ],
} as const;

export const upsertServiceRecommendationListBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'subtitle', 'sectionType', 'items', 'model', 'context'],
  properties: {
    title: nonEmptyStringSchema,
    subtitle: nullableStringSchema,
    sectionType: recoHomeSectionTypeSchema,
    items: { type: 'array', items: serviceRecommendationWriteItemSchema },
    model: recoModelInfoSchema,
    context: recordSchema,
  },
} as const;

export const recommendationListIdempotencySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'replayed'],
  properties: {
    key: stringSchema,
    replayed: booleanSchema,
  },
} as const;

export const upsertServiceRecommendationListEligibilitySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['checkedAt', 'eligible', 'eligibilityVersion'],
  properties: {
    checkedAt: dateTimeSchema,
    eligible: booleanSchema,
    eligibilityVersion: integerSchema,
  },
} as const;

export const upsertServiceRecommendationListResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accountId', 'profileId', 'listKey', 'source', 'version', 'status', 'itemCount', 'idempotency', 'createdAt', 'eligibility'],
  properties: {
    accountId: stringSchema,
    profileId: stringSchema,
    listKey: stringSchema,
    source: stringSchema,
    version: integerSchema,
    status: { type: 'string', enum: ['written', 'cleared', 'idempotent_replay'] },
    itemCount: integerSchema,
    idempotency: recommendationListIdempotencySchema,
    createdAt: dateTimeSchema,
    eligibility: upsertServiceRecommendationListEligibilitySchema,
  },
} as const;
export const upsertServiceRecommendationListResponseSchema = successEnvelope(upsertServiceRecommendationListResultSchema);
// ── Account-level Upsert Service Recommendation List ─────────

export const accountListUpsertRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['accountId', 'profileId', 'listKey'],
    properties: {
      accountId: nonEmptyStringSchema,
      profileId: nonEmptyStringSchema,
      listKey: nonEmptyStringSchema,
    },
  },
  body: upsertServiceRecommendationListBodySchema,
  response: { 200: upsertServiceRecommendationListResponseSchema, 201: upsertServiceRecommendationListResponseSchema },
});

// ── Batch Upsert Service Recommendation Lists ────────────────

export const serviceRecommendationProfileWriteResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accountId', 'profileId', 'status'],
  properties: {
    accountId: stringSchema,
    profileId: stringSchema,
    status: { type: 'string', enum: ['written', 'rejected'] },
    lists: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['listKey', 'source', 'version', 'itemCount'],
        properties: {
          listKey: stringSchema,
          source: stringSchema,
          version: integerSchema,
          itemCount: integerSchema,
        },
      },
    },
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: stringSchema,
        message: stringSchema,
        details: recordSchema,
      },
    },
  },
} as const;

export const batchUpsertSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profilesReceived', 'profilesWritten', 'profilesRejected', 'listsWritten', 'itemsWritten'],
  properties: {
    profilesReceived: integerSchema,
    profilesWritten: integerSchema,
    profilesRejected: integerSchema,
    listsWritten: integerSchema,
    itemsWritten: integerSchema,
  },
} as const;

export const batchUpsertResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary', 'results', 'requestHash', 'idempotency'],
  properties: {
    status: { type: 'string', enum: ['completed', 'completed_with_errors', 'failed'] },
    summary: batchUpsertSummarySchema,
    results: { type: 'array', items: serviceRecommendationProfileWriteResultSchema },
    requestHash: stringSchema,
    idempotency: recommendationListIdempotencySchema,
  },
} as const;
export const batchUpsertServiceRecommendationListsResponseSchema = successEnvelope(batchUpsertResultSchema);

export const batchUpsertServiceRecommendationListsBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profiles'],
  properties: {
    profiles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['accountId', 'profileId', 'lists'],
        properties: {
          accountId: stringSchema,
          profileId: stringSchema,
          lists: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'subtitle', 'sectionType', 'items', 'model', 'context'],
              properties: {
                title: nonEmptyStringSchema,
                subtitle: nullableStringSchema,
                sectionType: recoHomeSectionTypeSchema,
                items: { type: 'array', items: serviceRecommendationWriteItemSchema },
                model: recoModelInfoSchema,
                context: recordSchema,
              },
            },
          },
        },
      },
    },
  },
} as const;
export const batchUpsertRouteSchema = withDefaultErrorResponses({
  body: batchUpsertServiceRecommendationListsBodySchema,
  response: { 200: batchUpsertServiceRecommendationListsResponseSchema },
});

// ── Recommendation Run ────────────────────────────────────────

export const recommendationRunTypeSchema = {
  type: 'string',
  enum: ['incremental', 'snapshot', 'backfill', 'full_refresh'],
} as const;

export const recommendationRunStatusSchema = {
  type: 'string',
  enum: ['running', 'paused', 'completed', 'failed', 'cancelled'],
} as const;

export const recommendationRunProgressSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    profilesScanned: integerSchema,
    profilesGenerated: integerSchema,
    profilesSkipped: integerSchema,
    profilesFailed: integerSchema,
    listsWritten: integerSchema,
  },
} as const;

export const recommendationRunSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['runId', 'appId', 'purpose', 'runType', 'status', 'progress', 'createdAt', 'updatedAt'],
  properties: {
    runId: stringSchema,
    appId: stringSchema,
    purpose: { type: 'string', enum: ['recommendation-generation'] },
    runType: recommendationRunTypeSchema,
    status: recommendationRunStatusSchema,
    modelVersion: nullableStringSchema,
    algorithm: nullableStringSchema,
    input: { anyOf: [recordSchema, { type: 'null' }] },
    output: { anyOf: [recordSchema, { type: 'null' }] },
    metadata: { anyOf: [recordSchema, { type: 'null' }] },
    error: { anyOf: [recordSchema, { type: 'null' }] },
    progress: recommendationRunProgressSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    completedAt: nullableDateTimeSchema,
  },
} as const;

export const recommendationRunDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['run'],
  properties: { run: recommendationRunSchema },
} as const;
export const createRecommendationRunResponseSchema = successEnvelope(recommendationRunDataSchema);
export const updateRecommendationRunResponseSchema = successEnvelope(recommendationRunDataSchema);

export const createRecommendationRunBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['purpose', 'runType'],
  properties: {
    purpose: { type: 'string', enum: ['recommendation-generation'] },
    runType: recommendationRunTypeSchema,
    modelVersion: stringSchema,
    algorithm: stringSchema,
    input: recordSchema,
    metadata: recordSchema,
  },
} as const;

export const updateRecommendationRunBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: recommendationRunStatusSchema,
    progress: recommendationRunProgressSchema,
    output: recordSchema,
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: { code: stringSchema, message: stringSchema },
    },
  },
} as const;

export const createRecommendationRunRouteSchema = withDefaultErrorResponses({
  body: createRecommendationRunBodySchema,
  response: { 201: createRecommendationRunResponseSchema },
});

export const updateRecommendationRunRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['runId'],
    properties: { runId: nonEmptyStringSchema },
  },
  body: updateRecommendationRunBodySchema,
  response: { 200: updateRecommendationRunResponseSchema },
});

// ── Recommendation Batch ──────────────────────────────────────

export const recommendationBatchStatusSchema = {
  type: 'string',
  enum: ['leased', 'running', 'completed', 'failed', 'cancelled', 'expired'],
} as const;

export const recommendationBatchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['batchId', 'runId', 'appId', 'status', 'itemCount', 'createdAt', 'updatedAt'],
  properties: {
    batchId: stringSchema,
    runId: stringSchema,
    appId: stringSchema,
    status: recommendationBatchStatusSchema,
    snapshotId: nullableStringSchema,
    lease: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['leaseId', 'expiresAt'],
          properties: {
            leaseId: stringSchema,
            expiresAt: dateTimeSchema,
          },
        },
        { type: 'null' },
      ],
    },
    itemCount: integerSchema,
    progress: { type: 'object', additionalProperties: true },
    errors: {
      type: 'array',
      items: recordSchema,
    },
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  },
} as const;

export const recommendationBatchDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['batch'],
  properties: { batch: recommendationBatchSchema },
} as const;
export const createRecommendationBatchResponseSchema = successEnvelope(recommendationBatchDataSchema);
export const updateRecommendationBatchResponseSchema = successEnvelope(recommendationBatchDataSchema);

export const createRecommendationBatchBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    snapshotId: stringSchema,
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['accountId', 'profileId'],
        properties: {
          snapshotItemId: stringSchema,
          accountId: stringSchema,
          profileId: stringSchema,
        },
      },
    },
    leaseSeconds: integerSchema,
  },
} as const;

export const updateRecommendationBatchBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: recommendationBatchStatusSchema,
    progress: recordSchema,
    errors: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'message'],
        properties: {
          accountId: stringSchema,
          profileId: stringSchema,
          code: stringSchema,
          message: stringSchema,
        },
      },
    },
  },
} as const;

export const createRecommendationBatchRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['runId'],
    properties: { runId: nonEmptyStringSchema },
  },
  body: createRecommendationBatchBodySchema,
  response: { 201: createRecommendationBatchResponseSchema },
});

export const updateRecommendationBatchRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['runId', 'batchId'],
    properties: {
      runId: nonEmptyStringSchema,
      batchId: nonEmptyStringSchema,
    },
  },
  body: updateRecommendationBatchBodySchema,
  response: { 200: updateRecommendationBatchResponseSchema },
});

// ── Backfill Assignments ──────────────────────────────────────

export const recommendationBackfillAssignmentStatusSchema = {
  type: 'string',
  enum: ['active', 'paused', 'completed', 'cancelled', 'expired'],
} as const;

export const recommendationBackfillAssignmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['assignmentId', 'appId', 'snapshotId', 'status', 'priority', 'estimatedProfileCount', 'profilesCompleted', 'createdAt', 'updatedAt'],
  properties: {
    assignmentId: stringSchema,
    appId: stringSchema,
    snapshotId: stringSchema,
    status: recommendationBackfillAssignmentStatusSchema,
    priority: integerSchema,
    estimatedProfileCount: integerSchema,
    profilesCompleted: integerSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    expiresAt: nullableDateTimeSchema,
  },
} as const;

export const backfillAssignmentsDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['assignments', 'cursor'],
  properties: {
    assignments: { type: 'array', items: recommendationBackfillAssignmentSchema },
    cursor: cursorSchema,
  },
} as const;
export const backfillAssignmentsResponseSchema = successEnvelope(backfillAssignmentsDataSchema);

export const backfillAssignmentsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: recommendationBackfillAssignmentStatusSchema,
    limit: stringSchema,
    cursor: stringSchema,
  },
} as const;
export const backfillAssignmentsRouteSchema = withDefaultErrorResponses({
  querystring: backfillAssignmentsQuerySchema,
  response: { 200: backfillAssignmentsResponseSchema },
});

// ── App Audit Events ──────────────────────────────────────────

export const appAuditActionSchema = {
  type: 'string',
  enum: [
    'app_authenticated', 'app_auth_failed', 'app_scope_denied', 'app_grant_denied',
    'eligible_profile_changes_read', 'eligible_profile_snapshot_created',
    'eligible_profile_snapshot_items_claimed', 'profile_eligibility_checked',
    'service_recommendation_list_written',
    'service_recommendation_batch_written', 'recommendation_run_created',
    'recommendation_run_updated', 'recommendation_batch_created',
    'recommendation_batch_updated', 'backfill_assignments_read',
  ],
} as const;

export const appAuditEventRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['eventId', 'appId', 'action', 'createdAt'],
  properties: {
    eventId: stringSchema,
    appId: stringSchema,
    keyId: nullableStringSchema,
    action: appAuditActionSchema,
    accountId: nullableStringSchema,
    profileId: nullableStringSchema,
    runId: nullableStringSchema,
    batchId: nullableStringSchema,
    resourceType: nullableStringSchema,
    resourceId: nullableStringSchema,
    requestId: nullableStringSchema,
    metadata: { anyOf: [recordSchema, { type: 'null' }] },
    createdAt: dateTimeSchema,
  },
} as const;

export const appAuditEventsDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['events', 'cursor'],
  properties: {
    events: { type: 'array', items: appAuditEventRecordSchema },
    cursor: cursorSchema,
  },
} as const;
export const appAuditEventsResponseSchema = successEnvelope(appAuditEventsDataSchema);

export const appAuditEventsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accountId: stringSchema,
    profileId: stringSchema,
    runId: stringSchema,
    batchId: stringSchema,
    cursor: stringSchema,
    limit: stringSchema,
  },
} as const;
export const appAuditEventsRouteSchema = withDefaultErrorResponses({
  querystring: appAuditEventsQuerySchema,
  response: { 200: appAuditEventsResponseSchema },
});

// ── Create Audit Event (inline { success: true }) ─────────────

export const successOnlyDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success'],
  properties: { success: booleanSchema },
} as const;
export const createAuditEventResponseSchema = successEnvelope(successOnlyDataSchema);

export const createAuditEventBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['eventType', 'action'],
  properties: {
    eventType: stringSchema,
    accountId: stringSchema,
    profileId: stringSchema,
    resourceType: stringSchema,
    resourceId: stringSchema,
    action: appAuditActionSchema,
    outcome: { type: 'string', enum: ['success', 'failure'] },
    metadata: recordSchema,
  },
} as const;
export const createAuditEventRouteSchema = withDefaultErrorResponses({
  body: createAuditEventBodySchema,
  response: { 201: createAuditEventResponseSchema },
});

// ── Account Lookup By Email ───────────────────────────────────

export const accountWithProfilesDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['account', 'profiles'],
  properties: {
    account: {
      type: 'object',
      additionalProperties: false,
      required: ['accountId', 'email'],
      properties: {
        accountId: stringSchema,
        email: stringSchema,
      },
    },
    profiles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
      },
    },
  },
} as const;
export const accountLookupResponseSchema = successEnvelope(accountWithProfilesDataSchema);
export const accountLookupRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['email'],
    properties: { email: nonEmptyStringSchema },
  },
  response: { 200: accountLookupResponseSchema },
});
