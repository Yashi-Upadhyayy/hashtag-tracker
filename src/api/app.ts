import express, { ErrorRequestHandler } from 'express';
import path from 'node:path';
import { Knex } from 'knex';
import { encodeCursor, parseQuery } from './pagination';
import { logger, errorCode } from '../shared/logger';
export function createApp(db: Knex, storageRoot: string) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', async (_req, res) => {
    try {
      await db.raw('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.get('/hashtags', async (req, res) => {
    let query: ReturnType<typeof parseQuery>;
    try {
      query = parseQuery(req.query);
    } catch {
      res.status(400).json({ error: 'Invalid hashtag, limit, or cursor' });
      return;
    }
    const statement = db('media as m')
      .join('hashtag_media as hm', 'hm.media_id', 'm.id')
      .join('hashtags as h', 'h.id', 'hm.hashtag_id')
      .where('h.name', query.hashtag)
      .select('m.*', 'hm.seen_top', 'hm.seen_recent');
    if (query.cursor)
      statement.andWhereRaw('(m.posted_at, m.id) < (?::timestamptz, ?::text)', [
        query.cursor.postedAt,
        query.cursor.id,
      ]);
    const rows = await statement
      .orderBy('m.posted_at', 'desc')
      .orderBy('m.id', 'desc')
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit,
      page = rows.slice(0, query.limit);
    const assets = page.length
      ? await db('media_assets')
          .whereIn(
            'media_id',
            page.map((m) => m.id),
          )
          .orderBy('position')
      : [];
    const data = page.map((m) => ({
      id: m.id,
      caption: m.caption,
      mediaType: m.media_type,
      permalink: m.permalink,
      postedAt: m.posted_at,
      ingestedAt: m.created_at,
      updatedAt: m.updated_at,
      likeCount: m.like_count === null ? null : Number(m.like_count),
      commentsCount: m.comments_count === null ? null : Number(m.comments_count),
      sources: [m.seen_top ? 'top' : null, m.seen_recent ? 'recent' : null].filter(Boolean),
      assets: assets
        .filter((a) => a.media_id === m.id)
        .map((a) => ({
          id: a.id,
          position: a.position,
          mediaType: a.media_type,
          status: a.status,
          contentType: a.content_type,
          url: a.status === 'ready' ? `/assets/${a.id}` : null,
        })),
    }));
    const last = page.at(-1);
    res.json({
      data,
      pagination: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor(new Date(last.posted_at).toISOString(), last.id, query.hashtag)
            : null,
      },
    });
  });
  app.get('/assets/:id', async (req, res) => {
    if (!/^\d+-\d+$/.test(req.params.id)) {
      res.sendStatus(404);
      return;
    }
    const asset = await db('media_assets').where({ id: req.params.id, status: 'ready' }).first();
    if (!asset) {
      res.sendStatus(404);
      return;
    }
    res.set('X-Content-Type-Options', 'nosniff');
    res.type(asset.content_type);
    res.sendFile(path.resolve(storageRoot, asset.storage_key));
  });
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  const onError: ErrorRequestHandler = (error, _req, res, next) => {
    logger.error({ code: errorCode(error) }, 'API request failed');
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(onError);
  return app;
}
