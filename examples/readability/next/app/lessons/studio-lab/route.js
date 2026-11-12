export const runtime = 'nodejs';
export function GET(request) {
  const token = process.env.STUDIO_LAB_TOKEN;
  if (token && request.headers.get('authorization') === 'Bearer ' + token) {
    return new Response('Studio lab access granted.', {
      headers: { 'cache-control': 'private, no-store' },
    });
  }
  return new Response('Sign in to your studio account.', {
    status: 401,
    headers: { 'cache-control': 'private, no-store' },
  });
}
