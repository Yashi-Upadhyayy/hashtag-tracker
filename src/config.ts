import { z } from 'zod';
const schema = z.object({
  DATABASE_URL: z.string().default('postgres://tracker:tracker@postgres:5432/tracker'),
  REDIS_URL: z.string().url().default('redis://redis:6379'),
  MODE: z.enum(['mock', 'live']).default('mock'),
  META_ACCESS_TOKEN: z.string().default(''),
  META_USER_ID: z.string().default(''),
  META_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v24.0'),
  MOCK_BASE_URL: z.string().url().default('http://mock-meta:4000'),
  STORAGE_ROOT: z.string().default('/data/assets'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  META_PAGE_SIZE: z.coerce.number().int().min(1).max(25).default(25),
  SYNC_LIMIT: z.coerce.number().int().min(1).max(500).default(500),
  ASSET_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  MAX_ASSET_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(100 * 1024 * 1024),
});
export const config = schema.parse({
  ...process.env,
  MODE: process.env.MODE === 'test' ? 'mock' : process.env.MODE,
});
export function requireMetaCredentials() {
  if (config.MODE === 'live' && (!config.META_ACCESS_TOKEN || !/^\d+$/.test(config.META_USER_ID))) {
    throw new Error('Live mode requires META_ACCESS_TOKEN and numeric META_USER_ID');
  }
}
