import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyInitPlan, createInitPlan, detectExistingProject, restoreInit } from '../dist/init.js';

const repositoryRoot = path.resolve(new URL('..', import.meta.url).pathname);
const baseline = path.join(repositoryRoot, 'examples/e01-album-catalog/site-before');
const onDemandBaseline = path.join(
  repositoryRoot,
  'examples/e02-astro-on-demand-catalog/site-before',
);
const nextBaseline = path.join(repositoryRoot, 'examples/e03-next-reading-list/site-before');
const choices = {
  hosting: 'cloudflare',
  sidecarOrigin: 'https://albums.example.workers.dev',
  routeMode: 'sidecar',
};

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'uan-init-'));
  const root = path.join(parent, 'site with spaces');
  await cp(baseline, root, { recursive: true });
  return { parent, root };
}

async function clean(parent) {
  await rm(parent, { recursive: true, force: true });
}

const originalAstro =
  "import { defineConfig } from 'astro/config';\n\nexport default defineConfig({\n  output: 'static',\n});\n";

test('E01 plan applies a static browser entry and sidecar setting, reruns as a no-op, then restores safely', async () => {
  const { parent, root } = await fixture();
  try {
    const lock = await readFile(path.join(root, 'package-lock.json'));
    const albums = await readFile(path.join(root, 'src/data/albums.mjs'));
    await writeFile(path.join(root, '.env.local'), 'LOCAL_CANARY=keep\n');
    const plan = await createInitPlan(root, {}, choices);
    assert.equal(plan.detection.framework, 'astro');
    assert.equal(plan.detection.rendering, 'static');
    assert.equal(plan.detection.packageManager, 'npm');
    assert.equal(plan.detection.hosting, 'unknown');
    assert.ok(plan.proposedFiles.includes('.agent-native/browser-entry.mjs'));
    assert.equal((await applyInitPlan(root, plan, choices, { approved: true })).status, 'applied');
    assert.match(await readFile(path.join(root, 'astro.config.mjs'), 'utf8'), /agentNativeAstro/);
    const bootstrap = await readFile(path.join(root, '.agent-native/browser-entry.mjs'), 'utf8');
    assert.match(bootstrap, /agent-native:ready/);
    assert.match(bootstrap, /albums\.example\.workers\.dev/);
    assert.deepEqual(await readFile(path.join(root, 'package-lock.json')), lock);
    assert.deepEqual(await readFile(path.join(root, 'src/data/albums.mjs')), albums);
    assert.equal(await readFile(path.join(root, '.env.local'), 'utf8'), 'LOCAL_CANARY=keep\n');
    const rerun = await createInitPlan(root, {}, choices);
    assert.equal(rerun.alreadyInitialized, true);
    assert.deepEqual(rerun.proposedFiles, []);
    assert.equal((await applyInitPlan(root, rerun, choices, { approved: true })).status, 'no-op');
    assert.equal((await restoreInit(root)).status, 'restored');
    assert.equal(await readFile(path.join(root, 'astro.config.mjs'), 'utf8'), originalAstro);
    assert.equal((await restoreInit(root)).status, 'no-op');
  } finally {
    await clean(parent);
  }
});

test('lockfile and monorepo ambiguity require explicit overrides; dynamic and unsupported host evidence stay unknown', async () => {
  const { parent, root } = await fixture();
  try {
    await writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    assert.ok((await detectExistingProject(root)).unresolved.includes('competing-lockfiles'));
    assert.equal(
      (await detectExistingProject(root, { packageManager: 'npm' })).packageManager,
      'npm',
    );
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['apps/*', 'sites/*'] }),
    );
    await mkdir(path.join(root, 'apps/site'), { recursive: true });
    await mkdir(path.join(root, 'sites/site'), { recursive: true });
    await cp(baseline, path.join(root, 'apps/site'), { recursive: true });
    await cp(baseline, path.join(root, 'sites/site'), { recursive: true });
    assert.ok(
      (await detectExistingProject(root)).unresolved.includes('application-root-ambiguous'),
    );
    assert.equal(
      (await detectExistingProject(root, { appRoot: 'apps/site', packageManager: 'npm' }))
        .applicationRoot,
      'apps/site',
    );
    await writeFile(path.join(root, 'firebase.json'), '{}');
    const unsupported = await detectExistingProject(root, {
      appRoot: 'apps/site',
      packageManager: 'npm',
    });
    assert.equal(unsupported.hosting, 'unknown');
    assert.ok(unsupported.unresolved.includes('unsupported-host-config'));
    await writeFile(
      path.join(root, 'apps/site/astro.config.mjs'),
      "import { defineConfig } from 'astro/config';\nexport default defineConfig({ output: process.env.OUTPUT });\n",
    );
    assert.ok(
      (
        await detectExistingProject(root, { appRoot: 'apps/site', packageManager: 'npm' })
      ).unresolved.includes('dynamic-config-unsupported'),
    );
  } finally {
    await clean(parent);
  }
});

