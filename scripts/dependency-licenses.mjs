import fs from 'node:fs';
const lock = JSON.parse(fs.readFileSync('package-lock.json'));
const entries = [];
for (const p of Object.keys(lock.packages)) {
  if (!p) continue;
  try {
    const data = JSON.parse(fs.readFileSync(`${p}/package.json`));
    entries.push({
      name: data.name,
      version: data.version,
      license: data.license || data.licenses || 'UNKNOWN',
      repository:
        typeof data.repository === 'string' ? data.repository : data.repository?.url || null,
    });
  } catch {}
}
entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync(
  'docs/dependency-licenses.json',
  JSON.stringify(
    {
      note: 'npm metadata inventory, not legal clearance or a container OS/native SBOM',
      packages: entries,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    packages: entries.length,
    unknown: entries.filter((x) => x.license === 'UNKNOWN').map((x) => x.name),
  }),
);
