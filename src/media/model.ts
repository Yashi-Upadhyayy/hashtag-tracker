import { z } from 'zod';
export const endpointSchema = z.enum(['top_media', 'recent_media']);
export type Endpoint = z.infer<typeof endpointSchema>;
const assetSchema = z.object({
  id: z.string().regex(/^\d+$/),
  media_type: z.enum(['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM']),
  media_url: z.string().url().optional(),
});
export const mediaSchema = assetSchema.extend({
  timestamp: z.string().datetime({ offset: true }),
  caption: z.string().optional(),
  permalink: z.string().url().optional(),
  like_count: z.number().int().nonnegative().optional(),
  comments_count: z.number().int().nonnegative().optional(),
  children: z
    .object({
      data: z.array(assetSchema),
      paging: z.object({ next: z.string().optional() }).optional(),
    })
    .optional(),
});
export type Media = z.infer<typeof mediaSchema>;
export interface MediaPage {
  data: Media[];
  after?: string;
}
export interface MediaSource {
  resolveHashtag(name: string): Promise<string>;
  fetchPage(
    hashtagId: string,
    endpoint: Endpoint,
    limit: number,
    after?: string,
  ): Promise<MediaPage>;
}
export function assetsOf(media: Media) {
  const children = media.media_type === 'CAROUSEL_ALBUM' ? media.children?.data : undefined;
  return (children?.length ? children : [media]).map((asset, position) => ({
    id: `${media.id}-${asset.id}`,
    media_id: media.id,
    position,
    media_type: asset.media_type,
    source_url: asset.media_url ?? null,
    status: asset.media_url ? 'pending' : 'unavailable',
  }));
}
