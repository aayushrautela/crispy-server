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
    pattern: 'registerHomeRoutes|canonical_home|homeCacheKey|refresh-home-cache|tracked-series|WatchV2TrackedQueryService|TrackedTitleRow|toTrackedTitleIdentity|syncTrackedTitleState|deleteTrackedTitleState|upsertTrackedTitleState|refreshProfileTrackedTitles|refreshProfileTrackedSeries',
    message: 'Removed home/tracked-series architecture pieces must not be reintroduced into src runtime code.',
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
