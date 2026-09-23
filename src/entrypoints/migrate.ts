import { db } from '../db/client';
import { logger } from '../shared/logger';
async function main() {
  try {
    await db.migrate.latest();
    logger.info('Migrations complete');
  } finally {
    await db.destroy();
  }
}
main().catch(() => {
  logger.error('Migration failed');
  process.exitCode = 1;
});
