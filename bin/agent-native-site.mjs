#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { planPublication, safePublicationPath } from '@uppercut-labs/agent-native/publication';
import { discoverRoutes } from './discover-routes.mjs';
import { verifyProtocol, verifyPublication } from './verify-publication.mjs';

const help =
  'agent-native-site discover --framework NAME --project DIR [--routes TABLE.json]  |  agent-native-site <preview|apply|restore-preview|restore|verify> --manifest FILE [--out EXISTING_DIR --state EXISTING_PRIVATE_DIR] [--approve DIGEST]';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code, detail) => {
  throw Object.assign(new Error(code), { diagnostic: code, detail });
};

async function optional(read) {
  try {
    return await read();
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function within(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

// Reject symlinks in existing components, including a symlink at the leaf.
// The caller supplies a canonical root and relative names produced by the engine.
async function inspect(root, name) {
  if (!safePublicationPath(name)) fail('unsafe-path', name);
  const segments = name.split('/');
  let location = root;
  for (const [i, segment] of segments.entries()) {
    location = path.join(location, segment);
    const stat = await optional(() => lstat(location));
    if (!stat) return null;
    if (stat.isSymbolicLink() || (i === segments.length - 1 ? !stat.isFile() : !stat.isDirectory()))
      fail('unsafe-path', name);
  }
  return readFile(location);
}

async function readJournal(file, out) {
  const stat = await optional(() => lstat(file));
  if (!stat) return {};
  if (!stat.isFile() || stat.isSymbolicLink()) fail('invalid-journal');
  const record = JSON.parse(await readFile(file, 'utf8'));
  if (
    record.version !== 1 ||
    record.out !== out ||
    !record.files ||
    Array.isArray(record.files) ||
    typeof record.files !== 'object'
  )
    fail('invalid-journal');
  for (const [name, digest] of Object.entries(record.files)) {
    if (!safePublicationPath(name) || !/^[a-f0-9]{64}$/.test(digest)) fail('invalid-journal');
  }
  return record.files;
}

async function snapshot(out, state, plan, restore) {
  const journal = await readJournal(path.join(state, 'ownership.json'), out);
  const assets = new Map((restore ? [] : plan.assets).map((a) => [a.path, a]));
  const changes = [],
    conflicts = [],
    backup = new Map();
  for (const name of [...new Set([...Object.keys(journal), ...assets.keys()])].sort()) {
    const bytes = await inspect(out, name);
    const before = bytes === null ? null : hash(bytes);
    const owned = Object.hasOwn(journal, name);
    if (owned ? before !== journal[name] : before !== null) {
      conflicts.push(name);
      continue;
    }
    const after = assets.get(name)?.digest ?? null;
    if (after === before) continue;
    backup.set(name, bytes);
    changes.push({ path: name, before, after });
  }
  const digest = hash(
    JSON.stringify([
      restore ? 'restore' : 'apply',
      plan.digest,
      out,
      state,
      journal,
      changes,
      conflicts,
    ]),
  );
  return { digest, changes, conflicts, backup, assets };
}

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      manifest: { type: 'string' },
      framework: { type: 'string' },
      project: { type: 'string' },
      routes: { type: 'string' },
      out: { type: 'string' },
      state: { type: 'string' },
      approve: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || argv.length === 0) return { usage: help };
  const [command] = positionals;
  if (command === 'discover' && positionals.length === 1 && values.framework && values.project) {
    return discoverRoutes(values.framework, values.project, values.routes);
  }
  if (
    positionals.length !== 1 ||
    !['preview', 'apply', 'restore-preview', 'restore', 'verify'].includes(command) ||
    !values.manifest
  )
    fail('invalid-usage', help);
  const manifestFile = await realpath(values.manifest);
  const input = JSON.parse(await readFile(manifestFile, 'utf8'));
  const restore = command === 'restore' || command === 'restore-preview';
  const plan = await planPublication(input.config, input.candidates, { verifyProtocol });
  if (!restore && plan.diagnostics.some((d) => d.severity === 'error'))
    fail('invalid-publication', plan.diagnostics);
  if (command === 'verify')
    return verifyPublication(plan, input.config, input.verify, input.candidates);
  if (!values.out || !values.state) fail('invalid-usage', help);
  const [out, state] = await Promise.all([realpath(values.out), realpath(values.state)]);
  if (
    !(await lstat(out)).isDirectory() ||
    !(await lstat(state)).isDirectory() ||
    within(out, state) ||
    within(state, out) ||
    within(out, manifestFile)
  )
    fail('invalid-roots');
  const preview = command === 'preview' || command === 'restore-preview';
  if (preview) {
    const { digest, changes, conflicts } = await snapshot(out, state, plan, restore);
    return {
      status: conflicts.length ? 'conflict' : 'preview',
      digest,
      changes,
      conflicts,
      manifest: plan.manifest,
      diagnostics: plan.diagnostics,
    };
  }
  if (!values.approve) fail('approval-required');
  const lock = path.join(state, 'publication.lock');
  try {
    await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') fail('publication-locked');
    throw error;
  }
  let releaseLock = true;
  try {
    const { digest, changes, conflicts, backup, assets } = await snapshot(
      out,
      state,
      plan,
      restore,
    );
    if (conflicts.length) fail('ownership-conflict', conflicts);
    if (digest !== values.approve) fail('stale-approval');
    if (!changes.length) return { status: 'no-op', digest };
    const pending = path.join(state, 'pending.json');
    const priorFiles = await readJournal(path.join(state, 'ownership.json'), out);
    try {
      await writeFile(
        pending,
        JSON.stringify({
          version: 1,
          out,
          digest,
          priorFiles,
          changes: changes.map((change) => ({
            ...change,
            original: backup.get(change.path)?.toString('base64') ?? null,
          })),
        }),
        { flag: 'wx', mode: 0o600, flush: true },
      );
    } catch (error) {
      if (error.code === 'EEXIST') fail('recovery-required');
      throw error;
    }
    const applied = [];
    const journal = path.join(state, 'ownership.json');
    const tempJournal = path.join(state, `${randomUUID()}.tmp`);
    try {
      for (const change of changes) {
        const dest = path.join(out, change.path);
        const prior = await inspect(out, change.path);
        if ((prior === null ? null : hash(prior)) !== change.before)
          fail('stale-file', change.path);
        const next = assets.get(change.path);
        if (prior !== null) await unlink(dest);
        applied.push(change);
        if (next) {
          await mkdir(path.dirname(dest), { recursive: true });
          await writeFile(dest, next.content, { flag: 'wx' });
        }
      }
      const files = Object.fromEntries(
        [...assets]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([name, asset]) => [name, asset.digest]),
      );
      await writeFile(
        tempJournal,
        JSON.stringify({ version: 1, out, files, transaction: digest }),
        {
          flag: 'wx',
          mode: 0o600,
        },
      );
      await rename(tempJournal, journal);
    } catch (error) {
      await optional(() => unlink(tempJournal));
      for (const change of applied.reverse()) {
        try {
          const current = await inspect(out, change.path);
          if (current !== null) {
            if (hash(current) !== change.after) fail('rollback-conflict', change.path);
            await unlink(path.join(out, change.path));
          }
          const original = backup.get(change.path);
          if (original !== null)
            await writeFile(path.join(out, change.path), original, { flag: 'wx' });
        } catch (recoveryError) {
          releaseLock = false;
          throw recoveryError;
        }
      }
      await unlink(pending);
      throw error;
    }
    await unlink(pending);
    return { status: restore ? 'restored' : 'applied', digest, changes };
  } finally {
    if (releaseLock) await unlink(lock);
  }
}

try {
  const result = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === 'conflict' || result.status === 'failed') process.exitCode = 1;
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      status: 'failed',
      code: error.diagnostic ?? error.code ?? 'invalid-input',
      detail: error.detail,
    })}\n`,
  );
  process.exitCode = 1;
}
