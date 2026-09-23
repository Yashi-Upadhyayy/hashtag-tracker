import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalAssetStorage, validateSource } from '../src/assets/local-storage';
let server: Server, root: string, origin: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'hashtag-storage-'));
  server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/good' });
      res.end();
      return;
    }
    res.setHeader('content-type', req.url === '/html' ? 'text/html' : 'image/png');
    if (req.url === '/large') {
      res.write(Buffer.alloc(6));
      res.end(Buffer.alloc(6));
    } else res.end('image');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('NO_ADDRESS');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await rm(root, { recursive: true, force: true });
});
describe('local storage', () => {
  it('retries overwrite the deterministic destination without duplicate files', async () => {
    const storage = new LocalAssetStorage(root, 10, origin);
    await storage.transfer(`${origin}/good`, '1-1');
    await storage.transfer(`${origin}/good`, '1-1');
    expect(await readFile(path.join(root, '1-1'), 'utf8')).toBe('image');
    expect(await readdir(root)).toEqual(['1-1']);
  });
  it('limits streamed bytes and removes temporary files', async () => {
    await expect(
      new LocalAssetStorage(root, 10, origin).transfer(`${origin}/large`, '2-2'),
    ).rejects.toThrow('ASSET_TOO_LARGE');
    expect((await readdir(root)).some((f) => f.startsWith('2-2'))).toBe(false);
  });
  it('rejects redirects and HTML', async () => {
    const storage = new LocalAssetStorage(root, 10, origin);
    await expect(storage.transfer(`${origin}/redirect`, '3-3')).rejects.toThrow();
    await expect(storage.transfer(`${origin}/html`, '3-3')).rejects.toThrow('ASSET_TYPE_REJECTED');
  });
  it.each([
    'http://127.0.0.1/a',
    'https://cdninstagram.com.attacker.example/a',
    'https://example.com/a',
    'file:///etc/passwd',
  ])('rejects unsafe source %s', (url) => {
    expect(() => validateSource(url)).toThrow();
  });
  it('accepts a Meta CDN subdomain', () => {
    expect(validateSource('https://scontent.cdninstagram.com/a').protocol).toBe('https:');
  });
});