test('Astro detection distinguishes on-demand output, adapters, and static protocol impostors', async () => {
  const detection = await detectExistingProject(onDemandBaseline);
  assert.equal(detection.rendering, 'on-demand');
  assert.equal(detection.serverAdapter, true);
  assert.deepEqual(detection.onDemandRoutes, ['api/albums/[slug].json.js']);
  assert.deepEqual(detection.staticProtocolFiles, []);
  assert.equal(detection.unresolved.includes('server-adapter-missing'), false);

  const { parent, root } = await fixture();
  try {
    await mkdir(path.join(root, 'src/pages/api'), { recursive: true });
    await writeFile(
      path.join(root, 'src/pages/api/live.js'),
      'export const prerender = false;\nexport const POST = ({ request }) => new Response(request.method);\n',
    );
    await mkdir(path.join(root, 'public'), { recursive: true });
    await writeFile(path.join(root, 'public/mcp.json'), '{"jsonrpc":"2.0"}\n');
    const unsafe = await detectExistingProject(root);
    assert.equal(unsafe.rendering, 'on-demand');
    assert.equal(unsafe.serverAdapter, false);
    assert.deepEqual(unsafe.staticProtocolFiles, ['public/mcp.json']);
    assert.ok(unsafe.unresolved.includes('server-adapter-missing'));
    assert.ok(unsafe.unresolved.includes('static-protocol-endpoint'));
    const plan = await createInitPlan(root, {}, { ...choices, routeMode: 'same-origin' });
    await assert.rejects(
      applyInitPlan(root, plan, { ...choices, routeMode: 'same-origin' }, { approved: true }),
      /server-adapter-missing|static-protocol-endpoint/,
    );
  } finally {
    await clean(parent);
  }
});

test('stale /mcp route evidence and same-origin collision stop apply before writes', async () => {
  const { parent, root } = await fixture();
  try {
    const stale = await createInitPlan(root, {}, choices);
    await mkdir(path.join(root, 'src/pages/mcp'), { recursive: true });
    await writeFile(
      path.join(root, 'src/pages/mcp/index.ts'),
      'export const GET = () => new Response();\n',
    );
    await assert.rejects(
      applyInitPlan(root, stale, choices, { approved: true }),
      /evidence changed after plan creation/,
    );
    const plan = await createInitPlan(root, {}, { ...choices, routeMode: 'same-origin' });
    await assert.rejects(
      applyInitPlan(root, plan, { ...choices, routeMode: 'same-origin' }, { approved: true }),
      /static-protocol-endpoint/,
    );
    assert.equal(await readFile(path.join(root, 'astro.config.mjs'), 'utf8'), originalAstro);
  } finally {
    await clean(parent);
  }
});

test('pure static init accepts sidecar mode but rejects a same-origin endpoint choice', async () => {
  const { parent, root } = await fixture();
  try {
    const sameOrigin = { ...choices, routeMode: 'same-origin' };
    const plan = await createInitPlan(root, {}, sameOrigin);
    await assert.rejects(
      applyInitPlan(root, plan, sameOrigin, { approved: true }),
      /choose sidecar for a static site/,
    );
    assert.equal(await readFile(path.join(root, 'astro.config.mjs'), 'utf8'), originalAstro);
  } finally {
    await clean(parent);
  }
});

