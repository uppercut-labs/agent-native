import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

test('the established command and short alias share the search function', () => {
  const full = spawnSync(process.execPath, [cli, 'content-search', 'night'], {
    encoding: 'utf8',
  });
  const alias = spawnSync(process.execPath, [cli, 'search', 'night'], {
    encoding: 'utf8',
  });

  assert.equal(full.status, 0);
  assert.equal(alias.status, 0);
  assert.equal(alias.stdout, full.stdout);
  assert.deepEqual(
    JSON.parse(alias.stdout).results.map(({ slug }) => slug),
    ['night-drive', 'night-market'],
  );
});

test('the CLI rejects invalid input with a nonzero exit', () => {
  const invalid = spawnSync(process.execPath, [cli, 'search', ''], {
    encoding: 'utf8',
  });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /query must be/);
  assert.equal(invalid.stdout, '');

  const unknown = spawnSync(process.execPath, [cli, 'unknown', 'night'], {
    encoding: 'utf8',
  });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /usage:/);
});
