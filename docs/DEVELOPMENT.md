# Development

The app uses Next.js App Router, React, TypeScript, Tailwind, TipTap and Prisma.
Use Node 22.12+ (`.nvmrc` selects 22) and `npm ci`. Read the bundled Next.js guides
before changing framework code; this version has API differences.

## Docker Development

Use a separate checkout/configuration with a unique STACK_NAME, local APP_URL and
OAuth callback. Initialize it with `./portal install`, then:

```bash
./portal compose -f compose.yaml -f compose.dev.yaml up --build web
```

The `development` target includes npm and a shell, runs as UID 1000 and supports
Webpack hot reload. Source mounts are read-only; dependencies, generated Prisma
code and Next output use separate development volumes. Host `.env`/`.data` are not
mounted. Refresh only development-generated/dependency volumes after relevant
changes; never delete database or storage volumes. Production uses standalone Next
and separate minimal runtime images.

For host development, configure a reachable isolated DATABASE_URL and matching
APP_DATABASE_NAME in `.env`, generate Prisma and run `npm run dev -- --port 3000`.
IRC WebSockets use the Docker front listener. Do not point test commands at an
installation database.

## Tests

Create a database named `tournament_platform_test` and set TEST_DATABASE_URL in
`.env.test`. Setup rejects other names and creates only synthetic test fixtures.

```bash
npm run db:generate
npm run test:db:setup
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npx playwright install --with-deps chromium
npm run test:e2e
npm run build
```

Run integration/browser suites sequentially when they share a database. Session
fixtures exist only in tests; there is no web fake-login endpoint. Use synthetic
profiles/workbooks, never real registration data or captured private match payloads.

Optional end-to-end infrastructure checks live in `tests/smoke/`: fresh onboarding,
S3, media migration, upload authorization and the mock Bancho gateway. They need
explicit isolated environments; guarded scripts reject installation databases.
The QA override is `deploy/compose.qa.yaml`, combined with root `compose.yaml`.
Never enable it against real Bancho. For example, with a staging S3 env:

```bash
node --env-file=.env.staging --import tsx tests/smoke/storage.ts
```

CI runs formatting, lint, types, Prisma, tests, builds, Docker installation and
security scans. Container publication is a separate manually approved workflow.
Generate third-party notices with `npm run licenses`; generated reports belong in
ignored `.data`, not in the source tree.
