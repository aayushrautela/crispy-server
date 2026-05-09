import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const outputDir = resolve(root, 'docs/api/generated');

// Ensure output directory exists
mkdirSync(outputDir, { recursive: true });

const specs = [
  { file: 'openapi/public-app.v1.yaml', class: 'Public App API', types: 'openapi/generated/public-app.v1.types.ts' },
  { file: 'openapi/public-account.v1.yaml', class: 'Public Account API', types: 'openapi/generated/public-account.v1.types.ts' },
  { file: 'openapi/internal-services.v1.yaml', class: 'Internal Service API', types: 'openapi/generated/internal-services.v1.types.ts' },
  { file: 'openapi/internal-recommender.v1.yaml', class: 'Internal Service API (Recommender)', types: 'openapi/generated/internal-recommender.v1.types.ts' },
  { file: 'openapi/internal-confidential.v1.yaml', class: 'Confidential Internal API', types: 'openapi/generated/internal-confidential.v1.types.ts' },
  { file: 'openapi/admin-ops.v1.yaml', class: 'Admin/Ops API', types: 'openapi/generated/admin-ops.v1.types.ts' },
  { file: 'openapi/health-infrastructure.yaml', class: 'Health/Infrastructure API', types: 'openapi/generated/health-infrastructure.types.ts' },
];

const manifest = {
  generated: new Date().toISOString(),
  specs: specs.map(spec => ({
    file: spec.file,
    class: spec.class,
    types: spec.types,
  })),
  verification: {
    lint: 'npm run contract:lint',
    types: 'npm run contract:types',
    drift: 'npm run contract:drift',
    test: 'npm run contract:test',
    check: 'npm run contract:check',
  },
  documentation: [
    'docs/api/README.md',
    'docs/api/recommendations.md',
    'docs/api/media-state.md',
    'docs/architecture/recommendation-engine.md',
  ],
};

const manifestPath = resolve(outputDir, 'manifest.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`API docs manifest generated at ${manifestPath}`);
console.log(`  ${specs.length} OpenAPI specs`);
console.log(`  ${specs.length} TypeScript type definitions`);
console.log(`  ${manifest.documentation.length} documentation references`);
console.log(`  ${manifest.verification ? Object.keys(manifest.verification).length : 0} verification commands`);
