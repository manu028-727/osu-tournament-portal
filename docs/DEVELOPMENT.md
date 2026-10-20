# Development

Use Node 22.12+ (`.nvmrc` selects 22) and `npm ci --include=dev`. Docker production
builds pin Node 22.23.3 and install the lockfile. Read bundled Next.js documentation
before changing framework code; this release has version-specific APIs.

Initialize a separate development stack as in the README, with localhost APP_URL
and a dedicated OAuth callback. Then run:

```bash
docker compose --env-file .env.docker -f compose.docker.yaml -f compose.development.yaml up --build web
```

Source/config mounts are read-only; dependencies, Prisma generation and Next output
use separate volumes. The dev server runs as UID 1000, matching production. Only
those disposable generated volumes get a permission-initialization helper. Host
`.env` and `.data` are never mounted. Dependencies must be refreshed after lockfile
changes, without removing database/storage volumes. Container development uses
Next's supported Webpack HMR path; production builds use Turbopack.
The `development` build target includes npm and a shell; release `tools` only
provides Node/TypeScript/Prisma maintenance commands in a minimal runtime.

For host Node development, configure an isolated reachable DATABASE_URL and
APP_DATABASE_NAME, generate Prisma and use `npm run dev -- --port 3000`.
The CLI listener port must be exported/passed explicitly; an env-file PORT alone
does not configure `next dev`. IRC WebSockets need the Docker front listener.

## Tests

Create a dedicated database named `tournament_platform_test` and set
TEST_DATABASE_URL in `.env.test`. It must never be an installation database.
`test:db:setup` applies the generic baseline and explicitly creates **synthetic test
fixtures**, not default application content. It rejects other database names.

```bash
npm run db:generate
npm run test:db:setup
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:integration
npx playwright install --with-deps chromium
npm run test:e2e
npm run build
npm audit
```

Run integration/browser suites sequentially when they share a test database.
Test fixtures insert sessions only into explicitly isolated databases; there is
no production fake-login endpoint. External OAuth/API calls use fixtures where
not expressly tested with real credentials. All workbook records in tests are
synthetic; do not add real players, rosters or historical match payloads.

For real isolated S3 checks, run `scripts/test-storage.ts` with a staging S3 env.
The optional QA Compose mock and `verify-container-irc.ts` test the real gateway
transport without contacting Bancho. Never enable the QA override in production.

Formatting is Prettier; ESLint checks TypeScript correctness and unused bindings.
The standard CI also validates Prisma and Compose, runs tests and builds images.
Manual release publication is separate and requires a protected approval environment.
