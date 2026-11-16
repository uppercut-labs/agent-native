// MCP server for the UI fixture patterns. Each open capability carries a bundled MCP App view;
// saves are protected, idempotent per caller and requestId, and stay hidden from anonymous hosts.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer as createNodeServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bindCapability,
  canonicalCapabilityId,
  capabilitySurfaceNames,
  createCapabilityRegistry,
  evaluateCapabilityDiscovery,
  hasGrantForScopes,
} from '@uppercut-labs/agent-native';
import { createMcpAppsHandler } from '@uppercut-labs/agent-native/mcp-apps';
import { UI_CATALOG_ID } from '@uppercut-labs/agent-native/ui';
import { PresentationRegistry } from '@uppercut-labs/agent-native/ui/presentation';
import {
  annotationsSave,
  canSave,
  capabilities,
  chancePercent,
  exploreOpen,
  mediaOpen,
  reviewOpen,
  reviewSave,
} from './contracts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const toolNames = Object.fromEntries(
  capabilities.map((c) => [c.identity.name, capabilitySurfaceNames(c.identity).mcp]),
);
export const viewUris = {
  review: 'ui://uppercut/ui-review.html',
  explore: 'ui://uppercut/ui-explore.html',
  media: 'ui://uppercut/ui-media.html',
};

const initialRecords = () => [
  {
    id: 'landing',
    title: 'Landing page review',
    category: 'Website',
    before: 'Review the landing page.',
    draft: 'Review the landing page and flag unclear next steps.',
  },
  {
    id: 'setup',
    title: 'Setup guide follow-up',
    category: 'Documentation',
    before: 'Check the setup guide.',
    draft: 'Check the setup guide against a clean installation.',
  },
  {
    id: 'pricing',
    title: 'Pricing note',
    category: 'Website',
    before: 'Pricing is listed per seat.',
    draft: 'Pricing is listed per seat, billed monthly.',
  },
];
const transcript = [
  { id: 'first', start: 0, text: 'Opening tone' },
  { id: 'second', start: 3, text: 'Second tone' },
  { id: 'third', start: 6, text: 'Third tone' },
  { id: 'fourth', start: 9, text: 'Closing tone' },
];

function callerKey(caller) {
  if (caller.kind !== 'authenticated') throw new Error('Writes need an authenticated caller.');
  const identity = caller.identity;
  return JSON.stringify([identity?.issuer, identity?.tenantId, caller.subject]);
}
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** One in-memory fixture state per server; nothing is persisted. */
export function createFixtureState() {
  const records = initialRecords();
  let revision = 0;
  let annotations = [];
  const replies = new Map();
  function once(caller, requestId, input, apply) {
    const key = `${callerKey(caller)}|${requestId}`;
    const fingerprint = digest(input);
    const previous = replies.get(key);
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint)
        throw new Error('requestId was already used with different input.');
      return { ...previous.result, replayed: true };
    }
    const result = { ...apply(), replayed: false };
    replies.set(key, { fingerprint, result });
    return result;
  }
  return {
    review: (caller) => ({ revision, records: structuredClone(records), canSave: canSave(caller) }),
    saveReview(caller, input) {
      return once(caller, input.requestId, input.drafts, () => {
        const saved = [];
        for (const { id, draft } of input.drafts) {
          const record = records.find((entry) => entry.id === id);
          if (record === undefined) throw new Error(`Unknown record ${id}.`);
          record.before = draft;
          record.draft = draft;
          saved.push(id);
        }
        revision += 1;
        return { saved, revision };
      });
    },
    media: (caller) => ({
      duration: 12,
      lines: transcript,
      annotations: structuredClone(annotations),
      canSave: canSave(caller),
    }),
    saveAnnotations(caller, input) {
      return once(caller, input.requestId, input.annotations, () => {
        annotations = structuredClone(input.annotations);
        return { count: annotations.length };
      });
    },
  };
}

export async function readViews() {
  const entries = await Promise.all(
    Object.keys(viewUris).map(async (pattern) => [
      pattern,
      await readFile(path.join(root, 'dist', `${pattern}.html`), 'utf8'),
    ]),
  );
  return Object.fromEntries(entries);
}

