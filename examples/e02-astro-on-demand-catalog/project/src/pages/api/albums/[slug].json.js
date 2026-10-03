import { lookupAlbum } from '../../../catalog.mjs';

export const prerender = false;

export function GET({ params }) {
  const result = lookupAlbum({ slug: params.slug });
  if (result.kind === 'missing') {
    return Response.json(
      { error: { code: 'album_not_found', message: `No album is filed as ${params.slug}.` } },
      { status: 404 },
    );
  }
  return Response.json({ album: result.album }, { headers: { 'cache-control': 'no-store' } });
}
