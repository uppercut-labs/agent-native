export function GET() {
  return new Response('Sign in to view account settings.', {
    status: 401,
    headers: { 'cache-control': 'private, no-store' },
  });
}
