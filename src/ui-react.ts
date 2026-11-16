import type {
  ActionReceipt,
  Component,
  Draft,
  Json,
  JsonObject,
  SurfaceSnapshot,
} from './ui/types.js';
import { isObject, jsonObject, pointer } from './ui/json.js';
import type { UiStore } from './ui/store.js';
/** Pass React.createElement. The package never imports React into the portable core. */
export type ElementFactory<Element> = (
  tag: string,
  props: Readonly<Record<string, unknown>> | null,
  ...children: readonly (Element | string | number | null | false)[]
) => Element;
export type RenderContext<Element> = {
  readonly component: Component;
  readonly surfaceId: string;
  readonly store: UiStore;
  readonly h: ElementFactory<Element>;
  readonly renderChild: (id: string) => Element;
};
export type CustomRenderer<Element> = {
  readonly catalogId: string;
  readonly component: string;
  readonly render: (context: RenderContext<Element>) => Element;
};
export type RendererOptions<Element> = {
  readonly mediaSources?: Readonly<Record<string, string>>;
  readonly seekMedia?: (surfaceId: string, componentId: string, seconds: number) => void;
  readonly onViewChange?: () => void;
  readonly custom?: readonly CustomRenderer<Element>[];
};
export type ReactRenderer<Element> = {
  readonly render: (store: UiStore, surfaceId: string) => Element;
  readonly dispose: () => void;
};
function text(value: Json | undefined): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string'
    ? value
    : typeof value === 'object'
      ? JSON.stringify(value).slice(0, 6000)
      : String(value);
}
function number(value: Json | undefined, fallback: number = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
function binding(value: Json | undefined): string | undefined {
  return isObject(value) && pointer(value['@path']) && value['@path'] !== ''
    ? value['@path']
    : undefined;
}
function target(event: unknown): Record<string, unknown> | undefined {
  return isObject(event) && isObject(event['currentTarget']) ? event['currentTarget'] : undefined;
}
function inputValue(event: unknown): string {
  return String(target(event)?.['value'] ?? '');
}
function time(seconds: number): string {
  const safe: number = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const tenths: number = Math.round(safe * 10);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}
export function mediaElementId(surfaceId: string, componentId: string): string {
  return `anui_${encodeURIComponent(surfaceId)}_${componentId}`;
}
export function createReactRenderer<Element>(
  h: ElementFactory<Element>,
  options: RendererOptions<Element> = {},
): ReactRenderer<Element> {
  let errors: Map<string, string> = new Map();
  const mediaSources: Readonly<Record<string, string>> = Object.freeze({ ...options.mediaSources });
  let custom: Map<string, CustomRenderer<Element>> = new Map();
  for (const renderer of options.custom ?? []) {
    const key: string = `${renderer.catalogId}\0${renderer.component}`;
    if (custom.has(key)) throw new TypeError('Duplicate custom renderer.');
    custom.set(key, renderer);
  }
  const render = (store: UiStore, surfaceId: string): Element => {
    const snapshot: SurfaceSnapshot | undefined = store.snapshot(surfaceId);
    if (snapshot === undefined)
      return h(
        'section',
        { className: 'anui', 'aria-label': 'Agent Native UI' },
        h('p', { role: 'status', className: 'anui-status' }, 'No surface loaded.'),
      );
    let rendered: number = 0;
    const issue = (key: string, message: string): void => {
      errors.set(key, message);
      options.onViewChange?.();
    };
    const renderNode = (id: string): Element => {
      rendered += 1;
      if (rendered > 2048) return h('p', { key: id, role: 'alert' }, 'Render limit reached.');
      const c: Component | undefined = snapshot.components.get(id);
      if (c === undefined)
        return h(
          'p',
          { key: id, role: 'status', className: 'anui-placeholder' },
          'Waiting for component…',
        );
      const key: string = `${surfaceId}\0${id}`;
      const domId: string = mediaElementId(surfaceId, id);
      const catalogId: string =
        typeof c['@catalogId'] === 'string' ? c['@catalogId'] : snapshot.catalogId;
      const resolve = (field: string): Json | undefined =>
        store.resolve(surfaceId, c[field], catalogId);
      const set = (field: string, value: Json): void => {
        const path: string | undefined = binding(c[field]);
        if (path === undefined) {
          issue(key, 'This control needs a writable data binding.');
          return;
        }
        try {
          errors.delete(key);
          store.edit(surfaceId, path, value);
        } catch {
          issue(key, 'The edit could not be applied. Resolve conflicting or invalid data.');
        }
      };
      const eventSet =
        (field: string, numeric: boolean): ((event: unknown) => void) =>
        (event: unknown): void => {
          const value: string = inputValue(event);
          if (!numeric) set(field, value.slice(0, 10000));
          else if (value !== '' && Number.isFinite(Number(value))) {
            set(
              field,
              clamp(
                Number(value),
                number(c['min'], -Number.MAX_VALUE),
                number(c['max'], Number.MAX_VALUE),
              ),
            );
          }
        };
      const a: JsonObject = jsonObject(c['@accessibility']) ? c['@accessibility'] : {};
      const common: Record<string, unknown> = { key: id, 'data-component': c.component };
      const ariaLabel: Json | undefined = store.resolve(surfaceId, a['label'], catalogId);
      if (typeof ariaLabel === 'string') common['aria-label'] = ariaLabel;
      if (a['live'] !== undefined) common['aria-live'] = a['live'];
      if (store.resolve(surfaceId, a['hidden'], catalogId) === true)
        return h('span', { key: id, hidden: true });
      const withError = (element: Element): Element =>
        h(
          'div',
          { key: id, className: 'anui-field-wrap' },
          element,
          errors.has(key)
            ? h('p', { role: 'alert', className: 'anui-error' }, errors.get(key) ?? '')
            : null,
        );
      const label: string = text(resolve('label')) || id;
      const disabled: boolean = resolve('disabled') === true;
      const customRenderer: CustomRenderer<Element> | undefined = custom.get(
        `${catalogId}\0${c.component}`,
      );
      if (customRenderer !== undefined)
        return customRenderer.render({
          component: c,
          surfaceId,
          store,
          h,
          renderChild: renderNode,
        });
      // Built-ins are rendered only for the default catalog, never for a same-name custom type.
      if (catalogId !== 'urn:uppercut:agent-native-ui:catalog:1')
        return h(
          'p',
          { ...common, role: 'alert' },
          'No renderer registered for this catalog component.',
        );
      switch (c.component) {
        case 'Column':
        case 'Row':
        case 'Card': {
          const ids: readonly Json[] = Array.isArray(c['children']) ? c['children'] : [];
          return h(
            c.component === 'Card' ? 'section' : 'div',
            { ...common, className: `anui-${c.component.toLowerCase()}` },
            c['title'] !== undefined ? h('h3', null, text(resolve('title'))) : null,
            ...ids.map((child: Json): Element => renderNode(String(child))),
          );
        }
        case 'Text':
          return h(
            c['variant'] === 'heading' ? 'h2' : c['variant'] === 'code' ? 'pre' : 'p',
            { ...common, className: c['variant'] === 'caption' ? 'anui-muted' : undefined },
            text(resolve('text')),
          );
        case 'Status':
          return h(
            'p',
            {
              ...common,
              role: c['kind'] === 'error' || c['kind'] === 'denied' ? 'alert' : 'status',
              className: `anui-status anui-${String(c['kind'] ?? 'info')}`,
            },
            text(resolve('text')),
          );
        case 'Divider':
          return h('hr', common);
        case 'TextField':
        case 'NumberField':
        case 'Slider': {
          const value: Json | undefined = resolve('value');
          const isNumber: boolean = c.component !== 'TextField';
          return withError(
            h(
              'label',
              { ...common, className: 'anui-field', htmlFor: domId },
              h(
                'span',
                { className: 'anui-field-label' },
                label,
                c.component === 'Slider'
                  ? h('output', { htmlFor: domId }, `${text(value)}${text(c['suffix'])}`)
                  : null,
              ),
              h(c['multiline'] === true ? 'textarea' : 'input', {
                id: domId,
                type: c.component === 'Slider' ? 'range' : isNumber ? 'number' : 'text',
                value: text(value),
                disabled,
                placeholder: typeof c['placeholder'] === 'string' ? c['placeholder'] : undefined,
                min: c['min'],
                max: c['max'],
                step: c['step'],
                rows: c['multiline'] === true ? 3 : undefined,
                onInput: eventSet('value', isNumber),
                'aria-describedby':
                  typeof a['description'] === 'string' ? `${domId}_hint` : undefined,
              }),
              typeof a['description'] === 'string'
                ? h('small', { id: `${domId}_hint` }, a['description'])
                : null,
            ),
          );
        }
        case 'CheckBox':
          return withError(
            h(
              'label',
              { ...common, className: 'anui-check' },
              h('input', {
                type: 'checkbox',
                checked: resolve('value') === true,
                disabled,
                onChange: (event: unknown): void => {
                  set('value', target(event)?.['checked'] === true);
                },
              }),
              label,
            ),
          );
        case 'ChoicePicker': {
          const choices: readonly Json[] = Array.isArray(c['options']) ? c['options'] : [];
          const value: string = text(resolve('value'));
          if (c['variant'] === 'radio')
            return withError(
              h(
                'fieldset',
                common,
                h('legend', null, label),
                ...choices.map((option: Json): Element => {
                  const o: JsonObject = jsonObject(option) ? option : {};
                  return h(
                    'label',
                    { key: text(o['value']), className: 'anui-check' },
                    h('input', {
                      type: 'radio',
                      name: domId,
                      value: text(o['value']),
                      checked: value === text(o['value']),
                      disabled,
                      onChange: (): void => {
                        set('value', text(o['value']));
                      },
                    }),
                    text(o['label']),
                  );
                }),
              ),
            );
          return withError(
            h(
              'label',
              { ...common, className: 'anui-field', htmlFor: domId },
              h('span', null, label),
              h(
                'select',
                { id: domId, value, disabled, onChange: eventSet('value', false) },
                ...choices.map((option: Json): Element => {
                  const o: JsonObject = jsonObject(option) ? option : {};
                  return h(
                    'option',
                    { key: text(o['value']), value: text(o['value']) },
                    text(o['label']),
                  );
                }),
              ),
            ),
          );
        }
        case 'Button':
        case 'DecisionCard': {
          const action: JsonObject =
            jsonObject(c['action']) && jsonObject(c['action']['event']) ? c['action']['event'] : {};
          const actionName: string = text(action['name']);
          const receipt: ActionReceipt | undefined = snapshot.receipts.get(actionName);
          const inactive: boolean =
            disabled ||
            !store.actionAvailable(actionName) ||
            receipt?.kind === 'pending' ||
            receipt?.kind === 'uncertain';
          // An ActionResult for this action already announces the receipt; repeating it under
          // the button would make screen readers announce the same alert twice.
          const receiptShown: boolean = [...snapshot.components.values()].some(
            (other: Component): boolean =>
              other.component === 'ActionResult' && other['actionName'] === actionName,
          );
          const click = (): void => {
            void store
              .dispatch(surfaceId, id)
              .then((outcome): void => {
                if (outcome.kind !== 'success' && !receiptShown) issue(key, outcome.message);
                else {
                  errors.delete(key);
                  options.onViewChange?.();
                }
              })
              .catch((): void => {
                issue(key, 'Action did not produce a confirmed result.');
              });
          };
          const button: Element = h(
            'button',
            {
              type: 'button',
              disabled: inactive,
              onClick: click,
              className: c['variant'] === 'secondary' ? 'anui-button secondary' : 'anui-button',
              'aria-label': label,
            },
            receipt?.kind === 'pending' ? 'Working…' : label,
          );
          return withError(
            c.component === 'DecisionCard'
              ? h(
                  'section',
                  { ...common, className: 'anui-card' },
                  h('h3', null, text(resolve('title'))),
                  h('p', null, text(resolve('description'))),
                  button,
                )
              : button,
          );
        }
        case 'Diff':
          return h(
            'section',
            { ...common, className: 'anui-diff', 'aria-label': label },
            h('div', null, h('h4', null, 'Before'), h('del', null, text(resolve('before')))),
            h('div', null, h('h4', null, 'After'), h('ins', null, text(resolve('after')))),
          );
        case 'Output':
          return h(
            'section',
            { ...common, className: 'anui-output' },
            h('p', null, label),
            h('output', { 'aria-live': 'polite' }, text(resolve('value')), text(c['suffix'])),
          );
        case 'Chart': {
          const points: Json | undefined = resolve('points');
          if (!Array.isArray(points) || points.length === 0)
            return h('p', { ...common, role: 'status' }, 'No chart data.');
          if (points.length > 128)
            return h('p', { ...common, role: 'alert' }, 'Chart contains too many points.');
          const max: number = Math.max(1, number(resolve('max'), 100));
          return h(
            'figure',
            { ...common, className: 'anui-chart' },
            h('figcaption', null, label),
            ...points.map((point: Json, index: number): Element => {
              const p: JsonObject = jsonObject(point) ? point : {};
              const value: number = number(store.resolve(surfaceId, p['value'], catalogId));
              return h(
                'div',
                { key: index, className: 'anui-chart-row' },
                h('span', null, text(p['label'])),
                h(
                  'div',
                  { className: 'anui-bar-track', 'aria-hidden': true },
                  h('span', {
                    style: {
                      width: `${Math.round(clamp((value / max) * 100, 0, 100) * 100) / 100}%`,
                    },
                    className: 'anui-bar',
                  }),
                ),
                h('span', null, String(value)),
              );
            }),
          );
        }
        case 'Table': {
          const raw: Json | undefined = resolve('rows');
          const columns: readonly Json[] = Array.isArray(c['columns']) ? c['columns'] : [];
          if (!Array.isArray(raw) || raw.length === 0)
            return h(
              'p',
              { ...common, className: 'anui-status', role: 'status' },
              text(c['emptyText']) || 'No records.',
            );
          if (
            raw.length > 500 ||
            raw.some((row: Json): boolean => !jsonObject(row) || typeof row['id'] !== 'string') ||
            new Set(raw.map((row: Json): string => (jsonObject(row) ? text(row['id']) : '')))
              .size !== raw.length
          )
            return h(
              'p',
              { ...common, role: 'alert' },
              'Rows must have unique IDs within the display limit.',
            );
          const sort: string = text(resolve('sort'));
          const descending: boolean = sort.startsWith('~');
          const sortKey: string = descending ? sort.slice(1) : sort;
          const rows: JsonObject[] = raw
            .filter(jsonObject)
            .slice()
            .sort(
              (left: JsonObject, right: JsonObject): number =>
                text(left[sortKey]).localeCompare(text(right[sortKey])) * (descending ? -1 : 1),
            );
          const selectedValue: Json | undefined = resolve('selection');
          const selected: readonly string[] = Array.isArray(selectedValue)
            ? selectedValue.filter((v: Json): v is string => typeof v === 'string')
            : [];
          const selectable: boolean = binding(c['selection']) !== undefined;
          const sortable: boolean = binding(c['sort']) !== undefined;
          return withError(
            h(
              'div',
              {
                ...common,
                className: 'anui-table-wrap',
                tabIndex: 0,
                role: 'region',
                'aria-label': label,
              },
              h(
                'table',
                null,
                h('caption', null, label),
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    selectable ? h('th', { scope: 'col' }, 'Select') : null,
                    ...columns.map((column: Json): Element => {
                      const col: JsonObject = jsonObject(column) ? column : {};
                      return h(
                        'th',
                        {
                          key: text(col['key']),
                          scope: 'col',
                          'aria-sort':
                            sortKey === col['key']
                              ? descending
                                ? 'descending'
                                : 'ascending'
                              : 'none',
                        },
                        sortable
                          ? h(
                              'button',
                              {
                                className: 'anui-sort',
                                type: 'button',
                                onClick: (): void => {
                                  set(
                                    'sort',
                                    sortKey === col['key'] && !descending
                                      ? `~${text(col['key'])}`
                                      : text(col['key']),
                                  );
                                },
                              },
                              text(col['label']),
                            )
                          : text(col['label']),
                      );
                    }),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  ...rows.map(
                    (row: JsonObject): Element =>
                      h(
                        'tr',
                        { key: text(row['id']) },
                        selectable
                          ? h(
                              'td',
                              null,
                              h('input', {
                                type: 'checkbox',
                                checked: selected.includes(text(row['id'])),
                                'aria-label': `Select ${text(row['title']) || text(row['id'])}`,
                                onChange: (event: unknown): void => {
                                  set(
                                    'selection',
                                    target(event)?.['checked'] === true
                                      ? [...new Set([...selected, text(row['id'])])]
                                      : selected.filter(
                                          (value: string): boolean => value !== row['id'],
                                        ),
                                  );
                                },
                              }),
                            )
                          : null,
                        ...columns.map((column: Json): Element => {
                          const col: JsonObject = jsonObject(column) ? column : {};
                          return h('td', { key: text(col['key']) }, text(row[text(col['key'])]));
                        }),
                      ),
                  ),
                ),
              ),
            ),
          );
        }
        case 'List': {
          const items: Json | undefined = resolve('items');
          if (!Array.isArray(items) || items.length === 0)
            return h('p', { ...common, role: 'status' }, text(c['emptyText']) || 'No items.');
          if (items.length > 500)
            return h('p', { ...common, role: 'alert' }, 'List contains too many items.');
          const selectable: boolean = binding(c['selection']) !== undefined;
          if (!selectable)
            return h(
              'ul',
              common,
              ...items.map(
                (item: Json, index: number): Element => h('li', { key: index }, text(item)),
              ),
            );
          const rows: JsonObject[] = items.filter(jsonObject);
          if (
            rows.length !== items.length ||
            rows.some((row: JsonObject): boolean => typeof row['id'] !== 'string') ||
            new Set(rows.map((row: JsonObject): string => text(row['id']))).size !== rows.length
          )
            return h('p', { ...common, role: 'alert' }, 'Selectable list items need unique IDs.');
          const selectedValue: Json | undefined = resolve('selection');
          const selected: readonly string[] = Array.isArray(selectedValue)
            ? selectedValue.filter((value: Json): value is string => typeof value === 'string')
            : [];
          return withError(
            h(
              'ul',
              common,
              ...rows.map(
                (row: JsonObject): Element =>
                  h(
                    'li',
                    { key: text(row['id']) },
                    h(
                      'label',
                      { className: 'anui-check' },
                      h('input', {
                        type: 'checkbox',
                        checked: selected.includes(text(row['id'])),
                        disabled,
                        onChange: (event: unknown): void => {
                          set(
                            'selection',
                            target(event)?.['checked'] === true
                              ? [...new Set([...selected, text(row['id'])])]
                              : selected.filter((value: string): boolean => value !== row['id']),
                          );
                        },
                      }),
                      text(row['label']) || text(row['title']) || text(row['id']),
                    ),
                  ),
              ),
            ),
          );
        }
        case 'Tabs': {
          const ids: readonly Json[] = Array.isArray(c['children']) ? c['children'] : [];
          const labels: readonly Json[] = Array.isArray(c['labels']) ? c['labels'] : [];
          const current: string = text(resolve('value')) || text(ids[0]);
          const select = (index: number, event?: unknown): void => {
            const chosen: string = text(ids[(index + ids.length) % ids.length]);
            set('value', chosen);
            const button: Record<string, unknown> | undefined = target(event);
            if (button !== undefined && isObject(button['parentElement'])) {
              const parent: Record<string, unknown> = button['parentElement'];
              if (typeof parent['querySelectorAll'] === 'function') {
                const buttons = (
                  parent['querySelectorAll'] as (selector: string) => NodeListOf<HTMLElement>
                ).call(parent, '[role="tab"]');
                buttons[(index + ids.length) % ids.length]?.focus();
              }
            }
          };
          return withError(
            h(
              'section',
              common,
              h(
                'div',
                { role: 'tablist', 'aria-label': label, className: 'anui-tabs' },
                ...ids.map(
                  (child: Json, index: number): Element =>
                    h(
                      'button',
                      {
                        key: text(child),
                        id: `${domId}_tab_${index}`,
                        type: 'button',
                        role: 'tab',
                        'aria-selected': current === child,
                        'aria-controls': `${domId}_panel_${index}`,
                        tabIndex: current === child ? 0 : -1,
                        onClick: (event: unknown): void => {
                          select(index, event);
                        },
                        onKeyDown: (event: unknown): void => {
                          if (!isObject(event)) return;
                          let next: number | undefined;
                          if (event['key'] === 'ArrowRight') next = index + 1;
                          if (event['key'] === 'ArrowLeft') next = index - 1;
                          if (event['key'] === 'Home') next = 0;
                          if (event['key'] === 'End') next = ids.length - 1;
                          if (next !== undefined) {
                            if (typeof event['preventDefault'] === 'function')
                              (event['preventDefault'] as () => void)();
                            select(next, event);
                          }
                        },
                      },
                      text(labels[index]),
                    ),
                ),
              ),
              ...ids.map(
                (child: Json, index: number): Element =>
                  h(
                    'div',
                    {
                      key: text(child),
                      id: `${domId}_panel_${index}`,
                      role: 'tabpanel',
                      'aria-labelledby': `${domId}_tab_${index}`,
                      hidden: current !== child,
                    },
                    current === child ? renderNode(text(child)) : null,
                  ),
              ),
            ),
          );
        }
        case 'Audio':
        case 'Video': {
          const sourceKey: string = text(resolve('source'));
          const source: string | undefined = Object.hasOwn(mediaSources, sourceKey)
            ? mediaSources[sourceKey]
            : undefined;
          // Application-registered sources only. Base64 audio/video data URLs let a
          // self-contained view (for example an MCP App with no resource domains) carry media.
          if (
            source === undefined ||
            !/^(?:https?:\/\/|blob:|\/(?!\/)|\.\.?\/|data:(?:audio|video)\/[a-z0-9.+-]+;base64,)/.test(
              source,
            )
          )
            return h(
              'p',
              { ...common, className: 'anui-status', role: 'status' },
              'No registered media source is available.',
            );
          const updateMedia = (event: unknown, includeDuration: boolean): void => {
            const node: Record<string, unknown> | undefined = target(event);
            if (node === undefined) return;
            const duration: number =
              typeof node['duration'] === 'number' && Number.isFinite(node['duration'])
                ? node['duration']
                : 0;
            for (const related of snapshot.components.values())
              if (related.component === 'Timeline' && related['mediaId'] === id) {
                const path: string | undefined = binding(related['value']);
                const durationPath: string | undefined = binding(related['duration']);
                try {
                  if (includeDuration && durationPath !== undefined && duration > 0)
                    store.edit(surfaceId, durationPath, duration);
                  if (path !== undefined && typeof node['currentTime'] === 'number') {
                    const position: number = includeDuration
                      ? clamp(number(store.read(surfaceId, path)), 0, duration)
                      : clamp(node['currentTime'], 0, duration);
                    store.edit(surfaceId, path, position);
                    if (includeDuration) options.seekMedia?.(surfaceId, id, position);
                  }
                } catch {
                  issue(key, 'Media timeline could not be synchronized.');
                }
              }
          };
          return withError(
            h(c.component === 'Video' ? 'video' : 'audio', {
              ...common,
              id: domId,
              src: source,
              controls: true,
              preload: 'metadata',
              autoPlay: false,
              playsInline: true,
              'aria-label': label,
              className: 'anui-media',
              onLoadedMetadata: (event: unknown): void => {
                updateMedia(event, true);
              },
              onTimeUpdate: (event: unknown): void => {
                updateMedia(event, false);
              },
              onError: (): void => {
                issue(key, 'The registered media could not be loaded.');
              },
            }),
          );
        }
        case 'Timeline': {
          const duration: number = Math.max(0, number(resolve('duration')));
          const value: number = clamp(number(resolve('value')), 0, duration);
          const end: number = clamp(number(resolve('end'), duration), value, duration);
          const move = (field: 'value' | 'end', event: unknown): void => {
            let next: number = clamp(Number(inputValue(event)), 0, duration);
            if (!Number.isFinite(next)) return;
            next = field === 'value' ? Math.min(next, end) : Math.max(next, value);
            set(field, next);
            if (field === 'value' && typeof c['mediaId'] === 'string')
              options.seekMedia?.(surfaceId, c['mediaId'], next);
          };
          return withError(
            h(
              'fieldset',
              common,
              h('legend', null, label),
              h(
                'label',
                { className: 'anui-field', htmlFor: domId },
                h('span', null, `${time(value)} / ${time(duration)}`),
                h('input', {
                  id: domId,
                  type: 'range',
                  min: 0,
                  max: duration,
                  step: 0.01,
                  value,
                  disabled: duration === 0,
                  'aria-label': label,
                  'aria-valuetext': time(value),
                  onInput: (event: unknown): void => {
                    move('value', event);
                  },
                }),
              ),
              binding(c['end']) !== undefined
                ? h(
                    'label',
                    { className: 'anui-field', htmlFor: `${domId}_end` },
                    h('span', null, 'Range end'),
                    h('input', {
                      id: `${domId}_end`,
                      type: 'number',
                      min: value,
                      max: duration,
                      step: 0.01,
                      value: end,
                      disabled: duration === 0,
                      onInput: (event: unknown): void => {
                        move('end', event);
                      },
                    }),
                  )
                : null,
            ),
          );
        }
        case 'Transcript': {
          const data: Json | undefined = resolve('lines');
          const lines: readonly JsonObject[] = Array.isArray(data) ? data.filter(jsonObject) : [];
          if (lines.length === 0)
            return h('p', { ...common, role: 'status' }, 'No transcript supplied.');
          return withError(
            h(
              'section',
              common,
              h('h3', null, label),
              ...lines.slice(0, 500).map(
                (line: JsonObject, index: number): Element =>
                  h(
                    'div',
                    { key: text(line['id']) || index, className: 'anui-transcript-row' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'anui-time',
                        'aria-label': `Seek to ${time(number(line['start']))}`,
                        onClick: (): void => {
                          set('position', number(line['start']));
                          if (typeof c['mediaId'] === 'string')
                            options.seekMedia?.(surfaceId, c['mediaId'], number(line['start']));
                        },
                      },
                      time(number(line['start'])),
                    ),
                    h(
                      'label',
                      { className: 'anui-field' },
                      h('span', { className: 'anui-sr-only' }, `Transcript line ${index + 1}`),
                      h('input', {
                        type: 'text',
                        value: text(line['text']),
                        onInput: (event: unknown): void => {
                          set(
                            'lines',
                            lines.map(
                              (entry: JsonObject, i: number): JsonObject =>
                                i === index
                                  ? { ...entry, text: inputValue(event).slice(0, 5000) }
                                  : entry,
                            ),
                          );
                        },
                      }),
                    ),
                  ),
              ),
            ),
          );
        }
        case 'Annotations': {
          const data: Json | undefined = resolve('items');
          const annotations: readonly JsonObject[] = Array.isArray(data)
            ? data.filter(jsonObject)
            : [];
          const duration: number = Math.max(0, number(resolve('duration')));
          const position: number = clamp(number(resolve('position')), 0, duration);
          const add = (): void => {
            if (annotations.length >= 500) {
              issue(key, 'Annotation limit reached.');
              return;
            }
            set('items', [
              ...annotations,
              {
                id: `note_${store.getVersion()}_${annotations.length}`,
                time: Math.round(position * 100) / 100,
                text: '',
              },
            ]);
          };
          return withError(
            h(
              'section',
              { ...common, className: 'anui-annotations' },
              h(
                'div',
                { className: 'anui-row' },
                h('h3', null, label),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'anui-button secondary',
                    disabled: duration <= 0,
                    onClick: add,
                  },
                  `Add at ${time(position)}`,
                ),
              ),
              annotations.length === 0
                ? h('p', { className: 'anui-muted' }, 'No annotations yet.')
                : null,
              ...annotations.map(
                (note: JsonObject, index: number): Element =>
                  h(
                    'div',
                    { key: text(note['id']) || index, className: 'anui-annotation' },
                    h(
                      'label',
                      { className: 'anui-field' },
                      h('span', null, 'Seconds'),
                      h('input', {
                        type: 'number',
                        min: 0,
                        max: duration,
                        step: 0.01,
                        value: number(note['time']),
                        'aria-label': `Annotation ${index + 1} time`,
                        onInput: (event: unknown): void => {
                          const value: number = Number(inputValue(event));
                          if (Number.isFinite(value))
                            set(
                              'items',
                              annotations.map(
                                (entry: JsonObject, i: number): JsonObject =>
                                  i === index
                                    ? { ...entry, time: clamp(value, 0, duration) }
                                    : entry,
                              ),
                            );
                        },
                      }),
                    ),
                    h(
                      'label',
                      { className: 'anui-field' },
                      h('span', null, 'Note'),
                      h('input', {
                        type: 'text',
                        value: text(note['text']),
                        'aria-label': `Annotation ${index + 1} note`,
                        onInput: (event: unknown): void => {
                          set(
                            'items',
                            annotations.map(
                              (entry: JsonObject, i: number): JsonObject =>
                                i === index
                                  ? { ...entry, text: inputValue(event).slice(0, 5000) }
                                  : entry,
                            ),
                          );
                        },
                      }),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'anui-button secondary',
                        'aria-label': `Remove annotation ${index + 1}`,
                        onClick: (): void => {
                          set(
                            'items',
                            annotations.filter(
                              (_note: JsonObject, i: number): boolean => i !== index,
                            ),
                          );
                        },
                      },
                      'Remove',
                    ),
                  ),
              ),
            ),
          );
        }
        case 'ActionResult': {
          const receipt: ActionReceipt | undefined = snapshot.receipts.get(text(c['actionName']));
          return h(
            'p',
            {
              ...common,
              role:
                receipt?.kind === 'denied' ||
                receipt?.kind === 'error' ||
                receipt?.kind === 'uncertain'
                  ? 'alert'
                  : 'status',
              className: `anui-receipt ${receipt?.kind ?? 'idle'}`,
            },
            receipt?.message ?? '',
          );
        }
        default:
          return h('p', { ...common, role: 'alert' }, 'Component renderer unavailable.');
      }
    };
    const safeRender = (id: string): Element => {
      try {
        return renderNode(id);
      } catch {
        return h(
          'p',
          { role: 'alert', className: 'anui-status anui-error' },
          'This view contains an invalid binding or expression. The stored data has not been changed.',
        );
      }
    };
    const drafts: readonly Draft[] = [...snapshot.drafts.values()];
    const conflicts: readonly Draft[] = drafts.filter((draft: Draft): boolean => draft.conflicted);
    return h(
      'section',
      { className: 'anui', 'aria-label': 'Agent Native UI', 'data-surface-id': surfaceId },
      conflicts.length > 0
        ? h(
            'section',
            { role: 'alert', className: 'anui-conflicts' },
            h('h3', null, 'Server changes overlap your edits'),
            h('p', null, 'Your edits are preserved. Choose which value to keep before submitting.'),
            ...conflicts.map(
              (draft: Draft): Element =>
                h(
                  'div',
                  { key: draft.path, className: 'anui-conflict' },
                  h('code', null, draft.path),
                  h('span', null, text(draft.value)),
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: (): void => {
                        store.keepDraft(surfaceId, draft.path);
                      },
                    },
                    'Keep my edit',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: (): void => {
                        store.discard(surfaceId, draft.path);
                      },
                    },
                    'Use server value',
                  ),
                ),
            ),
          )
        : null,
      safeRender('root'),
      drafts.length > 0
        ? h(
            'div',
            { className: 'anui-draft-bar' },
            h('span', null, `${drafts.length} local change${drafts.length === 1 ? '' : 's'}`),
            h(
              'button',
              {
                type: 'button',
                className: 'anui-link',
                onClick: (): void => {
                  store.discard(surfaceId);
                },
              },
              'Discard local changes',
            ),
          )
        : null,
    );
  };
  return {
    render,
    dispose(): void {
      errors.clear();
      custom.clear();
    },
  };
}
