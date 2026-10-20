import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { assertInstanceDatabase } from './src/lib/instance';
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (process.env.TEST_DATABASE_URL && url !== process.env.TEST_DATABASE_URL)
  throw new Error(
    'Test configuration detected with a different migration URL. Use npm run test:db:migrate to pin both database URLs.',
  );
assertInstanceDatabase(url);
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: {
    url: url!,
  },
});
