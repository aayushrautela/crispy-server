import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { RecommendationProfileWorkStateRecord } from './recommendation-consumer.types.js';
import type {
  ClaimRecommendationWorkInput,
  CompleteRecommendationLeaseInput,
  RecommendationWorkItem,
  RenewRecommendationLeaseInput,
} from './recommendation-work.types.js';

function mapWorkState(row: Record<string, unknown>): RecommendationProfileWorkStateRecord {
  return {
    consumerId: String(row.consumer_id),
    profileId: String(row.profile_id),
    lastCompletedEventId: Number(row.last_completed_event_id ?? 0),
    claimedThroughEventId: row.claimed_through_event_id === null ? null : Number(row.claimed_through_event_id),
    claimedHistoryGeneration: row.claimed_history_generation === null ? null : Number(row.claimed_history_generation),
    leaseId: typeof row.lease_id === 'string' ? row.lease_id : null,
    leaseOwner: typeof row.lease_owner === 'string' ? row.lease_owner : null,
    leaseExpiresAt: typeof row.lease_expires_at === 'string' ? row.lease_expires_at : null,
    updatedAt: String(row.updated_at),
  };
}

type PendingCandidate = {
  accountId: string;
  profileId: string;
  throughEventId: number;
  historyGeneration: number;
  pendingEventCount: number;
  name: string;
  isKids: boolean;
  updatedAt: string;
};

export type RecommendationLeaseDiagnosticRecord = {
  consumerId: string;
  consumerKey: string;
  displayName: string;
  sourceKey: string;
  profileId: string;
  profileName: string;
  leaseId: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  claimedHistoryGeneration: number | null;
  pendingEventCount: number;
  updatedAt: string;
};

export type RecommendationBacklogSummaryRecord = {
  consumerId: string;
  consumerKey: string;
  displayName: string;
  sourceKey: string;
  pendingProfileCount: number;
  pendingEventCount: number;
  oldestOccurredAt: string | null;
  newestEventId: number | null;
};

export class RecommendationWorkStateRepository {
  async claimPendingProfiles(client: DbClient, input: ClaimRecommendationWorkInput & { sourceKey: string }): Promise<RecommendationWorkItem[]> {
    const candidates = await this.listPendingCandidates(client, input);
    const claimed: RecommendationWorkItem[] = [];

    for (const candidate of candidates) {
      const leaseId = randomUUID();
      const result = await client.query(
        `
          INSERT INTO recommendation_profile_work_state (
            consumer_id,
            profile_id,
            last_completed_event_id,
            claimed_through_event_id,
            claimed_history_generation,
            lease_id,
            lease_owner,
            lease_expires_at,
            updated_at
          )
          VALUES (
            $1::uuid,
            $2::uuid,
            0,
            $3::bigint,
            $4,
            $5::uuid,
            $6,
            now() + make_interval(secs => $7),
            now()
          )
          ON CONFLICT (consumer_id, profile_id)
          DO UPDATE SET
            claimed_through_event_id = EXCLUDED.claimed_through_event_id,
            claimed_history_generation = EXCLUDED.claimed_history_generation,
            lease_id = EXCLUDED.lease_id,
            lease_owner = EXCLUDED.lease_owner,
            lease_expires_at = EXCLUDED.lease_expires_at,
            updated_at = now()
          WHERE recommendation_profile_work_state.lease_expires_at IS NULL
             OR recommendation_profile_work_state.lease_expires_at < now()
          RETURNING consumer_id, profile_id, last_completed_event_id, claimed_through_event_id,
                    claimed_history_generation, lease_id, lease_owner, lease_expires_at, updated_at
        `,
        [
          input.consumerId,
          candidate.profileId,
          candidate.throughEventId,
          candidate.historyGeneration,
          leaseId,
          input.workerId,
          input.leaseTtlSeconds,
        ],
      );

      if (!result.rows[0]) {
        continue;
      }

      const state = mapWorkState(result.rows[0]);
      claimed.push({
        consumerId: input.consumerId,
        sourceKey: input.sourceKey,
        accountId: candidate.accountId,
        profileId: candidate.profileId,
        leaseId: state.leaseId!,
        leaseExpiresAt: state.leaseExpiresAt!,
        throughEventId: candidate.throughEventId,
        historyGeneration: candidate.historyGeneration,
        pendingEventCount: candidate.pendingEventCount,
        profile: {
          name: candidate.name,
          isKids: candidate.isKids,
          updatedAt: candidate.updatedAt,
        },
      });

      if (claimed.length >= input.limit) {
        break;
      }
    }

    return claimed;
  }

