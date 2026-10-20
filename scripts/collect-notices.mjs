import fs from 'node:fs';
import path from 'node:path';
const lock = JSON.parse(fs.readFileSync('package-lock.json'));
const sections = ['Third-party notices. These are upstream notices, not the application license.'];
for (const directory of Object.keys(lock.packages)) {
  if (!directory || !fs.existsSync(directory)) continue;
  const p = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
  const files = fs
    .readdirSync(directory)
    .filter((f) => /^(?:LICEN[CS]E|COPYING|NOTICE)(?:\..*)?$/i.test(f));
  for (const nested of ['lib/LICENCES', 'lib/LICENSE', 'lib/NOTICE'])
    if (fs.existsSync(path.join(directory, nested))) files.push(nested);
  const contents = files
    .filter((f) => fs.statSync(path.join(directory, f)).isFile())
    .map((f) => fs.readFileSync(path.join(directory, f), 'utf8'));
  if (contents.length) sections.push(`\n=== ${p.name}@${p.version} ===\n` + contents.join('\n'));
}
const output = process.argv[2] || 'docs/THIRD-PARTY-NOTICES.txt';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, sections.join('\n') + '\n');
console.log(`Collected upstream notices for ${sections.length - 1} package distributions.`);
