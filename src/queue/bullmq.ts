import { Queue, JobsOptions } from 'bullmq';
import { config } from '../config';
import { Endpoint } from '../media/model';
import { JobQueue } from './port';
const redis = new URL(config.REDIS_URL);
export const connection = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  username: redis.username || undefined,
  password: redis.password || undefined,
  ...(redis.protocol === 'rediss:' ? { tls: {} } : {}),
  maxRetriesPerRequest: null,
};
export const jobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 100 },
};
export class BullJobQueue implements JobQueue {
  readonly sync = new Queue('hashtag-sync', { connection, defaultJobOptions: jobOptions });
  readonly assets = new Queue('media-assets', { connection, defaultJobOptions: jobOptions });
  readonly maintenance = new Queue('maintenance', { connection, defaultJobOptions: jobOptions });
  async enqueueSync(hashtag: string, endpoint: Endpoint) {
    await this.sync.add(
      'sync',
      { hashtag, endpoint },
      { deduplication: { id: `${hashtag}-${endpoint}` } },
    );
  }
  async enqueueAsset(assetId: string) {
    await this.assets.add(
      'transfer',
      { assetId },
      { jobId: assetId, removeOnComplete: true, removeOnFail: true },
    );
  }
  async close() {
    await Promise.all([this.sync, this.assets, this.maintenance].map(async queue => {
      // BullMQ starts connections lazily; closing an unused queue mid-initialization can race.
      await queue.waitUntilReady();
      await queue.close();
    }));
  }
}
