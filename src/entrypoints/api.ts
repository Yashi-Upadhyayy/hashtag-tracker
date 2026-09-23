import { config } from '../config';
import { db } from '../db/client';
import { createApp } from '../api/app';
import { logger } from '../shared/logger';
const server = createApp(db, config.STORAGE_ROOT).listen(config.PORT, () =>
  logger.info({ port: config.PORT }, 'API listening'),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    server.close(() => {
      void db.destroy();
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
