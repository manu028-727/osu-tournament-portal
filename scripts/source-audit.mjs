import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const skip = new Set([
  '.git',
  '.data',
  '.next',
  '.next-profiles',
  'node_modules',
  'src/generated',
  'test-results',
  'playwright-report',
  'coverage',
  'next-env.d.ts',
  'tsconfig.tsbuildinfo',
]);
const privateFile = (p) =>
  /(^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:dump|backup|pem|key|p12|pfx|log|pid|xlsx|xlsm|xls|csv|zip|tar|tgz|gz))$/.test(
    p,
  ) && !p.endsWith('.example');
const files = [];
const privateDirectory = (p) => /^(?:data|imports|backups|uploads)(?:\/|$)/.test(p);
function walk(dir = '') {
  for (const f of fs.readdirSync(dir || '.', { withFileTypes: true })) {
    const p = path.posix.join(dir, f.name);
    if (skip.has(p) || skip.has(f.name) || privateDirectory(p) || privateFile(p)) continue;
    if (f.isSymbolicLink()) throw new Error(`Source symlink requires review: ${p}`);
    if (f.isDirectory()) walk(p);
    else if (f.isFile()) files.push(p);
  }
}
if (process.argv.includes('--tracked'))
  files.push(...execFileSync('git', ['ls-files', '-z']).toString().split('\0').filter(Boolean));
else walk();
const denyIndex = process.argv.indexOf('--denylist');
const patterns =
  denyIndex >= 0
    ? JSON.parse(fs.readFileSync(process.argv[denyIndex + 1], 'utf8')).map(
        (s) => new RegExp(s, 'i'),
      )
    : [];
const issues = [];
for (const p of files) {
  if (
    privateFile(p) ||
    p.startsWith('src/generated/') ||
    /^(?:\.data|data|imports|backups|uploads)\//.test(p)
  )
    issues.push(`${p}: private/generated file`);
  const body = fs.readFileSync(p);
  if (!body.includes(0)) {
    const text = body.toString();
    if (patterns.some((r) => r.test(text))) issues.push(`${p}: instance-specific content`);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
      issues.push(`${p}: private key`);
    if (/\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/.test(text))
      issues.push(`${p}: private infrastructure address`);
  }
}
const outIndex = process.argv.indexOf('--export');
if (outIndex >= 0) {
  const destination = path.resolve(process.argv[outIndex + 1]);
  if (!destination.startsWith(path.resolve('.data') + path.sep))
    throw new Error('Export only into ignored .data.');
  if (fs.existsSync(destination))
    throw new Error('Export target exists; use a new audit snapshot.');
  for (const p of files) {
    const target = path.join(destination, p);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(p, target);
  }
}
const summary = {
  files: files.length,
  issues,
  sha256: createHash('sha256')
    .update(
      files
        .sort()
        .map((p) => p + ':' + createHash('sha256').update(fs.readFileSync(p)).digest('hex'))
        .join('\n'),
    )
    .digest('hex'),
};
console.log(JSON.stringify(summary, null, 2));
if (issues.length) process.exitCode = 1;
