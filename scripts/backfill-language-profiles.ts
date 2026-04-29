import { withDbClient } from '../src/lib/db.js';
import { LanguageProfileProjectionService } from '../src/modules/language-profile/language-profile-projection.service.js';

export async function backfillLanguageProfiles(): Promise<void> {
  console.log('Starting language profile backfill...');

  await withDbClient(async (client) => {
    const result = await client.query(`
      SELECT id FROM profiles ORDER BY created_at ASC
    `);

    const profileIds = result.rows.map((row) => String(row.id));
    console.log(`Found ${profileIds.length} profiles to process`);

    const projectionService = new LanguageProfileProjectionService();
    let processed = 0;
    let errors = 0;

    for (const profileId of profileIds) {
      try {
        await projectionService.recomputeForProfile(client, profileId, 50);
        processed++;
        if (processed % 10 === 0) {
          console.log(`Processed ${processed}/${profileIds.length} profiles`);
        }
      } catch (error) {
        errors++;
        console.error(`Failed to compute language profile for ${profileId}:`, error);
      }
    }

    console.log(`Backfill complete: ${processed} processed, ${errors} errors`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  backfillLanguageProfiles()
    .then(() => {
      console.log('Done');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Backfill failed:', error);
      process.exit(1);
    });
}
