import sharp from 'sharp';
import { AppError } from './permissions';
import { multipartBody } from './request-body';
export async function imageUpload(request: Request) {
  const max = 4 * 1024 * 1024;
  const form = await multipartBody(request, max + 100000, 'Maximum upload size is 4 MB.');
  const file = form.get('file');
  if (
    !(file instanceof File) ||
    file.size > max ||
    !['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(file.type)
  )
    throw new AppError('Choose a PNG, JPEG, WebP or AVIF image up to 4 MB.');
  const image = sharp(Buffer.from(await file.arrayBuffer()), {
    limitInputPixels: 40000000,
    animated: false,
  });
  let metadata;
  try {
    metadata = await image.metadata();
  } catch {
    throw new AppError('The image could not be decoded.');
  }
  if (
    !['png', 'jpeg', 'webp', 'avif', 'heif'].includes(metadata.format || '') ||
    (metadata.pages || 1) > 1
  )
    throw new AppError('Use a static PNG, JPEG, WebP or AVIF image.');
  const result = await image
    .rotate()
    .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  if (result.data.length > max) throw new AppError('The optimized image exceeds 4 MB.', 413);
  return { ...result, name: file.name.slice(0, 200) };
}
