# Testing

Crispy Server uses the Node built-in test runner (`node:test`) with `tsx` as the
TypeScript loader. There are two suites, split by file naming so that each one
can be run on its own.

## Commands

| Command | Scope | External services |
| --- | --- | --- |
| `npm test` | `src/**/*.test.ts` — unit, service and route tests | none |
| `npm run test:integration` | `src/**/*.integration.ts` — database-backed tests | Postgres (see below) |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `scripts/` | none |
| `npm run build` | `tsc` emit to `dist/` | none |

`npm test` is the gate that must exit `0`. It never touches Postgres, Redis or
any other network service: every test that would need one injects a fake or
stub instead.

`npm run test:integration` is **not** part of the default gate. It requires a
reachable Postgres instance with the schema from `migrations/` applied, because
those tests exercise real SQL against real tables.

## File naming convention

- `*.test.ts` — hermetic tests. Included in `npm test`.
- `*.integration.ts` — tests that need a live Postgres. Included only in
  `npm run test:integration`.

Node's test runner has no "exclude this file" flag, and a negated glob does not
exclude anything, so the split is expressed through the file name itself rather
than through a glob exclusion. TypeScript still type-checks and compiles
`*.integration.ts` files, because `tsconfig.json` includes all of `src/**/*.ts`.

## Quarantined tests

Every test that is excluded from `npm test` is listed here with the reason it
needs a live dependency. Adding a new quarantined file requires adding a row to
this table.

| File | Tests | Why it is quarantined | How to run it |
| --- | --- | --- | --- |
| `src/modules/home/repos/home-lists.repo.integration.ts` | `listDefaultTemplates returns all active templates ordered by rank`, `stampDefaultTemplatesRefreshed records the shared snapshot build time`, `setDefaultTemplateShowWithReco flips the reco blending flag`, `delete removes a default template by listKey` | Writes to and reads from the `home.default_list_templates` table, so it needs a live Postgres with the `migrations/` schema applied. The repository SQL itself is covered by unit tests elsewhere. | `npm run test:integration` with `DATABASE_URL` pointing at a migrated database |

Before a test is moved out of `npm test`, check that it is genuinely testing
persistence against a live database. A test that only needs a stub should be
converted into a hermetic test and stay in `npm test`.
