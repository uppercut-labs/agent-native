import { FixtureSessionError, issueFixtureIdentity } from '../../../lib/fixture-identity.js';
import { readSavedList } from '../../../lib/saved-list.js';

export function GET(request) {
  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^Bearer[\t ]+([^\s]+)$/i);
  if (!match) return unauthorizedResponse();

  let identity;
  try {
    identity = issueFixtureIdentity(match[1]);
  } catch (error) {
    if (error instanceof FixtureSessionError) return unauthorizedResponse();
    throw error;
  }

  return Response.json(
    { items: readSavedList(identity, identity.userId) },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}

function unauthorizedResponse() {
  return Response.json(
    { error: { code: 'unauthorized', message: 'A valid fixture session is required.' } },
    { status: 401, headers: { 'cache-control': 'no-store' } },
  );
}
