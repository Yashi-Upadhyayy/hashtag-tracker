import { BullJobQueue } from '../queue/bullmq';
import { endpointSchema } from '../media/model';
import { logger } from '../shared/logger';
async function main() {
  const endpoint = endpointSchema.parse(process.argv[2] ?? 'recent_media');
  const queue = new BullJobQueue();
  try {
    await queue.enqueueSync('matcha', endpoint);
    logger.info({ endpoint }, 'Sync enqueued');
  } finally {
    await queue.close();
  }
}
main().catch(() => {
  logger.error('Sync enqueue failed');
  process.exitCode = 1;
});
