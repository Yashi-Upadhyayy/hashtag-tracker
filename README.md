# Hashtag tracker

Express + TypeScript + Postgres ingestion service with Knex migrations, Redis/BullMQ workers, and local asset storage. Entire application runs in Docker; no host Node, Postgres, or Redis installation required.

Start with [instructions.md](instructions.md). Default mode uses a local mock Meta service, including 620 paginated records, overlapping top/recent results, and carousel assets. Live Meta mode is explicitly opt-in.

```sh
cp .env.example .env
docker compose up --build -d
curl 'http://localhost:3000/hashtags?limit=5'
```

See [architecture.md](architecture.md) for module boundaries, failure handling, and scaling decisions.
