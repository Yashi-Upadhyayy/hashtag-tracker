import { BullJobQueue, jobOptions } from '../queue/bullmq';
import { logger } from '../shared/logger';
async function main() {
  const queue = new BullJobQueue();
  try {
    await queue.sync.upsertJobScheduler(
      'matcha-recent-every-3-hours',
      { pattern: '0 */3 * * *', tz: 'UTC' },
      { name: 'sync', data: { hashtag: 'matcha', endpoint: 'recent_media' }, opts: jobOptions },
    );
    await queue.maintenance.upsertJobScheduler(
      'recover-assets',
      { every: 60000 },
      { name: 'recover', data: {}, opts: jobOptions },
    );
    await queue.enqueueSync('matcha', 'top_media');
    await queue.enqueueSync('matcha', 'recent_media');
    logger.info('Schedules registered and startup syncs enqueued');
  } finally {
    await queue.close();
  }
}
main().catch(() => {
  logger.error('Scheduler setup failed');
  process.exitCode = 1;
});
