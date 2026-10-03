# E03 pre-integration reading list

This directory is a self-contained Next.js baseline fixture. It presents a small public reading
catalog, a server-only in-memory saved-list mock, and a fixture-session route that reads only the
authenticated fixture identity's own list. It intentionally has no Agent Native integration,
bootstrap adapter, external service, real credential, persistence layer, or deployment
configuration.

## Runtime and package choice

- Node.js 22 or newer (the fixture is intended for Node.js 22 and 24).
- Next.js `16.3.8`, React `19.3.0`, and React DOM `19.3.0` are exact pins.
- The npm metadata for Next.js `16.3.8` declares Node.js `>=20.9.0`, so Node.js 22 and 24 satisfy
the package's runtime requirement.
- Next.js 16 is the Active LTS line, and the official installation documentation lists Node.js
`20.9` as the minimum: <https://nextjs.org/docs/app/getting-started/installation> and
<https://nextjs.org/support-policy>.

## Run and verify

```sh
npm ci
npm run build
npm test
```

`npm test` runs the saved-list authorization tests, invokes `/api/catalog` and `/api/saved-list`
with local Fetch API requests, then checks the emitted server artifacts and scans browser JavaScript
and source maps. Production browser source maps are enabled so the boundary check covers them rather
than relying on their absence. The saved-list endpoint accepts only one of the fixture's fake bearer
session tokens and always derives the owner from the issued identity; a caller-supplied owner ID is
ignored. This demonstrates the module boundary and fixture policy, not production authentication.

The identity registry in `lib/fixture-identity.js` is deliberately a test fixture boundary. It
issues branded identities from hard-coded fake session tokens and rejects plain objects that merely
claim a user ID. It is not production authentication, and arbitrary request headers must not be
trusted as identities: only an exact fixture token accepted by this module is mapped.

## Boundaries

`lib/saved-list.js` and `lib/fixture-identity.js` are marked `server-only`. The saved-list API route
imports them in the server graph, and the sentinel test requires the fake marker in an emitted server
artifact while ensuring it is absent from every emitted browser JavaScript and source-map artifact.
The sentinel is an intentionally public test string, not a credential. Saved lists are in-memory
sample data and reset when the server process restarts.
