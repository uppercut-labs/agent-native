import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromZod } from '../dist/adapters/zod.js';
import { bindCapability, createCapabilityRegistry, defineCapability } from '../dist/index.js';
import { validateMcpAppResources } from '../dist/mcp-apps.js';
import * as z from 'zod';

const definition = defineCapability({
  identity: { namespace: 'example.security', name: 'read', majorVersion: 1 },
  description: 'Read a safe sample value.',
  input: fromZod(z.object({})),
  output: fromZod(z.object({ ok: z.boolean() })),
  risk: 'read',
  access: { kind: 'public' },
});
const binding = bindCapability(definition, {
  id: 'security-read',
  targets: ['server'],
  execute: async () => ({ ok: true }),
});
const registry = createCapabilityRegistry([definition], [binding]);

function resource(html) {
  return {
    capabilityId: 'example.security:read@1',
    uri: 'ui://example.security/read.html',
    name: 'Read view',
    html,
  };
}

test('MCP App rejects unquoted external script and image resources', () => {
  for (const html of [
    '<script src=https://outside.example.invalid/app.js></script>',
    '<img src=http://outside.example.invalid/pixel>',
    '<img src=//outside.example.invalid/pixel>',
    '<script src = "https://outside.example.invalid/app.js"></script>',
    '<script src=&#x68;ttps://outside.example.invalid/app.js></script>',
    '<script src="&#x2f;&#x2f;outside.example.invalid/app.js"></script>',
    '<img alt=">" src=&#x68;ttps://outside.example.invalid/pixel>',
    '<img srcset="./bundled.png 1x, https://outside.example.invalid/pixel 2x">',
    '<form action=https://outside.example.invalid/submit></form>',
    '<base href=//outside.example.invalid/>',
    '<meta http-equiv="refresh" content="0;url=https://outside.example.invalid/">',
    '<style>body{background:url(https://outside.example.invalid/x.png)}</style>',
    '<style>body{background:url(\\68 ttps://outside.example.invalid/x.png)}</style>',
    '<div style="background:url(https://outside.example.invalid/x.png)"></div>',
    '<div style="background:u\\72l(https://outside.example.invalid/x.png)"></div>',
  ]) {
    assert.throws(
      () => validateMcpAppResources(registry, [resource(html)]),
      /external origins/i,
      html,
    );
  }
  assert.equal(
    validateMcpAppResources(registry, [resource('<script src="./bundled.js"></script>')]).length,
    1,
  );
  assert.equal(
    validateMcpAppResources(registry, [resource('<div style="color:red"></div>')]).length,
    1,
  );
});

test('MCP App validation snapshots resource fields before later caller mutation', () => {
  const supplied = resource('<main>Bundled view</main>');
  const callerResources = [supplied];
  const reviewed = validateMcpAppResources(registry, callerResources);
  supplied.html = '<script src=https://outside.example.invalid/app.js></script>';
  callerResources.push(resource('<img src=https://outside.example.invalid/pixel>'));
  assert.equal(reviewed.length, 1);
  assert.equal(reviewed[0].html, '<main>Bundled view</main>');
  assert.equal(Object.isFrozen(reviewed), true);
  assert.equal(Object.isFrozen(reviewed[0]), true);
  assert.throws(() => {
    reviewed[0].html = supplied.html;
  }, TypeError);
});