/**
 * @param {{ views: Record<string,string>, state?: ReturnType<typeof createFixtureState>,
 *   testAuth?: { verifier: object, resolvePrincipal: Function, grants: object,
 *   application: string, audience: string, policy: string } }} options
 */
export function createE13Handler({ views, state = createFixtureState(), testAuth }) {
  const bindings = [
    bindCapability(reviewOpen, {
      id: 'e13-review-open',
      targets: ['server'],
      execute: (_input, context) => state.review(context.caller),
    }),
    bindCapability(exploreOpen, {
      id: 'e13-explore-open',
      targets: ['server'],
      execute: ({ attempts = 3, rate = 0.07 }) => ({
        attempts,
        rate,
        chancePercent: chancePercent(attempts, rate),
      }),
    }),
    bindCapability(mediaOpen, {
      id: 'e13-media-open',
      targets: ['server'],
      execute: (_input, context) => state.media(context.caller),
    }),
    bindCapability(reviewSave, {
      id: 'e13-review-save',
      targets: ['server'],
      execute: (input, context) => state.saveReview(context.caller, input),
    }),
    bindCapability(annotationsSave, {
      id: 'e13-annotations-save',
      targets: ['server'],
      execute: (input, context) => state.saveAnnotations(context.caller, input),
    }),
  ];
  const registry = createCapabilityRegistry(capabilities, bindings);
  const presentations = new PresentationRegistry(
    capabilities.map((c) => canonicalCapabilityId(c.identity)),
    [
      [reviewOpen, 'review', 'Review queue'],
      [exploreOpen, 'explore', 'Probability explorer'],
      [mediaOpen, 'media', 'Media annotation'],
    ].map(([capability, pattern, name]) => ({
      capabilityId: canonicalCapabilityId(capability.identity),
      catalogId: UI_CATALOG_ID,
      resourceUri: viewUris[pattern],
      name,
    })),
  );
  const patternFor = Object.fromEntries(
    Object.entries(viewUris).map(([pattern, uri]) => [uri, pattern]),
  );
  const resources = presentations.resources(
    (presentation) => views[patternFor[presentation.resourceUri]],
  );
  if (testAuth === undefined) return createMcpAppsHandler(registry, { resources });
  const grantOptions = {
    applicationId: testAuth.application,
    audience: testAuth.audience,
    policyRevision: testAuth.policy,
    store: testAuth.grants,
    // Fixture records belong to the single test tenant.
    authorizeResource: (_request, principal) => principal.tenantId === 'tenant-a',
  };
  return createMcpAppsHandler(registry, {
    resources,
    bearerAuth: { verifier: testAuth.verifier, expectedResource: new URL(testAuth.audience) },
    resolveTrustedPrincipal: testAuth.resolvePrincipal,
    grantAuthorization: grantOptions,
    discoverProtected: async (definition, _request, authInfo) => {
      const principal = testAuth.resolvePrincipal(authInfo);
      const decision = await evaluateCapabilityDiscovery(
        definition,
        'mcp',
        {},
        async (candidate) =>
          principal !== null &&
          candidate.access.kind === 'protected' &&
          (await hasGrantForScopes({
            principal,
            applicationId: testAuth.application,
            audience: testAuth.audience,
            policyRevision: testAuth.policy,
            store: testAuth.grants,
            requiredScopes: candidate.access.scopes,
          })),
      );
      return decision.visible;
    },
  });
}

export async function listen(handler, { port = 0, host = '127.0.0.1' } = {}) {
  const server = createNodeServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const body = chunks.length === 0 ? undefined : Buffer.concat(chunks);
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) headers.set(key, value.join(', '));
        else if (value !== undefined) headers.set(key, value);
      }
      const response = await handler(
        new Request(new URL(incoming.url, `http://${host}`), {
          method: incoming.method,
          headers,
          ...(body === undefined ? {} : { body }),
        }),
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'fixture request failed' }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Listener failed.');
  return {
    origin: `http://${host}:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

// Anonymous, read-only fixture server for MCP hosts: `PORT=8787 npm run serve`.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const handler = createE13Handler({ views: await readViews() });
  const server = await listen(handler, { port: Number(process.env.PORT ?? 0) });
  process.stdout.write(`READY ${server.origin}/mcp\n`);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
