# Verification

Checks performed using Docker Desktop on Apple Silicon and the bundled Node runtime:

- Clean dependency installation from `package-lock.json`: passed.
- TypeScript compilation in the Docker build: passed.
- Unit tests in Docker with Vitest 5.0.1: **31 passed**.
- Integration tests against real Postgres 17 and Redis 7 in Docker: **8 passed**. The complete suite passed **39 tests** in the local live-run report.
- Docker Compose configuration and container startup, including migrations and scheduler registration: passed.
- End-to-end smoke test: **500 unique media records**, **550 ready assets**, correct top/recent association, descending cursor traversal, and successful stored asset download.
- Both initial syncs completed **20 pages / 500 items** and recorded `capped=true`.
- Scaled to two worker containers and ran an additional recent sync: passed; totals remained 500 media and 550 assets. Returned to one worker for the local demo.
- Registered recent-media schedule inspected in Redis: `0 */3 * * *`, UTC.
- npm dependency audit after updating the test runner: zero reported vulnerabilities at check time.
- GitHub Actions on the published commit: TypeScript build, **32 unit tests**, and **8 Postgres/Redis integration tests** passed ([CI run](https://github.com/Yashi-Upadhyayy/hashtag-tracker/actions/runs/35852425979)). This includes the final one-item-page retry test.

Integration coverage includes database deduplication, partial sync retry, pending asset reconciliation, independent transfer retry, timestamp ties, advisory lock release, carousel persistence, and durable queued work across producer reconnects with retry handling. This is not a load test or a simulated Redis/server crash test.