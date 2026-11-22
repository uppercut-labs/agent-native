# E13 standalone project

Install dependencies with `npm ci`, then run `npm test` and `npm start`.

- `npm test` builds three self-contained MCP App resources (React 19, the official ext-apps `App` bridge and Agent Native UI) and runs the SDK conformance suite: the official MCP client over a loopback HTTP socket, with the official `App` and `AppBridge` paired in memory.
- `npm start` prints what a host without MCP Apps support receives: the anonymous tool list and an ordinary text result.
- `npm run serve` starts the anonymous fixture server on `127.0.0.1` (set `PORT` to choose the port) and prints its `/mcp` URL. It exposes only the three read tools. Saving needs an authenticated caller, which this server does not configure, so the views show that saving needs a signed-in account.

All data is synthetic and kept in memory. The audio is a tone generated in the page. Test identities in `src/fixture-auth.mjs` load only when `UAN_E13_TEST_MODE=1`, which the test suite sets.
