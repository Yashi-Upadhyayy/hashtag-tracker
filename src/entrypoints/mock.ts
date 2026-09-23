import express from 'express';
const app = express();
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'mock' });
});
app.get('/v24.0/ig_hashtag_search', (_req, res) => {
  res.json({ data: [{ id: '100' }] });
});
app.get('/v24.0/100/:endpoint', (req, res) => {
  if (!['top_media', 'recent_media'].includes(req.params.endpoint)) {
    res.sendStatus(404);
    return;
  }
  const offset = Number(req.query.after ?? 0),
    limit = Math.min(Number(req.query.limit ?? 25), 25);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) {
    res.sendStatus(400);
    return;
  }
  const end = Math.min(offset + limit, 620);
  const data = Array.from({ length: Math.max(0, end - offset) }, (_, i) => {
    const n = offset + i,
      id = String(100000 + n),
      carousel = n % 10 === 0;
    return {
      id,
      caption: `Demo matcha post ${n}`,
      media_type: carousel ? 'CAROUSEL_ALBUM' : 'IMAGE',
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, -Math.floor(n / 3))).toISOString(),
      permalink: `https://www.instagram.com/p/demo${n}/`,
      like_count: n,
      comments_count: n % 7,
      ...(carousel
        ? {
            children: {
              data: [0, 1].map((i) => ({
                id: String(900000 + n * 2 + i),
                media_type: 'IMAGE',
                media_url: 'http://mock-meta:4000/sample.png',
              })),
            },
          }
        : { media_url: 'http://mock-meta:4000/sample.png' }),
    };
  });
  res.json({
    data,
    ...(end < 620
      ? {
          paging: {
            cursors: { after: String(end) },
            next: `http://mock-meta:4000/v24.0/100/${req.params.endpoint}?after=${end}`,
          },
        }
      : {}),
  });
});
app.get('/sample.png', (_req, res) => {
  res
    .type('png')
    .send(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHHsAAAAASUVORK5CYII=',
        'base64',
      ),
    );
});
app.listen(4000, () =>
  console.log('Mock Meta listening on 4000; 620 records per endpoint, overlapping IDs'),
);
