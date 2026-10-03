# E10 - Existing functions retrofit

This after-state binds the unchanged `searchContent({ query, limit })` function to an Agent Native
contract. The contract preserves `GET /api/content/search?q=...`, maps `q` to the function's
`query` field, and exposes the generated CLI command `content-search` with the familiar `search`
alias. The generated handler rejects POST mutations and validates input and output with the same
contract used by the CLI. The old CLI and HTTP source remain unchanged in `service-before`.

From the repository root, the reproducible check is `npm run example:e10`. The harness builds and packs the package,
copies the unchanged function and data fixture through `shared-files.json`, runs `npm ci`, and then
runs the tests. In the exported project, use:

    npm ci
    npm test
    npm run search -- --query night --limit 1
    npm start

With the server running, `curl 'http://127.0.0.1:8788/api/content/search?q=night&limit=1'` returns
the existing first match. `GET /api/health` and `GET /api/content/city-map` remain available.

Negative cases are explicit: a missing `q`, a fractional limit, or an empty CLI query produces an
`invalid_input` contract failure without calling the existing function; POST on the read route
returns 405 with `Allow: GET`. No account, network service, secret, or production deployment is
required.
