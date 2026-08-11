import { spawnSync } from 'node:child_process';

type Rule = {
  pattern: string;
  message: string;
  filter?: (line: string) => boolean;
};

const rules: Rule[] = [
  {
    pattern: 'metadata-view\\.service\\.js|metadata-normalizers\\.js|metadata-query\\.service\\.js|metadata-direct\\.service\\.js',
    message: 'Retired mixed metadata modules must not be imported again.',
  },
  {
    pattern: 'ContinueWatchingService|WatchedQueryService',
    message: 'Top-level personal-media callers should use PersonalMediaService instead of removed thin wrappers.',
  },
  {
    pattern: 'registerHomeRoutes|canonical_home|refresh-home-cache|tracked-series|WatchV2TrackedQueryService|TrackedTitleRow|toTrackedTitleIdentity|syncTrackedTitleState|deleteTrackedTitleState|upsertTrackedTitleState|refreshProfileTrackedTitles|refreshProfileTrackedSeries',
    message: 'Removed home/tracked-series architecture pieces must not be reintroduced into src runtime code. Note: homeCacheKey is intentionally excluded - it is now a private helper inside the unified home-resolver/home-write services, distinct from the removed src/http/routes/home.ts implementation.',
  },
  {
    pattern: 'received[A-Z][A-Za-z0-9]*:',
    message: 'Route stubs should not return debug-only received* fields in response payloads. Capture args outside the response object instead.',
    filter: (line) => line.includes('src/http/routes/') && line.includes('.test.ts') && line.includes('received') && line.includes(': input.'),
  },
  {
    pattern: '\\.input\\b',
    message: 'Route tests should not rely on debug-only response.input payloads. Assert against real contract fields or captured call args.',
    filter: (line) => line.includes('src/http/routes/') && line.includes('.test.ts') && line.includes('.input'),
  },
  {
    pattern: '/api/integrations/v1/(profiles|recommendation|config-bundle|eligible|signals)',
    message: 'Retired RECO routes under /api/integrations/v1 must not be reintroduced. Use /internal/apps/v1 and /internal/confidential/v1 instead.',
    filter: (line) => !line.includes('PRIVILEGED_APP_ARCHITECTURE_PLAN.md') && !line.includes('PUBLIC_ACCOUNT_API_PLAN.md') && !line.includes('PRIVATE_CONFIDENTIAL_API_PLAN.md') && !line.includes('PUBLIC_ACCOUNT_WRITE_API_PLAN.md'),
  },
  {
    pattern: 'PublicWatchReadService|PersonalMediaService|WatchExportService|WatchQueryService|WatchV2|Heartbeat|enqueueHeartbeatFlush|enqueueMetadataRefresh|enqueueRebuildProfileProjections|runMetadataRefreshJob|runRebuildProfileProjectionsJob|profile_title_projection|profile_playable_state|profile_watchlist_state|profile_rating_state|profile_play_history|profile_watch_override|watch-v2',
    message: 'Retired local watch-state/projection modules must not be reintroduced.',
  },
  {
    pattern: 'getSupabaseServiceRoleClient|createSupabaseUserClient|SupabaseClient',
    message: 'Supabase JS client layer has been removed from app-data code. Auth-only operations must not use the Supabase JS SDK.',
  },
  {
    pattern: 'SupabaseRecommendationRunRepo|SupabaseRecommendationBatchRepo|service_create_run|service_update_run|service_create_batch|service_update_batch',
    message: 'Supabase recommendation repository layer has been removed. Use local SQL repositories only.',
  },
  {
    pattern: 'SupabaseAdminWatchReadService|WatchSupabaseEnrichmentService|SupabaseWatchReadRow|mapSupabase',
    message: 'Supabase-named service/type/functions have been renamed to storage-neutral names.',
  },
  {
    pattern: 'supabase-watch-read|supabase-admin-watch-read|watch-supabase-enrichment|supabase-provider-history-writer',
    message: 'Supabase-named watch/integration files have been renamed to storage-neutral names.',
  },
  {
    pattern: 'bootstrap_account|record_playback_state|replace_provider_import_history',
    message: 'Supabase RPC app-data calls have been removed. Use local SQL queries instead.',
  },
  {
    pattern: 'schema\\(.reco.\\)|\.from\\(.runs.\\)|\.from\\(.batches.\\)',
    message: 'Supabase repo schema/client calls have been removed. Use local SQL repositories.',
  },
  {
    pattern: 'profileIdAndMediaKeyParamsSchema|watchMediaKeyMutationRouteSchema|watchMediaKeyParamsRouteSchema|WatchMediaKeyParams',
    message: 'Retired public media-key route schemas and types must not be reintroduced. Use itemId-based schemas instead.',
  },
  {
    pattern: 'IntegrationRecommendationService|IntegrationRecommendationRepository|IntegrationRecommendationError|integration-recommendation\\.(service|repo|types)\\.js|profile_recommendation_lists|profile_recommendation_list_items|recommendation_write_requests',
    message: 'Retired per-rail integration-recommendations ingest module has been removed. The unified HomeWriteService pipeline (recommendation_active_lists + recommendation_list_versions) is the only home-feed ingest path.',
  },
  {
    pattern: 'ProfileSignalBundle|profile-signal-bundle|recommendation-bundle|ProfileInputSignal|profile-input-signal|/signals/recommendation-bundle|RecommendationSignalBundleResponse|RecommendationSignalBundle|recommendation-signal\\.types|RecoContinueSignal|RecoHistorySignal|RecoRatingSignal|RecoWatchlistSignal|RecoNegativeSignal|RecoImpressionSignal|RecoItemRef|profile_signal_bundle_read',
    message: 'Retired recommendation-bundle ingest path and signal-bundle types have been removed. Use per-signal read routes at /internal/apps/v1/.../signals/watch/{history,ratings,watchlist,continue-watching,episodic-follow} and /signals/taste instead. Signal-bundle types (RecommendationSignalBundle, Reco*Signal, RecoItemRef) and the profile_signal_bundle_read audit action must not be reintroduced.',
  },
  {
    pattern: 'WatchMetadataEnrichmentService|watch-metadata-enrichment|AdminWatchReadService|admin-watch-read',
    message: 'The dual-shape enrichment layers have been collapsed. The single read-time card-enrichment pass lives in MetadataCardService/HomeHydrator and is the only enrichment path. WatchMetadataEnrichmentService and the duplicate AdminWatchReadService must not be reintroduced.',
  },
  {
    pattern: 'signal_bundle_mapper|signal_assembler|signal-bundle-mapper|signal-assembler',
    message: 'Reco-side bundle mapper and assembler have been deleted. The single cardToRecoInput helper reads itemId + mediaType directly off ClientMediaCard rows from the per-signal routes; no BaseItemDto→ProviderIds.Tmdb/Type/UserData extraction step exists. signal_bundle_mapper and signal_assembler must not be reintroduced.',
  },
  {
    pattern: 'parseHomeWriteBody',
    message: 'The hand-rolled home write parser has been replaced by the shared parseRecoListWriteRequest in src/modules/recommendations/reco-list-write-parser.ts. parseHomeWriteBody must not be reintroduced; the public PUT /v1/.../home route uses parseRecoListWriteRequest. The internal PUT /internal/apps/v1/.../recommendations/lists/:listKey route retains its own richer validation (ServiceRecommendationListService.validateSingleRequest) because it accepts score/description/metadata fields the public route does not.',
  },
];

function runGrep(rule: Rule) {
  const result = spawnSync(
    'grep',
    ['-RInE', '--include=*.ts', rule.pattern, 'src'],
    { encoding: 'utf8', cwd: process.cwd() },
  );

  if (result.status === 1) {
    return [];
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || `grep failed for pattern: ${rule.pattern}`);
  }

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => (rule.filter ? rule.filter(line) : true));
}

const failures: Array<{ rule: Rule; matches: string[] }> = [];

for (const rule of rules) {
  const matches = runGrep(rule);
  if (matches.length > 0) {
    failures.push({ rule, matches });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n[guard-retired-modules] ${failure.rule.message}`);
    for (const match of failure.matches) {
      console.error(`- ${match}`);
    }
  }
  process.exit(1);
}

console.log('[guard-retired-modules] OK');
