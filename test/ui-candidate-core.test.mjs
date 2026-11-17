import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UiStore,
  CatalogRegistry,
  defaultCatalog,
  UI_CATALOG_ID,
  JsonlDecoder,
} from '../dist/ui.js';
import {
  reviewQueue,
  parameterExplorer,
  mediaAnnotation,
  validReviewInput,
  validAnnotationInput,
} from '../dist/ui-patterns.js';
import {
  createMcpActionPort,
  presentationResult,
  receiveToolResult,
  selectionContext,
} from '../dist/ui-mcp.js';
import { readAt, writeAt, same } from '../dist/ui/json.js';

const create = (
  data = { name: 'old' },
  components = [{ id: 'root', component: 'Text', text: { '@path': '/name' } }],
  id = 's',
) => ({
  version: '1.0',
  createSurface: { surfaceId: id, catalogId: UI_CATALOG_ID, components, dataModel: data },
});
const update = (path, value, id = 's') => ({
  version: '1.0',
  updateDataModel: { surfaceId: id, path, value },
});
const button = {
  id: 'root',
  component: 'Button',
  label: 'Save',
  action: { event: { name: 'save', context: { name: { '@path': '/name' } } } },
};
let sequence = 0;
const actionStore = (execute, extra = {}) => {
  const store = new UiStore({
    actions: [
      {
        name: 'save',
        capabilityId: 'demo:save@1',
        risk: 'write',
        validate: (input) => typeof input.name === 'string',
      },
    ],
    actionPort: { execute },
    requestId: () => `request_${++sequence}`,
    ...extra,
  });
  assert.equal(store.apply(create({ name: 'old' }, [button])).kind, 'applied');
  return store;
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

test('default catalog includes all three families', () => {
  const names = defaultCatalog().components.map((c) => c.name);
  for (const name of [
    'Table',
    'Diff',
    'Slider',
    'Chart',
    'Audio',
    'Video',
    'Timeline',
    'Transcript',
    'Annotations',
  ])
    assert(names.includes(name));
  assert.equal(names.length, new Set(names).size);
});
test('inline surface creation and incremental component replacement', () => {
  const s = new UiStore();
  assert.equal(s.apply(create()).kind, 'applied');
  assert.equal(s.read('s', '/name'), 'old');
  assert.equal(
    s.apply({
      version: '1.0',
      updateComponents: {
        surfaceId: 's',
        components: [{ id: 'root', component: 'Text', text: 'new' }],
      },
    }).kind,
    'applied',
  );
  assert.equal(s.snapshot('s').components.get('root').text, 'new');
});
test('A2UI slash and omitted update paths replace the root', () => {
  const s = new UiStore();
  s.apply(create());
  s.apply(update('/', { fresh: 2 }));
  assert.deepEqual(s.data('s'), { fresh: 2 });
  s.apply({ version: '1.0', updateDataModel: { surfaceId: 's', value: { third: 3 } } });
  assert.deepEqual(s.data('s'), { third: 3 });
  assert.deepEqual(s.read('s', '/'), { third: 3 });
});
test('A2UI null deletes a key; root null clears model', () => {
  const s = new UiStore();
  s.apply(create({ a: 1, b: 2 }));
  s.apply(update('/a', null));
  assert.deepEqual(s.data('s'), { b: 2 });
  s.apply(update('/', null));
  assert.deepEqual(s.data('s'), {});
});
test('missing value is rejected without deleting anything', () => {
  const s = new UiStore();
  s.apply(create());
  assert.equal(
    s.apply({ version: '1.0', updateDataModel: { surfaceId: 's', path: '/name' } }).kind,
    'rejected',
  );
  assert.equal(s.read('s', '/name'), 'old');
});
test('duplicate surface and unknown surface mutations are rejected', () => {
  const s = new UiStore();
  s.apply(create());
  assert.equal(s.apply(create()).kind, 'rejected');
  assert.equal(s.apply(update('/name', 'x', 'other')).kind, 'rejected');
});
test('malformed envelopes, unsupported versions and removed theme are rejected', () => {
  const s = new UiStore();
  for (const message of [
    {},
    { version: '0.9' },
    { ...create(), deleteSurface: { surfaceId: 's' } },
    {
      version: '1.0',
      createSurface: { ...create().createSurface, theme: { primaryColor: 'red' } },
    },
  ])
    assert.equal(s.apply(message).kind, 'rejected');
});
test('unknown components and executable props are not accepted', () => {
  for (const c of [
    { id: 'root', component: 'Script', text: 'alert(1)' },
    { id: 'root', component: 'Text', text: 'x', onClick: 'alert(1)' },
    { id: 'root', component: 'Text', text: 'x', dangerouslySetInnerHTML: { __html: 'x' } },
  ]) {
    const s = new UiStore();
    assert.equal(s.apply(create({}, [c])).kind, 'rejected');
    assert.equal(s.ids().length, 0);
  }
});
test('Unicode entity identifiers work; hyphens and reserved names are rejected', () => {
  const s = new UiStore();
  assert.equal(
    s.apply(
      create({}, [
        { id: 'root', component: 'Column', children: ['名字'] },
        { id: '名字', component: 'Text', text: 'hello' },
      ]),
    ).kind,
    'applied',
  );
  for (const id of ['bad-id', '1bad', '__proto__'])
    assert.equal(
      new UiStore().apply(create({}, [{ id, component: 'Text', text: 'x' }])).kind,
      'rejected',
    );
});
test('duplicate component IDs are rejected atomically', () => {
  const s = new UiStore();
  s.apply(create());
  assert.equal(
    s.apply({
      version: '1.0',
      updateComponents: {
        surfaceId: 's',
        components: [
          { id: 'root', component: 'Text', text: 'a' },
          { id: 'root', component: 'Text', text: 'b' },
        ],
      },
    }).kind,
    'rejected',
  );
  assert.deepEqual(s.snapshot('s').components.get('root').text, { '@path': '/name' });
});
test('progressive missing children are allowed; cycles are not', () => {
  const s = new UiStore();
  s.apply(create({}, [{ id: 'root', component: 'Column', children: ['later'] }]));
  assert.equal(
    s.apply({
      version: '1.0',
      updateComponents: {
        surfaceId: 's',
        components: [{ id: 'later', component: 'Column', children: ['root'] }],
      },
    }).kind,
    'rejected',
  );
  assert.equal(s.snapshot('s').components.size, 1);
});
test('highly shared DAG validation is bounded', () => {
  const components = [{ id: 'leaf', component: 'Text', text: 'x' }];
  let prev = 'leaf';
  for (let n = 0; n < 20; n++) {
    const id = n === 19 ? 'root' : `n${n}`;
    components.push({ id, component: 'Column', children: [prev, prev, prev, prev] });
    prev = id;
  }
  const s = new UiStore();
  assert.equal(s.apply(create({}, components)).kind, 'applied');
});
test('message, surface and component limits are enforced', () => {
  const s = new UiStore({ limits: { maxMessageBytes: 2000, maxSurfaces: 1, maxComponents: 2 } });
  s.apply(create());
  assert.equal(s.apply(create({}, undefined, 's2')).kind, 'rejected');
  assert.equal(s.apply(update('/name', 'x'.repeat(3000))).kind, 'rejected');
  assert.equal(
    s.apply(
      create(
        {},
        [
          { id: 'root', component: 'Text', text: 'x' },
          { id: 'b', component: 'Text', text: 'x' },
          { id: 'c', component: 'Text', text: 'x' },
        ],
        'other',
      ),
    ).kind,
    'rejected',
  );
});
test('prototype payloads and pointer traversal are rejected', () => {
  const s = new UiStore();
  s.apply(create());
  for (const path of ['/__proto__/polluted', '/constructor/prototype/x', '/a/~2b'])
    assert.equal(s.apply(update(path, 1)).kind, 'rejected');
  assert.equal(
    s.apply(
      JSON.parse(
        '{"version":"1.0","updateDataModel":{"surfaceId":"s","path":"/name","value":{"__proto__":{"polluted":true}}}}',
      ),
    ).kind,
    'rejected',
  );
  assert.equal({}.polluted, undefined);
});
test('pointer escaping, arrays and equality are deterministic', () => {
  const data = { 'a/b': { '~x': 2 }, list: [1, 2] };
  assert.equal(readAt(data, '/a~1b/~0x'), 2);
  assert.deepEqual(writeAt(data, '/list/1', 3).list, [1, 3]);
  assert.throws(() => writeAt(data, '/list/10000000', 4));
  assert(same({ a: 1, b: 2 }, { b: 2, a: 1 }));
});
test('snapshots cannot mutate stored state', () => {
  const s = new UiStore();
  s.apply(create());
  const snap = s.snapshot('s');
  snap.components.clear();
  assert.equal(s.snapshot('s').components.size, 1);
  assert.throws(() => {
    snap.data.name = 'x';
  });
});
test('remote updates preserve drafts and flag only overlapping conflicts', () => {
  const s = new UiStore();
  s.apply(create({ name: 'old', other: 1 }));
  s.edit('s', '/name', 'mine');
  s.apply(update('/other', 2));
  assert.equal(s.snapshot('s').drafts.get('/name').conflicted, false);
  s.apply(update('/name', 'theirs'));
  assert.equal(s.read('s', '/name'), 'mine');
  assert.equal(s.snapshot('s').drafts.get('/name').conflicted, true);
  s.keepDraft('s', '/name');
  assert.equal(s.snapshot('s').drafts.get('/name').conflicted, false);
  s.discard('s', '/name');
  assert.equal(s.read('s', '/name'), 'theirs');
});
test('overlapping local draft paths are rejected', () => {
  const s = new UiStore();
  s.apply(create({ user: { name: 'a' } }));
  s.edit('s', '/user/name', 'b');
  assert.throws(() => s.edit('s', '/user', { name: 'c' }));
});
test('unregistered actions cannot execute', async () => {
  let count = 0;
  const s = actionStore(async () => {
    count++;
    return { kind: 'success', value: null };
  });
  s.apply({
    version: '1.0',
    updateComponents: {
      surfaceId: 's',
      components: [{ ...button, action: { event: { name: 'other' } } }],
    },
  });
  assert.equal((await s.dispatch('s', 'root')).kind, 'denied');
  assert.equal(count, 0);
});
test('action input is validated and conflicts block execution', async () => {
  let count = 0;
  const s = actionStore(async () => {
    count++;
    return { kind: 'success', value: null };
  });
  s.edit('s', '/name', 10);
  assert.equal((await s.dispatch('s', 'root')).kind, 'denied');
  s.discard('s');
  s.edit('s', '/name', 'mine');
  s.apply(update('/name', 'theirs'));
  assert.equal((await s.dispatch('s', 'root')).kind, 'denied');
  assert.equal(count, 0);
});
test('duplicate concurrent dispatch executes once', async () => {
  const d = deferred();
  let count = 0;
  const s = actionStore(async () => {
    count++;
    return d.promise;
  });
  const first = s.dispatch('s', 'root');
  assert.equal((await s.dispatch('s', 'root')).kind, 'uncertain');
  d.resolve({ kind: 'success', value: null });
  await first;
  assert.equal(count, 1);
});
test('write transport failure is uncertain and cannot auto-retry', async () => {
  let count = 0;
  const s = actionStore(async () => {
    count++;
    throw new Error('secret');
  });
  assert.equal((await s.dispatch('s', 'root')).kind, 'uncertain');
  await s.dispatch('s', 'root');
  assert.equal(count, 1);
  const r = s.snapshot('s').receipts.get('save');
  assert(!r.message.includes('secret'));
  assert.throws(() => s.reconcile('s', 'save', 'wrong', 'success', 'checked'));
  s.reconcile('s', 'save', r.requestId, 'success', 'Checked authoritative state.');
  assert.equal(s.snapshot('s').receipts.get('save').kind, 'success');
});
test('deleted/recreated surface ignores stale completion', async () => {
  const d = deferred();
  const s = actionStore(() => d.promise);
  const work = s.dispatch('s', 'root');
  s.apply({ version: '1.0', deleteSurface: { surfaceId: 's' } });
  s.apply(create({ name: 'fresh' }, [button]));
  d.resolve({ kind: 'success', value: null, messages: [update('/name', 'stale')] });
  await work;
  assert.equal(s.read('s', '/name'), 'fresh');
  assert.equal(s.snapshot('s').receipts.size, 0);
});
test('successful authoritative echo acknowledges draft', async () => {
  const s = actionStore(async (request) => ({
    kind: 'success',
    value: null,
    messages: [update('/name', request.action.context.name)],
  }));
  s.edit('s', '/name', 'mine');
  await s.dispatch('s', 'root');
  assert.equal(s.snapshot('s').drafts.size, 0);
  assert.equal(s.read('s', '/name'), 'mine');
});
test('edits made during a pending save are not erased', async () => {
  const d = deferred();
  const s = actionStore(() => d.promise);
  s.edit('s', '/name', 'sent');
  const work = s.dispatch('s', 'root');
  s.edit('s', '/name', 'newer');
  d.resolve({ kind: 'success', value: null, messages: [update('/name', 'sent')] });
  await work;
  assert.equal(s.read('s', '/name'), 'newer');
  assert.equal(s.snapshot('s').drafts.size, 1);
});
test('malformed result and cross-surface update become uncertain', async () => {
  for (const result of [
    { kind: 'success', value: null, messages: {} },
    { kind: 'success', value: null, messages: [update('/name', 'bad', 'other')] },
  ]) {
    const s = actionStore(async () => result);
    assert.equal((await s.dispatch('s', 'root')).kind, 'uncertain');
    assert.equal(s.read('s', '/name'), 'old');
  }
});
test('non-read actions require unique request identity factory', () =>
  assert.throws(
    () =>
      new UiStore({
        actions: [
          { name: 'save', capabilityId: 'demo:save@1', risk: 'write', validate: () => true },
        ],
      }),
  ));
test('disabled actions do not execute', async () => {
  let count = 0;
  const s = actionStore(async () => {
    count++;
    return { kind: 'success', value: null };
  });
  s.apply({
    version: '1.0',
    updateComponents: { surfaceId: 's', components: [{ ...button, disabled: true }] },
  });
  assert.equal((await s.dispatch('s', 'root')).kind, 'denied');
  assert.equal(count, 0);
});
test('trusted local calculations run without action/model calls', () => {
  const s = new UiStore();
  s.apply(parameterExplorer());
  const component = s.snapshot('explore').components.get('answer');
  assert.equal(s.resolve('explore', component.value), 19.56);
  s.edit('explore', '/attempts', 0);
  assert.equal(s.resolve('explore', component.value), 0);
  s.edit('explore', '/attempts', 3);
  s.edit('explore', '/rate', 1);
  assert.equal(s.resolve('explore', component.value), 100);
});
test('remote function responses retain correlation; caller rules enforced', () => {
  const base = defaultCatalog();
  const registry = new CatalogRegistry([
    {
      ...base,
      functions: [
        ...(base.functions ?? []),
        {
          name: 'privateFn',
          allowedCallers: 'rendererOnly',
          validate: () => true,
          evaluate: () => 1,
        },
      ],
    },
  ]);
  const s = new UiStore({ catalogs: registry });
  const invoke = (name) =>
    s.apply({
      version: '1.0',
      callRendererFunction: {
        functionCallId: 'call_1',
        callFunction: { '@call': name, catalogId: UI_CATALOG_ID, args: { attempts: 3, rate: 0.1 } },
      },
    });
  assert.equal(invoke('probability').response.rendererFunctionResponse.value, 27.1);
  assert.equal(
    invoke('privateFn').response.rendererFunctionResponse.error.code,
    'INVALID_FUNCTION_CALL',
  );
  assert.equal(invoke('notRegistered').response.rendererFunctionResponse.functionCallId, 'call_1');
});
test('surface-independent function cannot read an existing surface', () => {
  const s = new UiStore();
  s.apply(create({ secret: 0.5 }));
  const r = s.apply({
    version: '1.0',
    callRendererFunction: {
      functionCallId: 'call_2',
      callFunction: {
        '@call': 'probability',
        catalogId: UI_CATALOG_ID,
        args: { attempts: 3, rate: { '@path': '/secret' } },
      },
    },
  });
  assert.equal(r.response.rendererFunctionResponse.error.code, 'INVALID_FUNCTION_CALL');
});
test('unsupported agentFunctionResponse is explicit', () =>
  assert.equal(
    new UiStore().apply({
      version: '1.0',
      agentFunctionResponse: { functionCallId: 'x', value: 1 },
    }).kind,
    'rejected',
  ));
test('JSONL chunking handles multi-message and incomplete frames', () => {
  const s = new UiStore();
  const decoder = new JsonlDecoder(s);
  const line = JSON.stringify(create({ name: '名字' }));
  assert.equal(decoder.push(line.slice(0, 20)).length, 0);
  assert.equal(
    decoder.push(`${line.slice(20)}\r\n${JSON.stringify(update('/name', 'done'))}`).length,
    1,
  );
  assert.equal(decoder.finish()[0].kind, 'applied');
  assert.equal(s.read('s', '/name'), 'done');
});
test('malformed stream stops without overwriting last valid state', () => {
  const s = new UiStore();
  const d = new JsonlDecoder(s);
  const result = d.push(
    `${JSON.stringify(create())}\n{"bad":\n${JSON.stringify(update('/name', 'bad'))}\n`,
  );
  assert.equal(result.length, 2);
  assert.equal(result[1].kind, 'rejected');
  assert.equal(s.read('s', '/name'), 'old');
  assert.equal(d.push('{}\n')[0].kind, 'rejected');
});
test('stream frame byte limits account for Unicode', () => {
  const s = new UiStore({ limits: { maxMessageBytes: 100 } });
  const d = new JsonlDecoder(s);
  assert.equal(d.push('😀'.repeat(30))[0].kind, 'rejected');
});
test('text and structured fallback preserve the outcome', () => {
  const r = presentationResult('Two records ready', { count: 2 }, [create()]);
  assert.equal(r.content[0].text, 'Two records ready');
  assert.equal(r.structuredContent.result.data.count, 2);
  const s = new UiStore();
  assert.deepEqual(receiveToolResult(s, r), []);
  assert.equal(s.ids().length, 1);
});
test('model context contains only explicitly selected paths', () => {
  const s = new UiStore();
  s.apply(create({ selected: ['a'], secret: 'never share' }));
  const context = selectionContext(s, 's', ['/selected']);
  assert.deepEqual(context.selection, { '/selected': ['a'] });
  assert(!JSON.stringify(context).includes('never share'));
});
test('MCP bridge uses fixed tool mappings and application decoder', async () => {
  let call;
  const port = createMcpActionPort(
    {
      callServerTool: async (r) => {
        call = r;
        return { structuredContent: { result: { ok: true } } };
      },
    },
    [
      {
        capabilityId: 'demo:save@1',
        toolName: 'save_record',
        risk: 'write',
        arguments: (r) => ({ name: r.action.context.name, requestId: r.requestId }),
        decode: (r) =>
          r.structuredContent.result.ok
            ? { kind: 'success', value: true }
            : { kind: 'denied', message: 'Denied' },
      },
    ],
  );
  const s = actionStore((r) => port.execute(r));
  await s.dispatch('s', 'root');
  assert.equal(call.name, 'save_record');
  assert.equal(call.arguments.name, 'old');
  assert.equal(Object.hasOwn(call.arguments, 'credentials'), false);
});
test('all three builders produce accepted catalog messages and empty states', () => {
  const s = new UiStore();
  for (const message of [
    reviewQueue([]),
    parameterExplorer(),
    mediaAnnotation({ kind: 'audio', source: '', duration: 0, lines: [] }),
  ])
    assert.equal(s.apply(message).kind, 'applied');
  assert.equal(s.ids().length, 3);
});
test('pattern input validation rejects unsafe or out-of-bounds values', () => {
  assert.throws(() =>
    reviewQueue([{ id: 'bad-id', title: 'x', category: 'x', before: 'x', draft: 'x' }]),
  );
  assert.throws(() =>
    mediaAnnotation({
      kind: 'video',
      source: 'x',
      duration: 5,
      lines: [{ id: 'line', start: 6, text: 'x' }],
    }),
  );
  assert.equal(validReviewInput({ selected: ['missing'], records: {} }), false);
  assert.equal(validAnnotationInput({ duration: 3, annotations: [{ time: 4, text: 'x' }] }), false);
});
test('mixed catalogs require explicit registrations', () => {
  const catalog = {
    id: 'urn:custom',
    components: [
      {
        name: 'Badge',
        properties: ['label'],
        required: ['label'],
        validate: (c) => typeof c.label === 'string',
      },
    ],
  };
  const s = new UiStore({ catalogs: new CatalogRegistry([defaultCatalog(), catalog]) });
  assert.equal(
    s.apply(
      create({}, [{ id: 'root', component: 'Badge', '@catalogId': 'urn:custom', label: 'Ready' }]),
    ).kind,
    'applied',
  );
});
test('automatic full-model sharing is explicitly unsupported rather than silently ignored', () => {
  const message = create();
  message.createSurface.sendDataModel = true;
  const s = new UiStore();
  const result = s.apply(message);
  assert.equal(result.kind, 'rejected');
  assert.equal(result.issue.kind, 'unsupported');
  assert.equal(s.ids().length, 0);
});
test('existing capability output can be projected without changing its schema', () => {
  const s = new UiStore();
  const result = {
    content: [{ type: 'text', text: 'Old output preserved' }],
    structuredContent: { result: { name: 'original' } },
  };
  const errors = receiveToolResult(s, result, (original) => [create(original)]);
  assert.deepEqual(errors, []);
  assert.equal(s.read('s', '/name'), 'original');
  assert.deepEqual(result.structuredContent.result, { name: 'original' });
});
test('agent catalog discovery is JSON-only and contains no executable callbacks', () => {
  const catalog = new CatalogRegistry([defaultCatalog()]).describe();
  const encoded = JSON.stringify(catalog);
  assert.equal(catalog.catalogs[0].components.length, 25);
  assert(!encoded.includes('evaluate'));
  assert(!encoded.includes('validate'));
  assert.equal(catalog.profile, 'agent-native-ui-bounded-v1');
});
