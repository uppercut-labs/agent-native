import 'server-only';

import { assertFixtureIdentity } from './fixture-identity.js';

// Deliberately fake marker used only to prove this module never enters browser artifacts.
const SERVER_ONLY_SENTINEL = 'FAKE_E03_SERVER_SENTINEL_NOT_A_REAL_SECRET_7f3c91';

const savedBooksByOwner = new Map([
  ['reader-alex', new Set(['braiding-sweetgrass'])],
  ['reader-mina', new Set(['invisible-cities'])],
]);

export class SavedListAuthorizationError extends Error {
  constructor() {
    super("A reader cannot mutate another reader's saved list");
    this.name = 'SavedListAuthorizationError';
  }
}

export function readSavedList(identity, ownerUserId) {
  authorizeOwner(identity, ownerUserId);
  return [...(savedBooksByOwner.get(ownerUserId) ?? [])];
}

export function saveBookForOwner({ identity, ownerUserId, bookId }) {
  // Authorization deliberately precedes validation and every mutation.
  authorizeOwner(identity, ownerUserId);

  if (typeof bookId !== 'string' || bookId.length === 0) {
    throw new TypeError('bookId must be a non-empty string');
  }

  const savedBooks = savedBooksByOwner.get(ownerUserId) ?? new Set();
  savedBooks.add(bookId);
  savedBooksByOwner.set(ownerUserId, savedBooks);

  return { ownerUserId, bookId, saved: true };
}

// docs:start saved-list-owner-check
function authorizeOwner(identity, ownerUserId) {
  assertFixtureIdentity(identity);
  if (identity.userId !== ownerUserId) {
    throw new SavedListAuthorizationError();
  }
  // docs:end saved-list-owner-check
}

void SERVER_ONLY_SENTINEL;
