import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import knex, { Knex } from 'knex';
import request from 'supertest';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { up, down } from '../migrations/001_initial';
import { MediaRepository } from '../src/media/repository';
import { IngestionService } from '../src/ingestion/service';
import { AssetService, recoverAssets } from '../src/assets/service';
import { createApp } from '../src/api/app';
import { withLock } from '../src/db/lock';
import { Media } from '../src/media/model';
let db: Knex;
const media = (id: string): Media => ({
  id,
  media_type: 'IMAGE',
  caption: 'matcha',
  timestamp: '2026-01-01T00:00:00.000Z',
  media_url: 'https://scontent.cdninstagram.com/a.png',
});
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error('TEST_DATABASE_URL must point to a disposable database ending in _test');
  const url = new URL(process.env.TEST_DATABASE_URL),
    name = url.pathname.slice(1);
  if (!/^[a-z_]+_test$/.test(name)) throw new Error('Refusing to modify a non-test database');
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = knex({ client: 'pg', connection: adminUrl.toString() });
  try {
    if (!(await admin.raw('SELECT 1 FROM pg_database WHERE datname = ?', [name])).rows.length)
      await admin.raw(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.destroy();
  }
  db = knex({ client: 'pg', connection: url.toString(), pool: { min: 0, max: 10 } });
  await db.migrate.latest({
    migrationSource: {
      getMigrations: async () => ['001_initial'],
      getMigrationName: (name: string) => name,
      getMigration: async () => ({ up, down }),
    },
  });
}, 30000);
beforeEach(async () => {
  for (const table of ['sync_runs', 'media_assets', 'hashtag_media', 'media', 'hashtags'])
    await db(table).delete();
  await db('hashtags').insert({ id: '100', name: 'matcha' });
});
afterAll(async () => {
  await db?.destroy();
});
describe('Postgres integration', () => {
  it('deduplicates repeated and overlapping endpoints while updating counts', async () => {
    const repo = new MediaRepository(db);
    await Promise.all([
      repo.savePage('100', 'top_media', [media('1'), media('1')]),
      repo.savePage('100', 'recent_media', [media('1')]),
    ]);
    await repo.savePage('100', 'top_media', [{ ...media('1'), like_count: 99 }]);
    expect(await db('media')).toHaveLength(1);
    expect(await db('media_assets')).toHaveLength(1);
    expect(await db('hashtag_media').first()).toMatchObject({ seen_top: true, seen_recent: true });
    expect((await db('media').first()).like_count).toBe('99');
  });
  it('recovers a failed second page without duplicating the first page', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [media('1')], after: 'next' })
      .mockRejectedValueOnce(new Error('META_HTTP_503'))
      .mockResolvedValueOnce({ data: [media('1')], after: 'next' })
      .mockResolvedValueOnce({ data: [media('2')] });
    const service = new IngestionService(db, { resolveHashtag: vi.fn(), fetchPage }, 500);
    await expect(service.sync('matcha', 'recent_media')).rejects.toThrow('META_HTTP_503');
    expect(await db('media')).toHaveLength(1);
    await service.sync('matcha', 'recent_media');
    expect(await db('media')).toHaveLength(2);
    expect((await db('sync_runs').where('status', 'completed').first()).processed).toBe(2);
  });
  it('reconciles unsent asset jobs and retries a failed transfer independently', async () => {
    await new MediaRepository(db).savePage('100', 'top_media', [media('1')]);
    const queue = { enqueueAsset: vi.fn(async () => {}), enqueueSync: vi.fn(), close: vi.fn() };
    expect(await recoverAssets(db, queue)).toBe(1);
    expect(queue.enqueueAsset).toHaveBeenCalledWith('1-1');
    const transfer = vi
      .fn()
      .mockRejectedValueOnce(new Error('ASSET_HTTP_503'))
      .mockResolvedValue({ key: '1-1', bytes: 5, contentType: 'image/png' });
    const service = new AssetService(db, { transfer });
    await expect(service.transfer('1-1')).rejects.toThrow();
    expect((await db('media_assets').first()).status).toBe('failed');
    await service.transfer('1-1');
    await service.transfer('1-1');
    expect(transfer).toHaveBeenCalledTimes(2);
    expect((await db('media_assets').first()).status).toBe('ready');
    await new MediaRepository(db).savePage('100', 'recent_media', [media('1')]);
    expect((await db('media_assets').first()).status).toBe('ready');
  });
  it('paginates timestamp ties and is stable when a newer post arrives', async () => {
    const repo = new MediaRepository(db);
    await repo.savePage('100', 'top_media', ['1', '2', '3'].map(media));
    const app = createApp(db, '/tmp');
    const first = await request(app).get('/hashtags?limit=2').expect(200);
    expect(first.body.data.map((m: any) => m.id)).toEqual(['3', '2']);
    await repo.savePage('100', 'recent_media', [
      { ...media('4'), timestamp: '2026-01-02T00:00:00.000Z' },
    ]);
    const second = await request(app)
      .get('/hashtags')
      .query({ limit: 2, cursor: first.body.pagination.nextCursor })
      .expect(200);
    expect(second.body.data.map((m: any) => m.id)).toEqual(['1']);
    expect(second.body.pagination).toEqual({ hasMore: false, nextCursor: null });
    await request(app).get('/hashtags?limit=0').expect(400);
    expect((await request(app).get('/hashtags?hashtag=unknown')).body.data).toEqual([]);
  });
  it('prevents overlapping work and releases locks after failure', async () => {
    await withLock(db, 'integration-lock', async () => {
      expect(await withLock(db, 'integration-lock', async () => 'unexpected')).toBeUndefined();
    });
    await expect(
      withLock(db, 'integration-lock', async () => {
        throw new Error('test');
      }),
    ).rejects.toThrow('test');
    expect(await withLock(db, 'integration-lock', async () => 'released')).toBe('released');
  });
  it('stores carousel children separately and exposes unavailable assets', async () => {
    await new MediaRepository(db).savePage('100', 'top_media', [
      {
        ...media('1'),
        media_type: 'CAROUSEL_ALBUM',
        children: {
          data: [
            { id: '20', media_type: 'IMAGE', media_url: media('1').media_url },
            { id: '21', media_type: 'VIDEO' },
          ],
        },
      },
    ]);
    const rows = await db('media_assets').orderBy('position');
    expect(rows.map((r) => r.id)).toEqual(['1-20', '1-21']);
    expect(rows[1].status).toBe('unavailable');
  });
});
describe('Redis integration', () => {
  it('retains queued work after producer closes and retries transient failures', async () => {
    const url = new URL(process.env.REDIS_URL ?? 'redis://redis:6379');
    const connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      maxRetriesPerRequest: null,
    };
    const name = `integration-${Date.now()}`;
    const producer = new Queue(name, { connection });
    const job = await producer.add(
      'test',
      {},
      { attempts: 2, backoff: { type: 'fixed', delay: 10 } },
    );
    await producer.close();
    const events = new QueueEvents(name, { connection });
    await events.waitUntilReady();
    let attempts = 0;
    const worker = new Worker(
      name,
      async () => {
        if (++attempts === 1) throw new Error('transient');
        return 'done';
      },
      { connection },
    );
    const queue = new Queue(name, { connection });
    try {
      const saved = await queue.getJob(job.id!);
      expect(await saved!.waitUntilFinished(events, 10000)).toBe('done');
      expect(attempts).toBe(2);
    } finally {
      await worker.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }, 15000);
});

it('closes an initialized queue adapter even when some queues were never used', async () => {
  const { BullJobQueue } = await import('../src/queue/bullmq');
  const queue = new BullJobQueue();
  await queue.sync.getJobCounts();
  await queue.close();
  await new Promise(resolve => setTimeout(resolve, 50));
});
