import { findAlbumBySlug } from '../../../data/albums.mjs';

export const prerender = false;

export function GET({ params }) {
  const album = findAlbumBySlug(params.slug);

  if (!album) {
    return Response.json(
      { error: { code: 'album_not_found', message: `No album is filed as ${params.slug}.` } },
      { status: 404 },
    );
  }

  return Response.json(
    { album },
    {
      headers: {
        'cache-control': 'no-store',
      },
    },
  );
}
