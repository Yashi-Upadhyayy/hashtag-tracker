import { randomUUID } from 'node:crypto';
import { Knex } from 'knex';
import { Endpoint, MediaSource } from '../media/model';
import { MediaRepository } from '../media/repository';
import { withLock } from '../db/lock';
import { errorCode, logger } from '../shared/logger';
import { ingestPages } from './paginate';
export class IngestionService {
  constructor(
    private readonly db: Knex,
    private readonly source: MediaSource,
    private readonly cap: number,
  ) {}
  async sync(hashtag: string, endpoint: Endpoint) {
    return withLock(this.db, `sync:${hashtag}:${endpoint}`, async () => {
      let record = await this.db('hashtags').where({ name: hashtag }).first();
      if (!record) {
        const id = await this.source.resolveHashtag(hashtag);
        await this.db('hashtags').insert({ id, name: hashtag }).onConflict('name').ignore();
        record = await this.db('hashtags').where({ name: hashtag }).first();
      }
      // Owning the lock means an earlier running attempt no longer has a live owner.
      await this.db('sync_runs')
        .where({ hashtag_id: record.id, endpoint, status: 'running' })
        .update({ status: 'interrupted', finished_at: this.db.fn.now() });
      const id = randomUUID();
      await this.db('sync_runs').insert({ id, hashtag_id: record.id, endpoint, status: 'running' });
      try {
        const repo = new MediaRepository(this.db);
        const result = await ingestPages(
          this.source,
          record.id,
          endpoint,
          this.cap,
          (items) => repo.savePage(record.id, endpoint, items),
          async (processed, pages) => {
            await this.db('sync_runs').where({ id }).update({ processed, pages });
          },
        );
        await this.db('sync_runs')
          .where({ id })
          .update({ ...result, status: 'completed', finished_at: this.db.fn.now() });
        logger.info({ runId: id, endpoint, ...result }, 'Sync completed');
        return result;
      } catch (error) {
        await this.db('sync_runs')
          .where({ id })
          .update({
            status: 'failed',
            error_code: errorCode(error),
            finished_at: this.db.fn.now(),
          });
        throw new Error(errorCode(error));
      }
    });
  }
}
