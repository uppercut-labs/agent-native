import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inside = (dir, file) => file.startsWith(dir + path.sep);

async function inspect(root, file, directory = false) {
  const parts = path.relative(root, file).split(path.sep);
  let current = root;
  try {
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      const stat = await lstat(current);
      if (directory || index < parts.length - 1) {
        if (!stat.isDirectory()) throw Error('Unsafe fixture directory');
      } else if (!stat.isFile() || stat.nlink !== 1) throw Error('Unsafe fixture file');
    }
    if (directory) return true;
    // Open the file without following a replaced final symlink.
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1) throw Error('Unsafe fixture file');
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function install(root, file, bytes, prior, mode) {
  if ((await realpath(root)) !== root) throw Error('Unsafe fixture root');
  await inspect(root, path.dirname(file), true);
  // Stage beside the destination so installation is atomic across mount boundaries.
  const staged = path.join(path.dirname(file), '.fixture-' + randomUUID());
  await writeFile(staged, bytes, { flag: 'wx', mode });
  try {
    const now = await inspect(root, file);
    if ((now === null ? null : digest(now)) !== prior) throw Error('Modified fixture file');
    if (prior === null)
      await link(staged, file); // Exclusive creation, including dangling symlinks.
    else {
      await rename(staged, file); // Replaces a directory entry without opening its target.
      return;
    }
  } finally {
    await unlink(staged).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export async function writeFixtureFiles({
  appDir,
  assetDir,
  modelFile,
  input,
  model,
  witness,
  publicFiles = {},
  publish,
}) {
  const root = path.resolve(appDir);
  if ((await realpath(root)) !== root) throw Error('Unsafe fixture root');
  const generated = path.join(root, 'generated');
  const state = path.join(generated, '.ownership');
  const out = path.resolve(root, assetDir);
  const modelPath = path.resolve(root, modelFile);
  const manifest = path.join(generated, 'manifest.json');
  if (
    !inside(root, out) ||
    out === generated ||
    inside(out, generated) ||
    inside(generated, out) ||
    !inside(generated, modelPath) ||
    modelPath === state ||
    inside(state, modelPath) ||
    modelPath === manifest ||
    inside(manifest, modelPath) ||
    inside(modelPath, manifest)
  ) {
    throw Error('Overlapping or outside fixture paths');
  }
  const outputs = [
    { file: manifest, bytes: input, mode: 0o600 },
    { file: modelPath, bytes: model, mode: 0o600 },
    { file: path.join(out, 'agent-native-witness.json'), bytes: witness, mode: 0o644 },
    // Site-owned public files beside the publication, such as an undeclared protocol endpoint.
    ...Object.entries(publicFiles).map(([name, bytes]) => {
      const file = path.resolve(out, name);
      if (!inside(out, file) || file === path.join(out, 'agent-native-witness.json')) {
        throw Error('Overlapping or outside fixture paths');
      }
      return { file, bytes, mode: 0o644 };
    }),
  ];
  const journal = path.join(state, 'fixture-files.json');
  const lock = path.join(state, 'fixture.lock');
  const keys = outputs.map(({ file }) => path.relative(root, file));
  async function preflight() {
    if ((await realpath(root)) !== root) throw Error('Unsafe fixture root');
    const record = await inspect(root, journal);
    let hashes = {};
    if (record !== null) {
      const parsed = JSON.parse(record);
      if (
        parsed.version !== 1 ||
        parsed.root !== root ||
        !parsed.files ||
        // A journal from an earlier fixture revision may predate newly owned outputs.
        // Those outputs must then be absent, which the per-file check below enforces.
        !Object.keys(parsed.files).every((key) => keys.includes(key)) ||
        !Object.values(parsed.files).every(
          (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value),
        )
      ) {
        throw Error('Invalid fixture ownership journal');
      }
      hashes = parsed.files;
    }
    for (const [index, { file }] of outputs.entries()) {
      const before = await inspect(root, file);
      const actual = before === null ? null : digest(before);
      if (actual !== (hashes[keys[index]] ?? null)) throw Error('Unowned or modified fixture file');
    }
    return { hashes, journalHash: record === null ? null : digest(record) };
  }
  // Reject unsafe target paths, existing owner files, and overlapping roots before creating even private inputs.
  await preflight();
  await inspect(root, out, true);
  await inspect(root, state, true);
  if ((await inspect(root, lock)) !== null) throw Error('Fixture build already locked');
  await mkdir(state, { recursive: true, mode: 0o700 });
  await writeFile(lock, '', { flag: 'wx', mode: 0o600 });
  try {
    const { hashes, journalHash } = await preflight();
    await mkdir(out, { recursive: true });
    await mkdir(path.dirname(modelPath), { recursive: true, mode: 0o700 });
    // The generic CLI needs a private input. Publish from a new private file, keeping prior manifests intact on conflicts.
    const temporaryManifest = path.join(state, 'input-' + randomUUID() + '.json');
    await writeFile(temporaryManifest, input, { flag: 'wx', mode: 0o600 });
    try {
      await publish({ manifest: temporaryManifest, out, state });
    } finally {
      await unlink(temporaryManifest);
    }
    const next = {};
    for (const [index, { file, bytes, mode }] of outputs.entries()) {
      const key = keys[index];
      next[key] = digest(bytes);
      if (next[key] !== hashes[key]) await install(root, file, bytes, hashes[key] ?? null, mode);
    }
    const ledger = JSON.stringify({ version: 1, root, files: next });
    if (digest(ledger) !== journalHash) await install(root, journal, ledger, journalHash, 0o600);
  } finally {
    await unlink(lock);
  }
}
