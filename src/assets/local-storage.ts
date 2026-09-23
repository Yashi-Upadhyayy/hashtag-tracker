import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AssetStorage } from './storage';
export function validateSource(raw: string, mockOrigin?: string): URL {
  const url = new URL(raw);
  if (url.username || url.password || url.hash) throw new Error('ASSET_URL_REJECTED');
  if (mockOrigin && url.origin === new URL(mockOrigin).origin) return url;
  const allowed = ['cdninstagram.com', 'fbcdn.net'].some(
    (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
  );
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || !allowed)
    throw new Error('ASSET_URL_REJECTED');
  return url;
}
export class LocalAssetStorage implements AssetStorage {
  constructor(
    private readonly root: string,
    private readonly maxBytes: number,
    private readonly mockOrigin?: string,
  ) {}
  async transfer(sourceUrl: string, key: string) {
    if (!/^\d+-\d+$/.test(key)) throw new Error('INVALID_STORAGE_KEY');
    const url = validateSource(sourceUrl, this.mockOrigin);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.body) throw new Error(`ASSET_HTTP_${response.status}`);
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (
      ![
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'video/mp4',
        'video/quicktime',
      ].includes(contentType)
    ) {
      await response.body.cancel();
      throw new Error('ASSET_TYPE_REJECTED');
    }
    if (Number(response.headers.get('content-length')) > this.maxBytes) {
      await response.body.cancel();
      throw new Error('ASSET_TOO_LARGE');
    }
    await mkdir(this.root, { recursive: true });
    const destination = path.join(this.root, key),
      temporary = `${destination}.${randomUUID()}.tmp`;
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > maxBytes ? new Error('ASSET_TOO_LARGE') : null, chunk);
      },
    });
    const maxBytes = this.maxBytes;
    try {
      await pipeline(
        Readable.fromWeb(response.body as never),
        limiter,
        createWriteStream(temporary, { flags: 'wx' }),
      );
      await rename(temporary, destination);
      return { key, contentType, bytes };
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
