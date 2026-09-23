import { Knex } from 'knex';
import { withLock } from '../db/lock';
import { errorCode } from '../shared/logger';
import { AssetStorage } from './storage';
import { JobQueue } from '../queue/port';
export class AssetService {
  constructor(
    private readonly db: Knex,
    private readonly storage: AssetStorage,
  ) {}
  async transfer(assetId: string) {
    await withLock(this.db, `asset:${assetId}`, async () => {
      const asset = await this.db('media_assets').where({ id: assetId }).first();
      if (!asset || asset.status === 'ready' || !asset.source_url) return;
      try {
        const stored = await this.storage.transfer(asset.source_url, asset.id);
        await this.db('media_assets')
          .where({ id: assetId })
          .update({
            status: 'ready',
            storage_key: stored.key,
            content_type: stored.contentType,
            byte_size: stored.bytes,
            last_error: null,
            updated_at: this.db.fn.now(),
          });
      } catch (error) {
        await this.db('media_assets')
          .where({ id: assetId })
          .update({ status: 'failed', last_error: errorCode(error), updated_at: this.db.fn.now() });
        throw new Error(errorCode(error));
      }
    });
  }
}
export async function recoverAssets(db: Knex, queue: JobQueue) {
  const assets = await db('media_assets')
    .select('id')
    .whereNotNull('source_url')
    .andWhere((builder) => {
      builder
        .where('status', 'pending')
        .orWhere((sub) =>
          sub
            .where('status', 'failed')
            .andWhere('updated_at', '<', db.raw("now() - interval '15 minutes'")),
        );
    })
    .orderBy('updated_at')
    .limit(1000);
  for (const asset of assets) await queue.enqueueAsset(asset.id);
  return assets.length;
}
