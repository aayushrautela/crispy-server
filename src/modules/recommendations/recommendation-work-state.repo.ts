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
  profileId: string;
  throughEventId: number;
  historyGeneration: number;
  pendingEventCount: number;
  name: string;
  isKids: boolean;
  updatedAt: string;
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

  private async listPendingCandidates(client: DbClient, input: ClaimRecommendationWorkInput): Promise<PendingCandidate[]> {
    const query = input.restrictToUserId
      ? `
          WITH eligible_profiles AS (
            SELECT p.id, p.name, p.is_kids, p.updated_at
            FROM profiles p
            INNER JOIN household_members hm ON hm.household_id = p.household_id
            WHERE hm.user_id = $2::uuid
          ), work AS (
            SELECT
              ep.id AS profile_id,
              ep.name,
              ep.is_kids,
              ep.updated_at,
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
            work.updated_at
          FROM work
          INNER JOIN recommendation_event_outbox reo ON reo.profile_id = work.profile_id
          WHERE reo.id > work.last_completed_event_id
            AND (work.lease_expires_at IS NULL OR work.lease_expires_at < now())
          GROUP BY reo.profile_id, work.name, work.is_kids, work.updated_at
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
              COALESCE(rpws.last_completed_event_id, 0) AS last_completed_event_id,
              rpws.lease_expires_at
            FROM profiles p
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
            work.updated_at
          FROM work
          INNER JOIN recommendation_event_outbox reo ON reo.profile_id = work.profile_id
          WHERE reo.id > work.last_completed_event_id
            AND (work.lease_expires_at IS NULL OR work.lease_expires_at < now())
          GROUP BY reo.profile_id, work.name, work.is_kids, work.updated_at
          ORDER BY oldest_occurred_at ASC, through_event_id ASC
          LIMIT $2
        `;

    const params = input.restrictToUserId
      ? [input.consumerId, input.restrictToUserId, Math.max(input.limit * 3, input.limit)]
      : [input.consumerId, Math.max(input.limit * 3, input.limit)];

    const result = await client.query(query, params);
    return result.rows.map((row) => ({
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
