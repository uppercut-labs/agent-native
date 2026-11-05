import { env } from 'node:process';
const headers = { 'cache-control': 'private, no-store', vary: 'Authorization' };
export function GET({ params, request }) {
  if (
    !env.FIXTURE_ATTENDEE_TOKEN ||
    request.headers.get('authorization') !== `Bearer ${env.FIXTURE_ATTENDEE_TOKEN}`
  ) {
    return new Response('Restricted', { status: 403, headers });
  }
  if (params.slug !== 'lanterns') return new Response('Not found', { status: 404, headers });
  return Response.json({ attendees: ['PRIVATE-ATTENDEE-6C72'] }, { headers });
}