  async renewLease(client: DbClient, input: RenewRecommendationLeaseInput): Promise<RecommendationProfileWorkStateRecord> {
    const result = await client.query(
      `
        UPDATE recommendation_profile_work_state
        SET lease_expires_at = now() + make_interval(secs => $5),
            updated_at = now()
        WHERE consumer_id = $1::uuid
          AND profile_id = $2::uuid
          AND lease_id = $3::uuid
          AND lease_owner = $4
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at > now()
        RETURNING consumer_id, profile_id, last_completed_event_id, claimed_through_event_id,
                  claimed_history_generation, lease_id, lease_owner, lease_expires_at, updated_at
      `,
      [input.consumerId, input.profileId, input.leaseId, input.workerId, input.leaseTtlSeconds],
    );

    if (!result.rows[0]) {
      throw new HttpError(409, 'Lease not found or already expired.');
    }

    return mapWorkState(result.rows[0]);
  }

  async completeLease(client: DbClient, input: CompleteRecommendationLeaseInput): Promise<RecommendationProfileWorkStateRecord> {
    const result = await client.query(
      `
        UPDATE recommendation_profile_work_state
        SET last_completed_event_id = claimed_through_event_id,
            claimed_through_event_id = NULL,
            claimed_history_generation = NULL,
            lease_id = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        WHERE consumer_id = $1::uuid
          AND profile_id = $2::uuid
          AND lease_id = $3::uuid
          AND lease_owner = $4
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at > now()
        RETURNING consumer_id, profile_id, last_completed_event_id, claimed_through_event_id,
                  claimed_history_generation, lease_id, lease_owner, lease_expires_at, updated_at
      `,
      [input.consumerId, input.profileId, input.leaseId, input.workerId],
    );

    if (!result.rows[0]) {
      throw new HttpError(409, 'Lease not found or already expired.');
    }

    return mapWorkState(result.rows[0]);
  }

  async clearClaimsForProfile(client: DbClient, profileId: string): Promise<void> {
    await client.query(
      `
        UPDATE recommendation_profile_work_state
        SET claimed_through_event_id = NULL,
            claimed_history_generation = NULL,
            lease_id = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        WHERE profile_id = $1::uuid
      `,
      [profileId],
    );
  }

  async listActiveLeases(client: DbClient, limit: number): Promise<RecommendationLeaseDiagnosticRecord[]> {
    return this.listLeases(client, false, limit);
  }

  async listStaleLeases(client: DbClient, limit: number): Promise<RecommendationLeaseDiagnosticRecord[]> {
    return this.listLeases(client, true, limit);
  }

