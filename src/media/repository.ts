import { Knex } from 'knex';
import { assetsOf, Endpoint, Media } from './model';
export class MediaRepository {
  constructor(private readonly db: Knex) {}
  async savePage(hashtagId: string, endpoint: Endpoint, items: Media[]) {
    await this.db.transaction(async (tx) => {
      // Sorting locks consistently also avoids deadlocks between top and recent jobs.
      const unique = [...new Map(items.map((m) => [m.id, m])).values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      for (const m of unique) {
        const mutable = {
          caption: m.caption ?? null,
          media_type: m.media_type,
          permalink: m.permalink ?? null,
          posted_at: m.timestamp,
          like_count: m.like_count ?? null,
          comments_count: m.comments_count ?? null,
          updated_at: tx.fn.now(),
        };
        await tx('media')
          .insert({ id: m.id, ...mutable })
          .onConflict('id')
          .merge(mutable);
        const seen = endpoint === 'top_media' ? 'seen_top' : 'seen_recent';
        await tx('hashtag_media')
          .insert({ hashtag_id: hashtagId, media_id: m.id, [seen]: true })
          .onConflict(['hashtag_id', 'media_id'])
          .merge({ [seen]: true, last_seen_at: tx.fn.now() });
        for (const asset of assetsOf(m)) {
          await tx('media_assets')
            .insert(asset)
            .onConflict('id')
            .merge({
              source_url: asset.source_url,
              media_type: asset.media_type,
              status: tx.raw("CASE WHEN media_assets.status = 'ready' THEN 'ready' ELSE ? END", [
                asset.status,
              ]),
            });
        }
      }
    });
  }
}