test('Next inspection plans manual integration and reports route conflicts without edits', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'uan-next-init-'));
  const root = path.join(parent, 'existing next site');
  await cp(nextBaseline, root, { recursive: true });
  try {
    const layoutBefore = await readFile(path.join(root, 'app/layout.js'));
    const authBefore = await readFile(path.join(root, 'lib/fixture-identity.js'));
    const catalogRouteBefore = await readFile(path.join(root, 'app/api/catalog/route.js'));
    const savedListRouteBefore = await readFile(path.join(root, 'app/api/saved-list/route.js'));
    const detection = await detectExistingProject(root);
    assert.equal(detection.framework, 'next');
    assert.equal(detection.rendering, 'server');
    assert.equal(detection.routeConflict, false);
    assert.ok(detection.evidence.includes('package.json: Next dependency'));

    await mkdir(path.join(root, 'app/mcp'), { recursive: true });
    await writeFile(path.join(root, 'app/mcp/route.js'), 'export function POST() {}\n');
    const plan = await createInitPlan(
      root,
      {},
      {
        hosting: 'vercel',
        routeMode: 'same-origin',
      },
    );
    assert.equal(plan.detection.framework, 'next');
    assert.equal(plan.detection.routeConflict, true);
    assert.deepEqual(plan.proposedFiles, []);
    assert.equal(plan.conflicts.length, 1);
    assert.match(plan.manualIntegration, /no files are proposed/i);
    assert.deepEqual(await readFile(path.join(root, 'app/layout.js')), layoutBefore);
    assert.deepEqual(await readFile(path.join(root, 'lib/fixture-identity.js')), authBefore);
    assert.deepEqual(
      await readFile(path.join(root, 'app/api/catalog/route.js')),
      catalogRouteBefore,
    );
    assert.deepEqual(
      await readFile(path.join(root, 'app/api/saved-list/route.js')),
      savedListRouteBefore,
    );
  } finally {
    await clean(parent);
  }
});

test('interrupted apply resumes; restore reports a later human edit without deleting it', async () => {
  const { parent, root } = await fixture();
  try {
    const plan = await createInitPlan(root, {}, choices);
    await assert.rejects(
      applyInitPlan(root, plan, choices, { approved: true, failAfterWrites: 1 }),
      /simulated interrupted init/,
    );
    assert.equal((await applyInitPlan(root, plan, choices, { approved: true })).status, 'applied');
    await writeFile(path.join(root, '.agent-native/browser-entry.mjs'), '// human edit\n');
    const result = await restoreInit(root);
    assert.equal(result.status, 'conflict');
    assert.equal(
      await readFile(path.join(root, '.agent-native/browser-entry.mjs'), 'utf8'),
      '// human edit\n',
    );
  } finally {
    await clean(parent);
  }
});

test('interrupted apply resumes after the Astro config patch is written', async () => {
  const { parent, root } = await fixture();
  try {
    const plan = await createInitPlan(root, {}, choices);
    await assert.rejects(
      applyInitPlan(root, plan, choices, { approved: true, failAfterWrites: 3 }),
      /simulated interrupted init/,
    );
    const interruptedConfig = await readFile(path.join(root, 'astro.config.mjs'), 'utf8');
    assert.match(interruptedConfig, /agentNativeAstro/);
    assert.equal((await applyInitPlan(root, plan, choices, { approved: true })).status, 'applied');
    assert.equal(await readFile(path.join(root, 'astro.config.mjs'), 'utf8'), interruptedConfig);
    assert.equal(
      JSON.parse(await readFile(path.join(root, '.agent-native/ownership.json'), 'utf8')).status,
      'applied',
    );
  } finally {
    await clean(parent);
  }
});

