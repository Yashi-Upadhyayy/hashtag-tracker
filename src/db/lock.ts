import { Knex } from 'knex';
// A dedicated session owns the advisory lock; always release it before returning to the pool.
export async function withLock<T>(
  db: Knex,
  key: string,
  work: () => Promise<T>,
): Promise<T | undefined> {
  const connection = await db.client.acquireConnection();
  let acquired = false;
  try {
    const result = await db
      .raw('SELECT pg_try_advisory_lock(hashtextextended(?, 0)) AS acquired', [key])
      .connection(connection);
    acquired = result.rows[0].acquired;
    if (!acquired) return undefined;
    return await work();
  } finally {
    try {
      if (acquired)
        await db
          .raw('SELECT pg_advisory_unlock(hashtextextended(?, 0))', [key])
          .connection(connection);
    } finally {
      await db.client.releaseConnection(connection);
    }
  }
}