  async listBacklogSummaries(client: DbClient, limit: number): Promise<RecommendationBacklogSummaryRecord[]> {
    const result = await client.query(
      `
        WITH consumer_profiles AS (
          SELECT rc.id AS consumer_id,
                 rc.consumer_key,
                 rc.display_name,
                 rc.source_key,
                 p.id AS profile_id,
                 COALESCE(rpws.last_completed_event_id, 0) AS last_completed_event_id
          FROM recommendation_consumers rc
          CROSS JOIN profiles p
          LEFT JOIN recommendation_profile_work_state rpws
            ON rpws.consumer_id = rc.id
           AND rpws.profile_id = p.id
          WHERE rc.status = 'active'
        )
        SELECT cp.consumer_id,
               cp.consumer_key,
               cp.display_name,
               cp.source_key,
               COUNT(DISTINCT reo.profile_id)::integer AS pending_profile_count,
               COUNT(reo.id)::integer AS pending_event_count,
               MIN(reo.occurred_at) AS oldest_occurred_at,
               MAX(reo.id) AS newest_event_id
        FROM consumer_profiles cp
        INNER JOIN recommendation_event_outbox reo
          ON reo.profile_id = cp.profile_id
         AND reo.id > cp.last_completed_event_id
        GROUP BY cp.consumer_id, cp.consumer_key, cp.display_name, cp.source_key
        ORDER BY pending_event_count DESC, oldest_occurred_at ASC NULLS LAST
        LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) => ({
      consumerId: String(row.consumer_id),
      consumerKey: String(row.consumer_key),
      displayName: String(row.display_name),
      sourceKey: String(row.source_key),
      pendingProfileCount: Number(row.pending_profile_count ?? 0),
      pendingEventCount: Number(row.pending_event_count ?? 0),
      oldestOccurredAt: typeof row.oldest_occurred_at === 'string' ? row.oldest_occurred_at : null,
      newestEventId: row.newest_event_id === null ? null : Number(row.newest_event_id),
    }));
  }

  private async listLeases(client: DbClient, stale: boolean, limit: number): Promise<RecommendationLeaseDiagnosticRecord[]> {
    const comparator = stale ? '<' : '>=';
    const result = await client.query(
      `
        SELECT rpws.consumer_id,
               rc.consumer_key,
               rc.display_name,
               rc.source_key,
               rpws.profile_id,
               p.name AS profile_name,
               rpws.lease_id,
               rpws.lease_owner,
               rpws.lease_expires_at,
               rpws.claimed_history_generation,
               COUNT(reo.id)::integer AS pending_event_count,
               rpws.updated_at
        FROM recommendation_profile_work_state rpws
        INNER JOIN recommendation_consumers rc ON rc.id = rpws.consumer_id
        INNER JOIN profiles p ON p.id = rpws.profile_id
        LEFT JOIN recommendation_event_outbox reo
          ON reo.profile_id = rpws.profile_id
         AND reo.id > COALESCE(rpws.last_completed_event_id, 0)
        WHERE rpws.lease_id IS NOT NULL
          AND rpws.lease_expires_at IS NOT NULL
          AND rpws.lease_expires_at ${comparator} now()
        GROUP BY rpws.consumer_id, rc.consumer_key, rc.display_name, rc.source_key,
                 rpws.profile_id, p.name, rpws.lease_id, rpws.lease_owner,
                 rpws.lease_expires_at, rpws.claimed_history_generation, rpws.updated_at
        ORDER BY rpws.lease_expires_at ASC, rpws.updated_at DESC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) => ({
      consumerId: String(row.consumer_id),
      consumerKey: String(row.consumer_key),
      displayName: String(row.display_name),
      sourceKey: String(row.source_key),
      profileId: String(row.profile_id),
      profileName: String(row.profile_name),
      leaseId: String(row.lease_id),
      leaseOwner: String(row.lease_owner),
      leaseExpiresAt: String(row.lease_expires_at),
      claimedHistoryGeneration: row.claimed_history_generation === null ? null : Number(row.claimed_history_generation),
      pendingEventCount: Number(row.pending_event_count ?? 0),
      updatedAt: String(row.updated_at),
    }));
  }

  private async listPendingCandidates(client: DbClient, input: ClaimRecommendationWorkInput): Promise<PendingCandidate[]> {
    const query = input.restrictToUserId
      ? `
          WITH eligible_profiles AS (
            SELECT p.id, p.name, p.is_kids, p.updated_at, pg.owner_user_id AS account_id
            FROM profiles p
            INNER JOIN profile_group_members pgm ON pgm.profile_group_id = p.profile_group_id
            INNER JOIN profile_groups pg ON pg.id = p.profile_group_id
            WHERE pgm.user_id = $2::uuid
          ), work AS (
            SELECT
              ep.id AS profile_id,
              ep.name,
              ep.is_kids,
              ep.updated_at,
              ep.account_id,
              COALESCE(rpws.last_completed_event_id, 0) AS last_completed_event_id,
              rpws.lease_expires_at
            FROM eligible_profiles ep
            LEFT JOIN recommendation_profile_work_state rpws
              ON rpws.consumer_id = $1::uuid AND rpws.profile_id = ep.id
          )
          SELECT
            reo.profile_id,
            MAX(reo.id) AS through_event_id,
            MAX(reo.history_generation) AS history_generation,
             COUNT(*)::integer AS pending_event_count,
             MIN(reo.occurred_at) AS oldest_occurred_at,
             work.name,
             work.is_kids,
             work.updated_at,
             work.account_id
           FROM work
           INNER JOIN recommendation_event_outbox reo ON reo.profile_id = work.profile_id
           WHERE reo.id > work.last_completed_event_id
             AND (work.lease_expires_at IS NULL OR work.lease_expires_at < now())
           GROUP BY reo.profile_id, work.name, work.is_kids, work.updated_at, work.account_id
           ORDER BY oldest_occurred_at ASC, through_event_id ASC
           LIMIT $3
        `
      : `
          WITH work AS (
            SELECT
              p.id AS profile_id,
              p.name,
              p.is_kids,
              p.updated_at,
              pg.owner_user_id AS account_id,
              COALESCE(rpws.last_completed_event_id, 0) AS last_completed_event_id,
              rpws.lease_expires_at
            FROM profiles p
            INNER JOIN profile_groups pg ON pg.id = p.profile_group_id
            LEFT JOIN recommendation_profile_work_state rpws
              ON rpws.consumer_id = $1::uuid AND rpws.profile_id = p.id
          )
          SELECT
            reo.profile_id,
            MAX(reo.id) AS through_event_id,
            MAX(reo.history_generation) AS history_generation,
             COUNT(*)::integer AS pending_event_count,
             MIN(reo.occurred_at) AS oldest_occurred_at,
             work.name,
             work.is_kids,
             work.updated_at,
             work.account_id
           FROM work
           INNER JOIN recommendation_event_outbox reo ON reo.profile_id = work.profile_id
           WHERE reo.id > work.last_completed_event_id
             AND (work.lease_expires_at IS NULL OR work.lease_expires_at < now())
           GROUP BY reo.profile_id, work.name, work.is_kids, work.updated_at, work.account_id
           ORDER BY oldest_occurred_at ASC, through_event_id ASC
           LIMIT $2
        `;

    const params = input.restrictToUserId
      ? [input.consumerId, input.restrictToUserId, Math.max(input.limit * 3, input.limit)]
      : [input.consumerId, Math.max(input.limit * 3, input.limit)];

    const result = await client.query(query, params);
    return result.rows.map((row) => ({
      accountId: String(row.account_id),
      profileId: String(row.profile_id),
      throughEventId: Number(row.through_event_id),
      historyGeneration: Number(row.history_generation),
      pendingEventCount: Number(row.pending_event_count),
      name: String(row.name),
      isKids: Boolean(row.is_kids),
      updatedAt: String(row.updated_at),
    }));
  }
}
