import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

if (process.env.MODE !== 'mock') throw new Error('This smoke test expects MODE=mock');
const origin = 'http://localhost:3000';
let media = [];
for (let attempt = 0; attempt < 60; attempt++) {
  media = [];
  let cursor;
  do {
    const url = new URL('/hashtags', origin);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const body = await response.json();
    media.push(...body.data);
    cursor = body.pagination.nextCursor;
    assert(media.length <= 500, 'Unexpected extra media in demo database');
  } while (cursor);
  if (media.length === 500 && media.every(m => m.assets.every(a => a.status === 'ready'))) break;
  await setTimeout(1000);
}
assert.equal(media.length, 500);
assert.equal(new Set(media.map(m => m.id)).size, 500);
assert(media.every(m => m.sources.includes('top') && m.sources.includes('recent')));
const assets = media.flatMap(m => m.assets);
assert.equal(assets.length, 550);
assert(assets.every(a => a.status === 'ready'), 'Some asset transfers are unfinished');
for (let i = 1; i < media.length; i++) {
  const previous = media[i - 1], current = media[i];
  assert(previous.postedAt > current.postedAt ||
    (previous.postedAt === current.postedAt && previous.id > current.id));
}
const response = await fetch(new URL(assets[0].url, origin));
assert.equal(response.status, 200);
assert.match(response.headers.get('content-type'), /image\/png/);
assert((await response.arrayBuffer()).byteLength > 0);
console.log('PASS: 500 unique media, top/recent deduplication, descending cursor traversal, 550 ready assets, stored asset download');