test('tampered ownership paths, preimages, and hashes are rejected before restore', async () => {
  const { parent, root } = await fixture();
  try {
    const plan = await createInitPlan(root, {}, choices);
    await applyInitPlan(root, plan, choices, { approved: true });
    const ownershipPath = path.join(root, '.agent-native/ownership.json');
    const original = JSON.parse(await readFile(ownershipPath, 'utf8'));
    const unsafePath = structuredClone(original);
    unsafePath.files['src/data/albums.mjs'] = unsafePath.files['.agent-native/browser-entry.mjs'];
    await writeFile(ownershipPath, JSON.stringify(unsafePath));
    await assert.rejects(restoreInit(root), /unexpected paths/);
    const missingPreimage = structuredClone(original);
    delete missingPreimage.files['astro.config.mjs'].beforeContent;
    await writeFile(ownershipPath, JSON.stringify(missingPreimage));
    await assert.rejects(restoreInit(root), /retain every overwritten preimage/);
    const badHash = structuredClone(original);
    badHash.files['astro.config.mjs'].afterSha256 = createHash('sha256')
      .update('export default {};')
      .digest('hex');
    await writeFile(ownershipPath, JSON.stringify(badHash));
    await assert.rejects(restoreInit(root), /output digest does not match generated file/);
    assert.match(await readFile(path.join(root, 'astro.config.mjs'), 'utf8'), /agentNativeAstro/);
  } finally {
    await clean(parent);
  }
});

test('symlinked tool-owned directories cannot redirect writes outside the project', async () => {
  const { parent, root } = await fixture();
  try {
    const plan = await createInitPlan(root, {}, choices);
    const outside = path.join(parent, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(root, '.agent-native'), 'dir');
    await assert.rejects(applyInitPlan(root, plan, choices, { approved: true }), /symlink/);
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await clean(parent);
  }
});

test('injected target mutations are caught before create or replace', async () => {
  const { parent, root } = await fixture();
  try {
    const plan = await createInitPlan(root, {}, choices);
    await assert.rejects(
      applyInitPlan(root, plan, choices, {
        approved: true,
        beforeTargetWrite: async (relative) => {
          if (relative !== '.agent-native/browser-entry.mjs') return;
          await mkdir(path.join(root, '.agent-native'), { recursive: true });
          await writeFile(path.join(root, relative), '// concurrent file\n');
        },
      }),
      /created after plan/,
    );
    assert.equal(
      await readFile(path.join(root, '.agent-native/browser-entry.mjs'), 'utf8'),
      '// concurrent file\n',
    );
  } finally {
    await clean(parent);
  }

  const second = await fixture();
  try {
    const plan = await createInitPlan(second.root, {}, choices);
    const changed =
      "import { defineConfig } from 'astro/config';\nexport default defineConfig({ output: process.env.OUTPUT });\n";
    await assert.rejects(
      applyInitPlan(second.root, plan, choices, {
        approved: true,
        beforeTargetWrite: async (relative) => {
          if (relative === 'astro.config.mjs')
            await writeFile(path.join(second.root, relative), changed);
        },
      }),
      /changed after plan/,
    );
    assert.equal(await readFile(path.join(second.root, 'astro.config.mjs'), 'utf8'), changed);
  } finally {
    await clean(second.parent);
  }
});

test('restore rechecks tool-owned files immediately before removal', async () => {
  const { parent, root } = await fixture();
  try {
    const plan = await createInitPlan(root, {}, choices);
    await applyInitPlan(root, plan, choices, { approved: true });
    const result = await restoreInit(root, {
      beforeTargetRestore: async (relative) => {
        if (relative === '.agent-native/browser-entry.mjs')
          await writeFile(path.join(root, relative), '// changed during restore\n');
      },
    });
    assert.equal(result.status, 'conflict');
    assert.equal(
      await readFile(path.join(root, '.agent-native/browser-entry.mjs'), 'utf8'),
      '// changed during restore\n',
    );
  } finally {
    await clean(parent);
  }
});

test('default detection and plan do not create files or invoke a provisioning canary', async () => {
  const { parent, root } = await fixture();
  try {
    const sentinel = path.join(root, 'PROVISIONING_CANARY_DO_NOT_RUN');
    const before = await readdir(root);
    const configBefore = await readFile(path.join(root, 'astro.config.mjs'));
    const lockBefore = await readFile(path.join(root, 'package-lock.json'));
    await detectExistingProject(root);
    const plan = await createInitPlan(root, {}, choices);
    assert.equal(plan.alreadyInitialized, false);
    assert.deepEqual(await readdir(root), before);
    assert.deepEqual(await readFile(path.join(root, 'astro.config.mjs')), configBefore);
    assert.deepEqual(await readFile(path.join(root, 'package-lock.json')), lockBefore);
    await assert.rejects(readFile(sentinel), { code: 'ENOENT' });
  } finally {
    await clean(parent);
  }
});
