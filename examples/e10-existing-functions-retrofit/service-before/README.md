# E10 before-state content service

This is a small existing read-only content/search service before Agent Native adoption. The
source deliberately imports no Agent Native package. UAN-018 will bind the existing
searchContent function and preserve the existing HTTP path and CLI alias.

## Prerequisites and checks

Use Node.js 22 or 24 and npm. There are no external runtime dependencies, services, tokens, or
accounts. From this directory:

    npm ci
    npm test

The locked npm install and tests are self-contained. For a manual HTTP check:

    npm start

In a second shell:

    curl 'http://127.0.0.1:8788/api/content/search?q=night'
    curl 'http://127.0.0.1:8788/api/health'

The search response includes night-drive and night-market in that order. The health route
responds with {"status":"ok"}. Stop the server with Ctrl-C. It binds loopback only.

The existing CLI command and its short alias invoke the same search function:

    npm run search -- night
    node src/cli.mjs search night --limit 1

The alias with limit 1 returns only night-drive. Both commands print one JSON result line.

## Negative paths

A missing HTTP query produces status 400 and invalid_search. A POST to the read path produces
status 405 with Allow: GET. An empty CLI query exits 2 and prints an input error:

    node src/cli.mjs search ''

All records in data/content.json are invented public fixture data. The HTTP and CLI surfaces are
local baseline behavior, not package integration or a production deployment.

## Retrofit boundary

src/content.mjs is the existing function source. src/http.mjs owns the established
GET /api/content/search route; GET /api/health and GET /api/content/:slug are unrelated public
reads. src/cli.mjs owns the existing content-search command and search alias. The retrofit
should preserve these files byte for byte where direct binding is possible. Record SHA-256 hashes
before modifying or adding integration files, and compare them after UAN-018.
