import { spawn, spawnSync } from 'node:child_process';
const generation = spawnSync('node', ['node_modules/prisma/build/index.js', 'generate'], {
  stdio: 'inherit',
});
if (generation.status !== 0) process.exit(generation.status || 1);
const child = spawn('node', ['scripts/serve-container.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, CONTAINER_DEVELOPMENT: 'true' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code || 0));
