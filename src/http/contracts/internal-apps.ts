export const appErrorResponseSchema = {
  type: 'object',
  required: ['code', 'message'],
  properties: { code: { type: 'string' }, message: { type: 'string' } },
};

export const appSelfResponseSchema = { type: 'object', additionalProperties: true };
export const eligibleProfileChangesQuerySchema = { type: 'object', additionalProperties: true };
export const eligibleProfileChangesResponseSchema = { type: 'object', additionalProperties: true };
export const createEligibleProfileSnapshotBodySchema = { type: 'object', additionalProperties: true };
export const createEligibleProfileSnapshotResponseSchema = { type: 'object', additionalProperties: true };
export const getEligibleProfileSnapshotItemsQuerySchema = { type: 'object', additionalProperties: true };
export const getEligibleProfileSnapshotItemsResponseSchema = { type: 'object', additionalProperties: true };
export const profileEligibilityQuerySchema = { type: 'object', additionalProperties: true };
export const profileEligibilityResponseSchema = { type: 'object', additionalProperties: true };
export const profileSignalBundleQuerySchema = { type: 'object', additionalProperties: true };
export const profileSignalBundleResponseSchema = { type: 'object', additionalProperties: true };
export const serviceRecommendationListsResponseSchema = { type: 'object', additionalProperties: true };
export const upsertServiceRecommendationListBodySchema = { type: 'object', additionalProperties: true };
export const upsertServiceRecommendationListResponseSchema = { type: 'object', additionalProperties: true };
export const batchUpsertServiceRecommendationListsBodySchema = { type: 'object', additionalProperties: true };
export const batchUpsertServiceRecommendationListsResponseSchema = { type: 'object', additionalProperties: true };
export const createRecommendationRunBodySchema = { type: 'object', additionalProperties: true };
export const createRecommendationRunResponseSchema = { type: 'object', additionalProperties: true };
export const updateRecommendationRunBodySchema = { type: 'object', additionalProperties: true };
export const updateRecommendationRunResponseSchema = { type: 'object', additionalProperties: true };
export const createRecommendationBatchBodySchema = { type: 'object', additionalProperties: true };
export const createRecommendationBatchResponseSchema = { type: 'object', additionalProperties: true };
export const updateRecommendationBatchBodySchema = { type: 'object', additionalProperties: true };
export const updateRecommendationBatchResponseSchema = { type: 'object', additionalProperties: true };
export const backfillAssignmentsQuerySchema = { type: 'object', additionalProperties: true };
export const backfillAssignmentsResponseSchema = { type: 'object', additionalProperties: true };
export const appAuditEventsQuerySchema = { type: 'object', additionalProperties: true };
export const appAuditEventsResponseSchema = { type: 'object', additionalProperties: true };
