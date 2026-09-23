import { Worker } from 'bullmq';
import { z } from 'zod';
import { config, requireMetaCredentials } from '../config';
import { db } from '../db/client';
import { MetaClient } from '../meta/client';
import { IngestionService } from '../ingestion/service';
import { AssetService, recoverAssets } from '../assets/service';
import { LocalAssetStorage } from '../assets/local-storage';
import { BullJobQueue, connection } from '../queue/bullmq';
import { endpointSchema } from '../media/model';
import { logger, errorCode } from '../shared/logger';
requireMetaCredentials();
const queue = new BullJobQueue();
const source = new MetaClient(
  config.MODE === 'mock'
    ? `${config.MOCK_BASE_URL}/v24.0`
    : `https://graph.facebook.com/${config.META_API_VERSION}`,
  config.META_USER_ID,
  config.META_ACCESS_TOKEN,
  fetch,
  config.META_PAGE_SIZE,
);
const ingestion = new IngestionService(db, source, config.SYNC_LIMIT);
const assets = new AssetService(
  db,
  new LocalAssetStorage(
    config.STORAGE_ROOT,
    config.MAX_ASSET_BYTES,
    config.MODE === 'mock' ? config.MOCK_BASE_URL : undefined,
  ),
);
const syncSchema = z.object({
  hashtag: z.string().regex(/^[a-zA-Z0-9_]{1,100}$/),
  endpoint: endpointSchema,
});
const workers = [
  new Worker(
    'hashtag-sync',
    async (job) => {
      const data = syncSchema.parse(job.data);
      await ingestion.sync(data.hashtag, data.endpoint);
      await recoverAssets(db, queue);
    },
    { connection, concurrency: 1, limiter: { max: 2, duration: 1000 } },
  ),
  new Worker(
    'media-assets',
    async (job) => {
      const data = z.object({ assetId: z.string().regex(/^\d+-\d+$/) }).parse(job.data);
      await assets.transfer(data.assetId);
    },
    { connection, concurrency: config.ASSET_CONCURRENCY },
  ),
  new Worker('maintenance', async () => recoverAssets(db, queue), { connection, concurrency: 1 }),
];
for (const worker of workers) {
  worker.on('failed', (job, error) =>
    logger.error({ queue: worker.name, jobId: job?.id, code: errorCode(error) }, 'Job failed'),
  );
  worker.on('error', (error) =>
    logger.error({ queue: worker.name, code: errorCode(error) }, 'Worker error'),
  );
}
logger.info({ mode: config.MODE }, 'Workers started');
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    void Promise.all(workers.map((w) => w.close()))
      .then(() => queue.close())
      .then(() => db.destroy())
      .catch(() => {
        process.exitCode = 1;
      });
  });
