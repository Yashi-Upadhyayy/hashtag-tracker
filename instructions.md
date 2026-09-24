# setup

Prerequisite: Docker Desktop installed and running. No AWS account, host Node.js, host Postgres, or host Redis required. On macOS choose the correct Apple Silicon or Intel download from https://docs.docker.com/desktop/setup/install/mac-install/ and complete Docker Desktop's initial setup.

From this repository:

```sh
cp .env.example .env
docker compose up --build -d
docker compose ps -a
docker compose logs -f worker
```

`migrate` and `scheduler` should exit successfully with code 0; they are one-shot services. API, worker, Postgres, Redis, and the mock service stay running. Default mock mode creates 500 unique posts and 550 assets after both startup syncs complete; each endpoint has more than 500 available and intentionally shares the same IDs. Stored assets are tiny PNG fixtures, not real Instagram images. The read API is available while transfers continue, with asset status shown per record.

```sh
curl 'http://localhost:3000/health'
curl 'http://localhost:3000/hashtags?limit=5'
# Paste the returned nextCursor into the following request:
curl 'http://localhost:3000/hashtags?limit=5&cursor=PASTE_NEXT_CURSOR'
# Download an asset whose status is ready:
curl -o sample.png 'http://localhost:3000/assets/100001-100001'
```

## Live Meta mode

Edit `.env`: set `MODE=live`, `META_USER_ID` to the supplied business ID, and `META_ACCESS_TOKEN` to the supplied token. Do not commit `.env`. The client uses Graph API v24.0 and requests carousel child expansion in addition to the assignment's fields. Live testing showed Meta can reject 25-item requests for this field combination; the client halves the page size on that response and continues pagination. It also guards against cursor loops while allowing a repeated cursor when the page still contains new IDs. Transient network, timeout, rate-limit, and server errors receive bounded retries on the current page.

Use a separate Compose project so demo rows do not mix with live rows:

```sh
docker compose stop
docker compose -p hashtag-live up --build -d
# Prefix subsequent live commands with: docker compose -p hashtag-live
```

Top and recent syncs run at initial scheduler registration; recent then runs at 00:00, 03:00, 06:00, etc. UTC. Top can be refreshed manually. Re-running scheduler registration intentionally requests fresh startup syncs; schedules are upserted with stable IDs.

```sh
docker compose run --rm scheduler
docker compose run --rm worker node dist/src/entrypoints/sync.js top_media
docker compose run --rm worker node dist/src/entrypoints/sync.js recent_media
```

## Verification

```sh
# Unit tests plus Postgres/Redis integration tests in Docker.
# Integration tests create a separate tracker_test database.
docker compose --profile test run --build --rm tests

# End-to-end demo assertions (waits up to 60 seconds for transfers):
docker compose exec api node scripts/smoke.mjs

# Inspect caps, progress, and failures:
docker compose exec postgres psql -U tracker -d tracker -c \
  'SELECT endpoint,status,processed,pages,capped,error_code FROM sync_runs ORDER BY started_at DESC;'
docker compose exec postgres psql -U tracker -d tracker -c \
  'SELECT status,count(*) FROM media_assets GROUP BY status;'
```

Unit tests cover page caps, repeated cursors, invalid queries, token-safe Meta requests, incomplete carousel detection, streamed file size limits, deterministic storage, and redirect rejection. Integration tests use actual Postgres/Redis for deduplication, partial sync retry, independent asset recovery, tied timestamp pagination, advisory locks, carousel persistence, and queue retries.

For troubleshooting, inspect `docker compose logs migrate scheduler worker api`. Metadata persists if asset downloads fail. Expected generic error codes are stored in `sync_runs` and `media_assets`; upstream payloads and URLs are deliberately omitted from logs. The API's health check tests the API database connection; it is not a complete worker/Redis health check.

```sh
docker compose down       # Stops containers; preserves data volumes.
# Destructive reset, only if you want to discard all local database/queue/assets:
# docker compose down -v
```

# vars

