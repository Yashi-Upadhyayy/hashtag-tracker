import { describe, it, expect, vi } from 'vitest';
import { ingestPages } from '../src/ingestion/paginate';
import { Media, MediaSource } from '../src/media/model';
import { encodeCursor, parseQuery } from '../src/api/pagination';
const item = (id: number): Media => ({
  id: String(id),
  media_type: 'IMAGE',
  timestamp: '2026-01-01T00:00:00Z',
});
describe('ingestion pagination', () => {
  it('fetches 20 pages and caps at 500 even when more pages exist', async () => {
    const fetchPage = vi.fn(async (_id, _endpoint, limit, after) => ({
      data: Array.from({ length: limit }, (_, i) => item(Number(after ?? 0) + i)),
      after: String(Number(after ?? 0) + limit),
    }));
    const save = vi.fn(async () => {});
    const result = await ingestPages(
      { fetchPage, resolveHashtag: vi.fn() },
      '1',
      'recent_media',
      500,
      save,
      async () => {},
    );
    expect(result).toEqual({ processed: 500, pages: 20, capped: true });
    expect(fetchPage).toHaveBeenCalledTimes(20);
    expect(save.mock.calls).toHaveLength(20);
  });
  it('requests only the remaining capacity and slices oversized responses', async () => {
    const fetchPage = vi.fn(async () => ({
      data: Array.from({ length: 25 }, (_, i) => item(i)),
      after: 'next',
    }));
    const save = vi.fn(async (_items: Media[]) => {});
    expect(
      (
        await ingestPages(
          { fetchPage, resolveHashtag: vi.fn() },
          '1',
          'top_media',
          3,
          save,
          async () => {},
        )
      ).processed,
    ).toBe(3);
    expect(fetchPage.mock.calls[0]?.[2]).toBe(3);
    expect(save.mock.calls[0]?.[0]).toHaveLength(3);
  });
  it('follows an empty page with a next cursor', async () => {
    const source: MediaSource = {
      resolveHashtag: vi.fn(),
      fetchPage: vi
        .fn()
        .mockResolvedValueOnce({ data: [], after: 'next' })
        .mockResolvedValueOnce({ data: [item(1)] }),
    };
    expect(
      await ingestPages(
        source,
        '1',
        'top_media',
        500,
        async () => {},
        async () => {},
      ),
    ).toEqual({ processed: 1, pages: 2, capped: false });
  });
  it('rejects repeated cursors instead of looping', async () => {
    const source: MediaSource = {
      resolveHashtag: vi.fn(),
      fetchPage: vi.fn().mockResolvedValue({ data: [], after: 'same' }),
    };
    await expect(
      ingestPages(
        source,
        '1',
        'top_media',
        500,
        async () => {},
        async () => {},
      ),
    ).rejects.toThrow('META_PAGINATION_LOOP');
  });
  it('stops on a failed page and preserves prior save calls', async () => {
    const source: MediaSource = {
      resolveHashtag: vi.fn(),
      fetchPage: vi
        .fn()
        .mockResolvedValueOnce({ data: [item(1)], after: 'next' })
        .mockRejectedValueOnce(new Error('META_HTTP_503')),
    };
    const save = vi.fn(async () => {});
    await expect(
      ingestPages(source, '1', 'recent_media', 500, save, async () => {}),
    ).rejects.toThrow('META_HTTP_503');
    expect(save).toHaveBeenCalledTimes(1);
  });
});
describe('API cursor validation', () => {
  it('round trips tied timestamps with a stable string ID', () => {
    const cursor = encodeCursor('2026-01-01T00:00:00.000Z', '17841480695597364', 'matcha');
    expect(parseQuery({ cursor }).cursor?.id).toBe('17841480695597364');
  });
  it.each([
    { limit: '0' },
    { limit: '101' },
    { limit: '2.5' },
    { cursor: 'garbage' },
    { limit: ['1', '2'] },
  ])('rejects invalid query %j', (query) => {
    expect(() => parseQuery(query)).toThrow();
  });
  it('rejects a cursor for another hashtag', () => {
    expect(() =>
      parseQuery({ cursor: encodeCursor('2026-01-01T00:00:00Z', '1', 'coffee') }),
    ).toThrow();
  });
});

it('can reach 500 items with one-item pages after adaptive reduction', async () => {
  const fetchPage = vi.fn(async (_id, _endpoint, _limit, after) => ({
    data: [item(Number(after ?? 0))], after: String(Number(after ?? 0) + 1),
  }));
  expect(await ingestPages({ fetchPage, resolveHashtag: vi.fn() }, '1', 'recent_media', 500,
    async () => {}, async () => {})).toEqual({ processed: 500, pages: 500, capped: true });
});

it('allows a repeated cursor when the upstream page still contains new media', async () => {
  const fetchPage = vi.fn()
    .mockResolvedValueOnce({ data: [item(1)], after: 'same' })
    .mockResolvedValueOnce({ data: [item(2)], after: 'same' })
    .mockResolvedValueOnce({ data: [item(3)] });
  expect(await ingestPages({ fetchPage, resolveHashtag: vi.fn() }, '1', 'top_media', 500,
    async () => {}, async () => {})).toEqual({ processed: 3, pages: 3, capped: false });
});

it('rejects repeated cursors with previously seen media before reaching the cap', async () => {
  const fetchPage = vi.fn().mockResolvedValue({ data: [item(1)], after: 'same' });
  await expect(ingestPages({ fetchPage, resolveHashtag: vi.fn() }, '1', 'top_media', 500,
    async () => {}, async () => {})).rejects.toThrow('META_PAGINATION_LOOP');
  expect(fetchPage).toHaveBeenCalledTimes(2);
});
