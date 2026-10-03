import assert from 'node:assert/strict';
import test from 'node:test';

import { issueFixtureIdentity } from '../lib/fixture-identity.js';
import { readSavedList, SavedListAuthorizationError, saveBookForOwner } from '../lib/saved-list.js';

test("a cross-user save is denied before the owner's list is mutated", () => {
  const alex = issueFixtureIdentity('fixture-session-alex');
  const mina = issueFixtureIdentity('fixture-session-mina');
  const before = readSavedList(mina, 'reader-mina');

  assert.throws(
    () =>
      saveBookForOwner({
        identity: alex,
        ownerUserId: 'reader-mina',
        bookId: 'the-dispossessed',
      }),
    SavedListAuthorizationError,
  );

  assert.deepEqual(readSavedList(mina, 'reader-mina'), before);
});

test('a user-shaped value from an arbitrary header is not an identity', () => {
  const forgedHeaderValue = Object.freeze({ userId: 'reader-mina' });

  assert.throws(
    () =>
      saveBookForOwner({
        identity: forgedHeaderValue,
        ownerUserId: 'reader-mina',
        bookId: 'the-dispossessed',
      }),
    /not issued by the fixture identity boundary/,
  );
});
