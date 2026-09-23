# Verification

Checks performed on 2026-09-22 and 2026-09-23 using Docker Desktop on Apple Silicon and the bundled Node runtime:

- Clean dependency installation from `package-lock.json`: passed.
- TypeScript compilation in the Docker build: passed.
- Unit tests in Docker with Vitest 5.0.1: **31 passed** after the per-page retry change.
- Integration tests against real Postgres 17 and Redis 7 in Docker: **8 passed** after those changes. The complete suite passed **39 tests** in the local live-run report.
- Docker Compose configuration and container startup, including migrations and scheduler registration: passed.
- End-to-end smoke test: **500 unique media records**, **550 ready assets**, correct top/recent association, descending cursor traversal, and successful stored asset download.
- Both initial syncs completed **20 pages / 500 items** and recorded `capped=true`.
- Scaled to two worker containers and ran an additional recent sync: passed; totals remained 500 media and 550 assets. Returned to one worker for the local demo.
- Registered recent-media schedule inspected in Redis: `0 */3 * * *`, UTC.
- npm dependency audit after updating the test runner: zero reported vulnerabilities at check time.
- GitHub Actions on the published commit: TypeScript build, **32 unit tests**, and **8 Postgres/Redis integration tests** passed ([CI run](https://github.com/Yashi-Upadhyayy/hashtag-tracker/actions/runs/35852425979)). This includes the final one-item-page retry test.

Integration coverage includes database deduplication, partial sync retry, pending asset reconciliation, independent transfer retry, timestamp ties, advisory lock release, carousel persistence, and durable queued work across producer reconnects with retry handling. This is not a load test or a simulated Redis/server crash test.

Live Meta verification:

- Live Meta credential resolution succeeded: `matcha` resolved to a hashtag ID, and five-item top-media requests returned image, video, and carousel records with children. A 25-item request was rejected by Meta with “reduce the amount of data”; the client now halves page size and remembers the accepted size. A repeated cursor with new IDs was observed and handled.
- Two `recent_media` syncs each completed **500 items / 500 pages** with `capped=true` against Meta. The isolated live database held **1,333 distinct posts**, **2,217 ready assets**, and **436 unavailable assets** with no source URL at the last check. The API returned stored metadata and ready asset URLs; one real JPEG downloaded with HTTP 200 and 1,418,393 bytes.
- The latest observed `top_media` syncs failed during later Meta network requests. A later recent run hit `META_REDUCE_PAGE_SIZE` at page size one; bounded same-cursor retry and a focused test were added for that response. GitHub Actions passed all 40 tests after this final change. A local Docker rerun of that change was not possible from this Codex task because it cannot access Docker's Unix socket. Repeated generic worker errors also appeared in the live log; their cause has not been isolated.

Still to verify before submission:

- The private [GitHub repository](https://github.com/Yashi-Upadhyayy/hashtag-tracker) has been published. Invitations were sent to `saral-kalwani`, `pranav-getsaral`, and `nivekithan-saral`; their acceptance is pending.
- Candidate's final code review and any additional personally authored changes, to be recorded in `instructions.md` under `ai-usage`.

Reproduce the Docker checks using the commands in `instructions.md`. The local demo runs entirely in Docker with mock Meta data.
