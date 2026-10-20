import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import sanitize from 'sanitize-html';
import type { ArchiveData } from './tournament-archive-format';
import { AppError } from './permissions';

export async function bundleStaticAssets(data: ArchiveData, directory: string) {
  const paths = new Set<string>();
  function collectUrl(url: string | undefined) {
    if (
      url?.startsWith('/') &&
      !url.startsWith('//') &&
      !url.startsWith('/api/') &&
      /\.(?:png|jpe?g|webp|avif|svg)(?:[?#]|$)/i.test(url)
    )
      paths.add(url);
  }
  function inspect(value: unknown) {
    if (typeof value === 'string') {
      collectUrl(value);
      if (/<img[\s>]/i.test(value))
        sanitize(value, {
          allowedTags: false,
          allowedAttributes: false,
          transformTags: {
            img: (tagName, attribs) => {
              collectUrl(attribs.src);
              return { tagName, attribs };
            },
          },
        });
    } else if (Array.isArray(value)) value.forEach(inspect);
    else if (value && typeof value === 'object') Object.values(value).forEach(inspect);
  }
  inspect(data);
  if (!paths.size) return new Map<string, Buffer>();
  // Public artwork is supplied separately at runtime, not traced from the checkout.
  const root = await realpath(/* turbopackIgnore: true */ directory);
  const substitutions = new Map<string, string>(),
    bytes = new Map<string, Buffer>();
  for (const url of paths) {
    const decoded = decodeURIComponent(new URL(url, 'https://local.invalid').pathname);
    if (
      decoded.includes('\\') ||
      decoded.includes('\0') ||
      decoded.split('/').includes('..') ||
      /\.svg$/i.test(decoded)
    )
      throw new AppError(
        'Upload local SVG or unsupported artwork through the CMS before exporting.',
      );
    let file: string, original: Buffer;
    try {
      file = await realpath(/* turbopackIgnore: true */ path.resolve(root, '.' + decoded));
      if (!file.startsWith(root + path.sep)) throw new Error('Outside public directory');
      if ((await stat(file)).size > 4 * 1024 * 1024) throw new Error('Artwork too large');
      original = await readFile(file);
    } catch {
      throw new AppError(
        'A referenced local artwork file is missing, unsafe or larger than 4 MB. Restore it or upload it through the CMS before exporting.',
        409,
      );
    }
    let image;
    try {
      const source = sharp(original, { limitInputPixels: 40000000, animated: false });
      const metadata = await source.metadata();
      if (
        !['webp', 'png', 'jpeg', 'avif', 'heif'].includes(metadata.format || '') ||
        (metadata.pages || 1) > 1
      )
        throw new Error('Unsupported image');
      image =
        metadata.format === 'webp'
          ? { data: original, info: { width: metadata.width!, height: metadata.height! } }
          : await source
              .rotate()
              .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 90 })
              .toBuffer({ resolveWithObject: true });
    } catch {
      throw new AppError('Local artwork could not be decoded. Use static raster artwork.');
    }
    if (image.data.length > 4 * 1024 * 1024)
      throw new AppError('Local artwork exceeds the media limit.', 413);
    const id = randomUUID();
    bytes.set(id, image.data);
    substitutions.set(url, `/api/media/${id}`);
    data.media.push({
      id,
      tournamentId: data.tournament[0].id,
      name: path.basename(decoded),
      mimeType: 'image/webp',
      size: image.data.length,
      width: image.info.width,
      height: image.info.height,
      createdBy: null,
      createdAt: new Date().toISOString(),
      isPublic: false,
    });
    if (
      bytes.size > 1000 ||
      [...bytes.values()].reduce((sum, value) => sum + value.length, 0) > 112 * 1024 * 1024
    )
      throw new AppError('Local artwork exceeds archive limits.', 413);
  }
  function rewrite(value: unknown): unknown {
    if (typeof value === 'string') {
      if (substitutions.has(value)) return substitutions.get(value);
      if (/<img[\s>]/i.test(value))
        return sanitize(value, {
          allowedTags: false,
          allowedAttributes: false,
          transformTags: {
            img: (tagName, attribs) => ({
              tagName,
              attribs: { ...attribs, src: substitutions.get(attribs.src) || attribs.src },
            }),
          },
        });
      return value;
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
    return value;
  }
  Object.assign(data, rewrite(data));
  return bytes;
}
