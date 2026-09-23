import { Endpoint, Media, MediaSource } from '../media/model';
export async function ingestPages(
  source: MediaSource,
  hashtagId: string,
  endpoint: Endpoint,
  cap: number,
  save: (items: Media[]) => Promise<void>,
  progress: (count: number, pages: number) => Promise<void>,
) {
  if (!Number.isInteger(cap) || cap < 1 || cap > 500) throw new Error('INVALID_SYNC_CAP');
  let processed = 0,
    pages = 0,
    after: string | undefined;
  const cursors = new Set<string>();
  const mediaIds = new Set<string>();
  do {
    const page = await source.fetchPage(hashtagId, endpoint, Math.min(25, cap - processed), after);
    const items = page.data.slice(0, cap - processed);
    const hasNewMedia = items.some(item => !mediaIds.has(item.id));
    for (const item of items) mediaIds.add(item.id);
    await save(items);
    processed += items.length;
    pages++;
    await progress(processed, pages);
    if (processed >= cap) return { processed, pages, capped: true };
    if (!page.after) return { processed, pages, capped: false };
    if ((cursors.has(page.after) && !hasNewMedia) || pages >= cap + 100) throw new Error('META_PAGINATION_LOOP');
    cursors.add(page.after);
    after = page.after;
  } while (true);
}
