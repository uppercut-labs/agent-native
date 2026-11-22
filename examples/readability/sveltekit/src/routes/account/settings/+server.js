export function GET() {
  return new Response('Restricted', {
    status: 403,
    headers: { 'cache-control': 'private, no-store' },
  });
}
