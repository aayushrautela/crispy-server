import type { AppAuditRepo } from './app-audit.repo.js';
import type { AppAuthorizationService } from './app-authorization.service.js';
import type { AppCursorCodec } from './app-cursor-codec.js';
import type {
  BackfillAssignmentsResponse,
  GetBackfillAssignmentsInput,
} from './recommendation-backfill.types.js';
import type { RecommendationBackfillRepo } from './recommendation-backfill.repo.js';

export interface RecommendationBackfillService {
  getAssignments(input: GetBackfillAssignmentsInput): Promise<BackfillAssignmentsResponse>;
}

export class DefaultRecommendationBackfillService implements RecommendationBackfillService {
  constructor(
    private readonly deps: {
      repo: RecommendationBackfillRepo;
      cursorCodec: AppCursorCodec;
      appAuthorizationService: AppAuthorizationService;
      appAuditRepo: AppAuditRepo;
      maxLimit: number;
    },
  ) {}

  async getAssignments(input: GetBackfillAssignmentsInput): Promise<BackfillAssignmentsResponse> {
    const { principal, query } = input;

    this.deps.appAuthorizationService.requireScope({ principal, scope: 'recommendations:backfills:read' });

    const limit = Math.min(query.limit ?? 50, this.deps.maxLimit);
    let afterCreatedAt: Date | undefined;

    if (query.cursor) {
      try {
        const decoded = this.deps.cursorCodec.decode(query.cursor);
        if (decoded.appId !== principal.appId) {
          throw new Error('cursor_app_mismatch');
        }
        afterCreatedAt = decoded.issuedAt ? new Date(decoded.issuedAt) : undefined;
      } catch {
        throw new Error('invalid_cursor');
      }
    }

    const assignments = await this.deps.repo.listAssignments({
      appId: principal.appId,
      status: query.status,
      afterCreatedAt,
      limit: limit + 1,
    });

    const items = assignments.slice(0, limit);
    const hasMore = assignments.length > limit;
    const last = items.at(-1);

    await this.deps.appAuditRepo.insert({
      appId: principal.appId,
      keyId: principal.keyId,
      action: 'backfill_assignments_read',
      metadata: { count: items.length, status: query.status },
    });

    return {
      assignments: items,
      cursor: {
        hasMore,
        next: hasMore && last
          ? this.deps.cursorCodec.encode({
              appId: principal.appId,
              kind: 'app_audit_events',
              issuedAt: last.createdAt.toISOString(),
            })
          : null,
      },
    };
  }
}
