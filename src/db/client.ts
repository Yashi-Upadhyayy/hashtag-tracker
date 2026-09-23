import knex from 'knex';
import path from 'node:path';
import { config } from '../config';
export const db = knex({
  client: 'pg',
  connection: config.DATABASE_URL,
  pool: { min: 0, max: config.ASSET_CONCURRENCY * 2 + 8 },
  acquireConnectionTimeout: 15000,
  migrations: { directory: path.resolve(__dirname, '../../migrations'), loadExtensions: ['.js'] },
});
