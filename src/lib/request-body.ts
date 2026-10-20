import { AppError } from './permissions';

export async function multipartBody(request: Request, maxBytes: number, tooLarge: string) {
  const contentType = request.headers.get('content-type') || '';
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType))
    throw new AppError('Expected a multipart file upload.', 415);
  if (Number(request.headers.get('content-length') || 0) > maxBytes)
    throw new AppError(tooLarge, 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('Choose a file.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError(tooLarge, 413);
    }
    chunks.push(value);
  }
  try {
    return await new Response(Buffer.concat(chunks), {
      headers: { 'Content-Type': contentType },
    }).formData();
  } catch {
    throw new AppError('The file upload is malformed. Choose the file and try again.');
  }
}
