import { describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  MAX_ARCHIVE_BYTES,
  tableNames,
  tokens,
  readArchive,
  writeArchive,
  archiveHash,
  checkJson,
  type ArchiveData,
  type ArchiveRow,
  type ArchiveManifest,
} from '../src/lib/tournament-archive-format';

function fixture() {
  const data = Object.fromEntries(tableNames.map((table) => [table, []])) as unknown as ArchiveData;
  function row(table: 'tournament' | 'settings'): ArchiveRow {
    return Object.fromEntries(
      tokens(table).map((token) => [
        token.name,
        token.nullable
          ? null
          : token.type === 'b'
            ? false
            : token.type === 'i'
              ? 1
              : token.type === 'd'
                ? new Date(0).toISOString()
                : token.type === 'j'
                  ? {}
                  : 'sample',
      ]),
    );
  }
  data.tournament.push({ ...row('tournament'), id: 'tournament_1', primaryColor: undefined });
  delete data.tournament[0].primaryColor;
  data.settings.push({
    ...row('settings'),
    tournamentId: 'tournament_1',
    primaryColor: '#cc6699',
    accentColor: '#88ccaa',
    logo: '',
    favicon: '',
    banner: '',
    registrationUrl: '',
  });
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: new Date(0).toISOString(),
    source: 'portal',
    sourceOrigin: 'https://source.example',
    sourceSlug: 'sample',
    data: { path: 'tournament.json', sha256: archiveHash(Buffer.from(JSON.stringify(data))) },
    media: [],
    warnings: [],
  };
  return { data, manifest };
}
async function zip(entries: { name: string; bytes?: Buffer; mode?: number }[]) {
  const archive = new ZipFile(),
    chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    archive.outputStream.on('data', (chunk) => chunks.push(chunk));
    archive.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
  });
  for (const entry of entries)
    archive.addBuffer(entry.bytes || Buffer.from('x'), entry.name, { mode: entry.mode });
  archive.end();
  return done;
}
describe('bounded portable ZIP format', () => {
  it('reads a valid versioned archive and verifies its data checksum', async () => {
    const { data, manifest } = fixture();
    const bytes = await writeArchive(manifest, data, new Map());
    const parsed = await readArchive(bytes);
    expect(parsed.data).toEqual(data);
    expect(parsed.fingerprint).toBe(archiveHash(bytes));
  });
  it('rejects unknown archive paths and duplicate entries', async () => {
    await expect(readArchive(await zip([{ name: 'unexpected.txt' }]))).rejects.toThrow(/paths/);
    await expect(
      readArchive(await zip([{ name: 'manifest.json' }, { name: 'manifest.json' }])),
    ).rejects.toThrow(/paths/);
  });
  it('rejects traversal names in both local and central ZIP headers', async () => {
    const bytes = await zip([{ name: 'payload.bin' }]);
    for (
      let index = bytes.indexOf('payload.bin');
      index >= 0;
      index = bytes.indexOf('payload.bin', index + 11)
    )
      Buffer.from('../evil.txt').copy(bytes, index);
    await expect(readArchive(bytes)).rejects.toThrow();
  });
  it('rejects symlink entries instead of extracting them', async () => {
    await expect(
      readArchive(await zip([{ name: 'media/link.webp', mode: 0o120777 }])),
    ).rejects.toThrow(/paths/);
  });
  it('rejects oversized expanded media before decoding', async () => {
    await expect(
      readArchive(
        await zip([{ name: 'media/bomb.webp', bytes: Buffer.alloc(4 * 1024 * 1024 + 1) }]),
      ),
    ).rejects.toThrow(/sizes/);
  });
  it('rejects oversized compressed input and truncated ZIPs', async () => {
    await expect(readArchive(Buffer.alloc(MAX_ARCHIVE_BYTES + 1))).rejects.toMatchObject({
      status: 413,
    });
    await expect(readArchive(Buffer.from('PK broken'))).rejects.toThrow(/valid/);
  });
  it('rejects tampered structured JSON and undeclared files', async () => {
    const { data, manifest } = fixture();
    data.tournament[0].name = 'tampered';
    await expect(readArchive(await writeArchive(manifest, data, new Map()))).rejects.toThrow(
      /checksum/,
    );
    const original = fixture();
    await expect(
      readArchive(
        await writeArchive(
          original.manifest,
          original.data,
          new Map([['media/unlisted.webp', Buffer.from('x')]]),
        ),
      ),
    ).rejects.toThrow(/undeclared/);
  });
  it('rejects secret/prototype keys, unsafe URLs and excessive JSON nesting', () => {
    expect(() => checkJson(JSON.parse('{"__proto__":{"admin":true}}'))).toThrow(/forbidden/);
    for (const key of ['client_secret', 'access_token', 'irc-password', 'cookie', 'authorization'])
      expect(() => checkJson({ [key]: 'redacted' })).toThrow(/forbidden/);
    expect(() => checkJson({ customImage: 'javascript:alert(1)' })).toThrow(/Unsafe URL/);
    let nested: unknown = 'x';
    for (let index = 0; index < 70; index++) nested = { child: nested };
    expect(() => checkJson(nested)).toThrow(/deeply/);
  });
});
