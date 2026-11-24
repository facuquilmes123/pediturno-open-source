export class RequestBodyTooLarge extends Error {}

/** Bound streamed bodies as well as requests that declare Content-Length. */
export async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > maxBytes) throw new RequestBodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing JSON');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new RequestBodyTooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
}
