import { z } from 'zod';
const cursorSchema = z
  .object({
    version: z.literal(1),
    hashtag: z.string(),
    postedAt: z.string().datetime({ offset: true }),
    id: z.string().regex(/^\d+$/),
  })
  .strict();
export function encodeCursor(postedAt: string, id: string, hashtag: string) {
  return Buffer.from(JSON.stringify({ version: 1, postedAt, id, hashtag })).toString('base64url');
}
export function parseQuery(input: unknown) {
  const query = z
    .object({
      hashtag: z
        .string()
        .regex(/^[a-zA-Z0-9_]{1,100}$/)
        .default('matcha'),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      cursor: z
        .string()
        .min(1)
        .max(1024)
        .regex(/^[A-Za-z0-9_-]+$/)
        .optional(),
    })
    .strict()
    .parse(input);
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (query.cursor) {
    cursor = cursorSchema.parse(
      JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
    );
    if (cursor.hashtag !== query.hashtag) throw new Error('CURSOR_HASHTAG_MISMATCH');
  }
  return { ...query, cursor };
}