| Variable | Default | Meaning |
| --- | --- | --- |
| `MODE` | `mock` | `mock` for demo; `live` for Meta |
| `META_ACCESS_TOKEN` | empty | Required in live mode; secret |
| `META_USER_ID` | empty | Required numeric Instagram business ID in live mode |
| `META_API_VERSION` | `v24.0` | Graph API version |
| `PORT` | `3000` | Host API port; bound to loopback |
| `SYNC_LIMIT` | `500` | Per endpoint sync cap, between 1 and 500 |
| `META_PAGE_SIZE` | `25` | Maximum requested page size, between 1 and 25; set `5` for the provided live account |
| `ASSET_CONCURRENCY` | `4` | Asset slots per worker, between 1 and 16 |
| `MAX_ASSET_BYTES` | `104857600` | Maximum bytes per asset, streamed |
| `DATABASE_URL` | Compose-managed | Postgres connection for app containers |
| `REDIS_URL` | Compose-managed | Redis connection for app containers |
| `MOCK_BASE_URL` | Compose-managed | Internal local mock endpoint |
| `STORAGE_ROOT` | `/data/assets` | Mounted asset directory |
| `TEST_DATABASE_URL` | Test service-managed | Disposable database ending in `_test` |

Database/Redis are not exposed on host ports. The Compose database password is intentionally a local development default. Compose environment values override `.env` values for internal service URLs; edit Compose when changing that topology.

# tradeoffs

- Modular monolith with separate process entry points instead of microservices. Shared code, explicit responsibilities, independently scalable workers.
- Redis/BullMQ adds one container but provides durable jobs, bounded concurrency, exponential retries, and persistent schedules. Redis AOF uses its default fsync policy and is not a zero-loss durability guarantee.
- Every endpoint sync handles at most 500 returned items, not 500 new unique records. An oversized response is truncated to the remaining allowance. `capped=true` means the limit was reached, not proof additional data exists.
- Page requests retry transient failures with bounded backoff. If a whole sync still fails, its BullMQ retry restarts from page one; already committed pages remain, and upserts prevent duplication. No durable Meta cursor checkpoint is implemented. In live verification, recent-media sync reached the 500-item cap twice, while top-media syncs were interrupted by Meta errors. The live database held 1,333 distinct posts and 2,217 ready assets at the last check. Meta availability and the sync cap mean this is sampled ingestion, not a guarantee of capturing every post.
- Asset pending state in Postgres repairs lost enqueue operations. Failed transfers retry five times with exponential delay, then become eligible for recovery after 15 minutes. Permanent failures may recur until the source URL is refreshed or an operator intervenes; no dedicated dead-letter UI.
- Metadata keeps captions, types, permalink, timestamps, optional engagement counts, associations, asset source URLs, and transfer outcomes. Missing counts stay null. It omits raw response blobs, access tokens, user profiles, and engagement history. Source URLs are retained to support retries; ready assets are not downloaded again just because Meta returns a refreshed URL.
- Carousel child URLs are requested inline. If Meta reports additional child pages, the job fails explicitly rather than silently claiming complete ingestion. Missing URLs produce unavailable asset entries. Live permissions/field support must be verified against the provided account.
- API returns pending/failed/unavailable asset status, and serves only ready local assets. It orders by the Instagram timestamp, with deterministic ID tie-breaking. No authentication is included in this local assignment; the host port binds to localhost.
- Downloads allow HTTPS Meta CDN hosts, reject redirects, enforce an allowlist of media types, and stream under a size/time bound. Add hostnames only after verifying an actual Meta response. Crashes can leave temporary files; automated cleanup and asset retention are future work.
- Local asset volumes support one Docker host. Multi-host deployment requires shared object storage. Global per-request Meta rate-limit coordination, circuit breakers, production secrets, dashboards, and infrastructure provisioning are outside this submission.
- No cloud services are used. AWS ports are defined by the design; S3/SQS/EventBridge adapters have not been implemented or tested.

# ai-usage

Tool: OpenAI Codex.

Codex was used to discuss architecture, scaffold the Express/TypeScript implementation, write Knex migrations, add queue/storage adapters, implement a mock provider, write automated tests, and draft setup documentation. It also performed build and test checks documented in `verification.md`.

I chose Knex, a backend-only scope, a Docker-first local setup, and requested modularity and scalability. I installed Docker Desktop and ran the Docker verification script; its 39 passing tests and live-run observations are recorded in `verification.md`. 

Codex wrote the implementation and tests. 
