import { describe, it, expect, vi } from 'vitest';
import { MetaClient } from '../src/meta/client';
describe('Meta boundary', () => {
  it('rebuilds pagination requests instead of following upstream next URLs', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [],
            paging: {
              next: 'https://untrusted.invalid/?access_token=secret',
              cursors: { after: 'abc' },
            },
          }),
        ),
      );
    const client = new MetaClient('https://graph.facebook.com/v24.0', '123', 'secret', fetcher);
    expect(await client.fetchPage('100', 'recent_media', 25)).toEqual({ data: [], after: 'abc' });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url.hostname).toBe('graph.facebook.com');
    expect(url.search).not.toContain('secret');
    expect(options.headers.Authorization).toBe('Bearer secret');
  });
  it('does not include upstream error bodies or tokens in failures', async () => {
    const client = new MetaClient(
      'https://graph.facebook.com/v24.0',
      '123',
      'secret',
      vi.fn().mockResolvedValue(new Response('secret upstream detail', { status: 429 })),
      25,
      0,
    );
    await expect(client.fetchPage('100', 'top_media', 25)).rejects.toThrow(/^META_RATE_LIMITED$/);
  });
  it('fails visibly if carousel expansion is incomplete', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: '1',
                media_type: 'CAROUSEL_ALBUM',
                timestamp: '2026-01-01T00:00:00Z',
                children: { data: [], paging: { next: 'https://example.com' } },
              },
            ],
          }),
        ),
      );
    await expect(
      new MetaClient('https://graph.facebook.com/v24.0', '1', 'x', fetcher).fetchPage(
        '100',
        'top_media',
        25,
      ),
    ).rejects.toThrow('CAROUSEL_CHILDREN_TRUNCATED');
  });
});

describe('live Meta request adaptation', () => {
  const smallResponse = () => new Response(JSON.stringify({ data: [] }));
  const overloaded = () => new Response(JSON.stringify({ error: {
    code: 1, message: 'Please reduce the amount of data you are asking for; secret',
  } }), { status: 500 });
  it('halves oversized pages, preserves the cursor, and remembers the smaller size', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(overloaded()).mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(smallResponse()).mockResolvedValueOnce(smallResponse());
    const client = new MetaClient('https://graph.facebook.com/v24.0', '123', 'secret', fetcher);
    await client.fetchPage('100', 'top_media', 25, 'cursor');
    await client.fetchPage('100', 'top_media', 25, 'next-cursor');
    expect(fetcher.mock.calls.map(([url]) => url.searchParams.get('limit'))).toEqual(['25','12','6','6']);
    expect(fetcher.mock.calls.slice(0,3).every(([url]) => url.searchParams.get('after') === 'cursor')).toBe(true);
    expect(fetcher.mock.calls[3]![0].searchParams.get('after')).toBe('next-cursor');
  });
  it('reduces after a timeout but stops at one item', async () => {
    const timeout = new Error('Sensitive upstream URL'); timeout.name = 'TimeoutError';
    const fetcher = vi.fn().mockRejectedValue(timeout);
    const client = new MetaClient('https://graph.facebook.com/v24.0','1','secret',fetcher,5,0);
    await expect(client.fetchPage('100','top_media',25)).rejects.toThrow(/^META_TIMEOUT$/);
    expect(fetcher.mock.calls.map(([url]) => url.searchParams.get('limit'))).toEqual([
      '5','5','5','5','2','2','2','2','1','1','1','1',
    ]);
  });
  it('retries an overload response at page size one without changing the cursor', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(overloaded()).mockResolvedValueOnce(smallResponse());
    const client = new MetaClient('https://graph.facebook.com/v24.0','1','secret',fetcher,1,0);
    await client.fetchPage('100','recent_media',1,'cursor');
    expect(fetcher.mock.calls.map(([url]) => [url.searchParams.get('limit'), url.searchParams.get('after')]))
      .toEqual([['1','cursor'],['1','cursor']]);
  });
  it('does not retry invalid credentials with smaller pages', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code:190, message:'secret' } }), { status:400 }));
    await expect(new MetaClient('https://graph.facebook.com/v24.0','1','secret',fetcher).fetchPage('100','top_media',25))
      .rejects.toThrow(/^META_INVALID_TOKEN$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('accepts Meta timestamps with compact timezone offsets', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data:[{
      id:'123',media_type:'IMAGE',timestamp:'2026-09-21T14:00:36+0000',
    }] })));
    expect((await new MetaClient('https://graph.facebook.com/v24.0','1','secret',fetcher).fetchPage('100','top_media',5)).data).toHaveLength(1);
  });
  it('retries a transient page failure using the same cursor, then continues', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('socket closed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{
        id: '123', media_type: 'IMAGE', timestamp: '2026-09-21T14:00:36+0000',
      }] })));
    const client = new MetaClient('https://graph.facebook.com/v24.0','1','secret',fetcher,5,0);
    expect((await client.fetchPage('100','recent_media',5,'cursor')).data).toHaveLength(1);
    expect(fetcher.mock.calls.map(([url]) => url.searchParams.get('after'))).toEqual(['cursor','cursor']);
  });
});
