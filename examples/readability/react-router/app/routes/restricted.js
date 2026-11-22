const headers = { 'cache-control': 'private, no-store', vary: 'Authorization' };
export function loader({ request }) {
  if (
    !process.env.FIXTURE_STAFF_TOKEN ||
    request.headers.get('authorization') !== `Bearer ${process.env.FIXTURE_STAFF_TOKEN}`
  ) {
    throw new Response('Restricted', { status: 403, headers });
  }
  return Response.json({ staffNote: 'PRIVATE-TRANSIT-7E93' }, { headers });
}
