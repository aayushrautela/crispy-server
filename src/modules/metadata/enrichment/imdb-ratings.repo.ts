import type { DbClient } from '../../../lib/db.js';

export type ImdbRating = {
  rating: number;
  votes: number;
};

export class ImdbRatingsRepository {
  async findByImdbId(client: DbClient, imdbId: string): Promise<ImdbRating | null> {
    const result = await client.query(
      `
        SELECT rating, votes
        FROM imdb_ratings
        WHERE imdb_id = $1
      `,
      [imdbId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      rating: parseFloat(row.rating),
      votes: parseInt(row.votes, 10),
    };
  }

  async upsertMany(client: DbClient, ratings: Array<{ imdbId: string; rating: number; votes: number }>): Promise<void> {
    if (ratings.length === 0) return;

    const values: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    for (const entry of ratings) {
      values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
      params.push(entry.imdbId, entry.rating, entry.votes);
    }

    await client.query(
      `
        INSERT INTO imdb_ratings (imdb_id, rating, votes, updated_at)
        VALUES ${values.map((value) => `${value}, now()`).join(', ')}
        ON CONFLICT (imdb_id)
        DO UPDATE SET
          rating = EXCLUDED.rating,
          votes = EXCLUDED.votes,
          updated_at = now()
      `,
      params,
    );
  }

  async count(client: DbClient): Promise<number> {
    const result = await client.query('SELECT count(*) as count FROM imdb_ratings');
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async clear(client: DbClient): Promise<void> {
    await client.query('DELETE FROM imdb_ratings');
  }
}
