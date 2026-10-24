import { recoverMediaCleanup } from '../src/lib/media-cleanup';
import { db } from '../src/lib/db';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--apply' && !/^--limit=\d+$/.test(arg)))
  throw new Error(
    'Use --apply to remove journaled objects, and optionally --limit=1..200. Preview is the default.',
  );
try {
  console.log(
    JSON.stringify(
      await recoverMediaCleanup({
        apply: args.includes('--apply'),
        limit: Number(args.find((arg) => arg.startsWith('--limit='))?.slice(8) || 50),
      }),
      null,
      2,
    ),
  );
} finally {
  await db.$disconnect();
}
