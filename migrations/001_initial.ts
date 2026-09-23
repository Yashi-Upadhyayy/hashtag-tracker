import { Knex } from 'knex';
export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('hashtags', (t) => {
    t.text('id').primary();
    t.text('name').notNullable().unique();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
  });
  await db.schema.createTable('media', (t) => {
    t.text('id').primary();
    t.text('caption');
    t.text('media_type').notNullable();
    t.text('permalink');
    t.timestamp('posted_at', { useTz: true }).notNullable();
    t.bigInteger('like_count');
    t.bigInteger('comments_count');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
  });
  await db.raw('CREATE INDEX media_feed_idx ON media (posted_at DESC, id DESC)');
  await db.schema.createTable('hashtag_media', (t) => {
    t.text('hashtag_id').notNullable().references('id').inTable('hashtags').onDelete('CASCADE');
    t.text('media_id').notNullable().references('id').inTable('media').onDelete('CASCADE');
    t.boolean('seen_top').notNullable().defaultTo(false);
    t.boolean('seen_recent').notNullable().defaultTo(false);
    t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    t.primary(['hashtag_id', 'media_id']);
    t.index('media_id');
  });
  await db.schema.createTable('media_assets', (t) => {
    t.text('id').primary();
    t.text('media_id').notNullable().references('id').inTable('media').onDelete('CASCADE');
    t.integer('position').notNullable();
    t.text('media_type').notNullable();
    t.text('source_url');
    t.text('storage_key');
    t.text('content_type');
    t.bigInteger('byte_size');
    t.text('status').notNullable().defaultTo('pending');
    t.text('last_error');
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    t.unique(['media_id', 'position']);
    t.index(['status', 'updated_at']);
  });
  await db.raw(
    "ALTER TABLE media_assets ADD CONSTRAINT asset_status CHECK (status IN ('pending','ready','failed','unavailable'))",
  );
  await db.schema.createTable('sync_runs', (t) => {
    t.uuid('id').primary();
    t.text('hashtag_id').notNullable().references('id').inTable('hashtags');
    t.text('endpoint').notNullable();
    t.text('status').notNullable();
    t.integer('processed').notNullable().defaultTo(0);
    t.integer('pages').notNullable().defaultTo(0);
    t.boolean('capped').notNullable().defaultTo(false);
    t.text('error_code');
    t.timestamp('started_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    t.timestamp('finished_at', { useTz: true });
    t.index(['hashtag_id', 'endpoint', 'started_at']);
  });
}
export async function down(db: Knex): Promise<void> {
  for (const table of ['sync_runs', 'media_assets', 'hashtag_media', 'media', 'hashtags'])
    await db.schema.dropTableIfExists(table);
}
