import { z } from 'zod';
import { MediaSource, Endpoint, mediaSchema } from '../media/model';
const pageSchema = z.object({
  data: z.array(mediaSchema),
  paging: z
    .object({
      next: z.string().optional(),
      cursors: z.object({ after: z.string().optional() }).optional(),
    })
    .optional(),
});
export class MetaClient implements MediaSource {
  constructor(
    private readonly baseUrl: string,
    private readonly userId: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
    private pageSize = 25,
    private readonly retryDelayMs = 1000,
  ) {}
  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/${path}`);
    url.search = new URLSearchParams({ ...params, user_id: this.userId }).toString();
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new Error('META_TIMEOUT');
      throw new Error('META_NETWORK_ERROR');
    }
    if (!response.ok) {
      // Inspect only to classify the failure; never expose upstream text or URLs.
      const body = await response.json().catch(() => ({})) as {
        error?: { code?: number; message?: string };
      };
      const code = body.error?.code;
      if (code === 190) throw new Error('META_INVALID_TOKEN');
      if (response.status === 429 || [4, 17, 32, 613].includes(code ?? -1))
        throw new Error('META_RATE_LIMITED');
      if (code === 1 && /reduce the amount of data/i.test(body.error?.message ?? ''))
        throw new Error('META_REDUCE_PAGE_SIZE');
      throw new Error(`META_HTTP_${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error('META_NETWORK_ERROR');
    }
  }
  async resolveHashtag(name: string): Promise<string> {
    const result = z
      .object({ data: z.array(z.object({ id: z.string().regex(/^\d+$/) })) })
      .parse(await this.get('ig_hashtag_search', { q: name }));
    if (!result.data[0]) throw new Error('HASHTAG_NOT_FOUND');
    return result.data[0].id;
  }
  async fetchPage(id: string, endpoint: Endpoint, limit: number, after?: string) {
    if (!/^\d+$/.test(id)) throw new Error('INVALID_HASHTAG_ID');
    let requested = Math.min(limit, this.pageSize);
    let raw: unknown;
    let transientFailures = 0;
    for (;;) {
      try {
        raw = await this.get(`${id}/${endpoint}`, {
          fields:
            'id,media_type,timestamp,permalink,media_url,caption,like_count,comments_count,children{id,media_type,media_url}',
          limit: String(requested),
          ...(after ? { after } : {}),
        });
        break;
      } catch (error) {
        const code = error instanceof Error ? error.message : 'META_NETWORK_ERROR';
        const transient = ['META_NETWORK_ERROR', 'META_TIMEOUT', 'META_RATE_LIMITED',
          'META_HTTP_500', 'META_HTTP_502', 'META_HTTP_503', 'META_HTTP_504'].includes(code);
        // Meta sometimes asks to reduce a page that already contains one item.
        // There is no smaller valid request, so retry that same cursor briefly.
        if ((transient || (code === 'META_REDUCE_PAGE_SIZE' && requested === 1)) && transientFailures < 3) {
          const delay = code === 'META_RATE_LIMITED' ? this.retryDelayMs * 30 : this.retryDelayMs * 2 ** transientFailures;
          transientFailures++;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        const reducible = error instanceof Error &&
          ['META_REDUCE_PAGE_SIZE', 'META_TIMEOUT'].includes(error.message);
        if (!reducible || requested <= 1) throw error;
        requested = Math.max(1, Math.floor(requested / 2));
        this.pageSize = requested;
        transientFailures = 0;
      }
    }
    const result = pageSchema.parse(raw);
    if (result.data.some((m) => m.children?.paging?.next))
      throw new Error('CAROUSEL_CHILDREN_TRUNCATED');
    const next = result.paging?.next ? result.paging.cursors?.after : undefined;
    if (result.paging?.next && !next) throw new Error('META_MISSING_CURSOR');
    return { data: result.data, after: next };
  }
}
