import type { Catalog, Component, ComponentDefinition, FunctionDefinition, Json, JsonObject } from './types.js';
import { identifier, isObject, jsonObject, onlyKeys, pointer } from './json.js';
export const UI_CATALOG_ID: string = 'urn:uppercut:agent-native-ui:catalog:1';
const COMMON: readonly string[] = ['id', 'component', '@catalogId', '@accessibility'];
export function dynamic(value: unknown): boolean {
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' || value === null)
        return true;
    if (!isObject(value))
        return false;
    if ('@path' in value)
        return onlyKeys(value, ['@path']) && pointer(value['@path']);
    if ('@call' in value)
        return onlyKeys(value, ['@call', 'args', 'catalogId']) && identifier(value['@call']) &&
            (value.args === undefined || jsonObject(value.args)) && (value.catalogId === undefined || typeof value.catalogId === 'string');
    return false;
}
function field(component: Component, key: string): boolean {
    return component[key] === undefined || dynamic(component[key]);
}
function arrayOrBinding(value: unknown): boolean {
    return Array.isArray(value) || (isObject(value) && onlyKeys(value, ['@path']) && pointer(value['@path']));
}
function action(value: unknown): boolean {
    if (!isObject(value) || !onlyKeys(value, ['event']) || !isObject(value.event))
        return false;
    return onlyKeys(value.event, ['name', 'context']) && identifier(value.event.name) &&
        (value.event.context === undefined || jsonObject(value.event.context));
}
function definition(name: string, properties: readonly string[], required: readonly string[], validate: (c: Component) => boolean, childFields: readonly string[] = []): ComponentDefinition {
    return Object.freeze({ name, properties: Object.freeze([...properties]), required: Object.freeze([...required]), validate, childFields: Object.freeze([...childFields]) });
}
function children(c: Component): boolean {
    return Array.isArray(c.children) && c.children.length <= 256 && c.children.every(identifier);
}
function input(c: Component): boolean {
    return typeof c.label === 'string' && field(c, 'value') && field(c, 'disabled') &&
        (c.value === undefined || isObject(c.value) && onlyKeys(c.value, ['@path']) && pointer(c.value['@path']));
}
function numeric(c: Component): boolean {
    return input(c) && ['min', 'max', 'step'].every((key: string): boolean => c[key] === undefined || typeof c[key] === 'number') &&
        (typeof c.step !== 'number' || c.step > 0) &&
        (typeof c.min !== 'number' || typeof c.max !== 'number' || c.min <= c.max);
}
export const DEFAULT_COMPONENTS: readonly ComponentDefinition[] = Object.freeze([
    definition('Column', ['children', 'label'], ['children'], children, ['children']),
    definition('Row', ['children', 'label'], ['children'], children, ['children']),
    definition('Card', ['children', 'title'], ['children'], children, ['children']),
    definition('Tabs', ['children', 'labels', 'value', 'label'], ['children', 'labels', 'value'], (c: Component): boolean => children(c) && Array.isArray(c.labels) && c.labels.length === (c.children as readonly Json[]).length && c.labels.every((v: Json): boolean => typeof v === 'string') && field(c, 'value'), ['children']),
    definition('Text', ['text', 'variant'], ['text'], (c: Component): boolean => field(c, 'text') && (c.variant === undefined || ['body', 'heading', 'caption', 'code'].includes(String(c.variant)))),
    definition('Status', ['text', 'kind'], ['text'], (c: Component): boolean => field(c, 'text') && (c.kind === undefined || ['loading', 'empty', 'error', 'denied', 'success', 'info'].includes(String(c.kind)))),
    definition('Divider', [], [], (): boolean => true),
    definition('TextField', ['label', 'value', 'disabled', 'multiline', 'placeholder'], ['label', 'value'], input),
    definition('NumberField', ['label', 'value', 'disabled', 'min', 'max', 'step'], ['label', 'value'], numeric),
    definition('CheckBox', ['label', 'value', 'disabled'], ['label', 'value'], input),
    definition('ChoicePicker', ['label', 'value', 'disabled', 'options', 'variant'], ['label', 'value', 'options'], (c: Component): boolean => input(c) && Array.isArray(c.options) && c.options.length <= 100 && c.options.every((v: Json): boolean => isObject(v) && onlyKeys(v, ['label', 'value']) && typeof v.label === 'string' && typeof v.value === 'string') && (c.variant === undefined || ['select', 'radio'].includes(String(c.variant)))),
    definition('Slider', ['label', 'value', 'disabled', 'min', 'max', 'step', 'suffix'], ['label', 'value', 'min', 'max'], numeric),
    definition('Button', ['label', 'action', 'disabled', 'variant'], ['label', 'action'], (c: Component): boolean => field(c, 'label') && field(c, 'disabled') && action(c.action) && (c.variant === undefined || ['primary', 'secondary'].includes(String(c.variant)))),
    definition('DecisionCard', ['title', 'description', 'action', 'label', 'disabled'], ['title', 'action', 'label'], (c: Component): boolean => field(c, 'title') && field(c, 'description') && action(c.action)),
    definition('Diff', ['label', 'before', 'after'], ['before', 'after'], (c: Component): boolean => field(c, 'before') && field(c, 'after')),
    definition('Table', ['label', 'rows', 'columns', 'selection', 'sort', 'emptyText'], ['rows', 'columns'], (c: Component): boolean => arrayOrBinding(c.rows) && Array.isArray(c.columns) && c.columns.length > 0 && c.columns.length <= 16 && c.columns.every((v: Json): boolean => isObject(v) && onlyKeys(v, ['key', 'label']) && identifier(v.key) && typeof v.label === 'string') && field(c, 'selection') && field(c, 'sort')),
    definition('List', ['label', 'items', 'selection', 'emptyText'], ['items'], (c: Component): boolean => arrayOrBinding(c.items) && field(c, 'selection')),
    definition('Chart', ['label', 'points', 'max'], ['label', 'points'], (c: Component): boolean => field(c, 'label') && arrayOrBinding(c.points) && field(c, 'max')),
    definition('Output', ['label', 'value', 'suffix'], ['label', 'value'], (c: Component): boolean => field(c, 'value')),
    definition('Audio', ['label', 'source'], ['source'], (c: Component): boolean => field(c, 'source')),
    definition('Video', ['label', 'source'], ['source'], (c: Component): boolean => field(c, 'source')),
    definition('Timeline', ['label', 'value', 'end', 'duration', 'mediaId'], ['value', 'duration'], (c: Component): boolean => field(c, 'value') && field(c, 'duration') && field(c, 'end') && (c.mediaId === undefined || identifier(c.mediaId))),
    definition('Transcript', ['label', 'lines', 'position', 'mediaId'], ['lines'], (c: Component): boolean => arrayOrBinding(c.lines) && field(c, 'position') && (c.mediaId === undefined || identifier(c.mediaId))),
    definition('Annotations', ['label', 'items', 'position', 'duration'], ['items', 'position', 'duration'], (c: Component): boolean => arrayOrBinding(c.items) && field(c, 'position') && field(c, 'duration')),
    definition('ActionResult', ['actionName'], ['actionName'], (c: Component): boolean => identifier(c.actionName)),
]);
const DEFAULT_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
    {
        name: 'probability', allowedCallers: 'rendererOrAgent',
        validate(args: JsonObject): boolean {
            return typeof args.attempts === 'number' && Number.isInteger(args.attempts) && args.attempts >= 0 && args.attempts <= 10000 && typeof args.rate === 'number' && args.rate >= 0 && args.rate <= 1;
        },
        evaluate(args: JsonObject): Json {
            const attempts: number = Number(args.attempts);
            const rate: number = Number(args.rate);
            return attempts === 0 ? 0 : rate === 1 ? 100 : Math.round(-Math.expm1(attempts * Math.log1p(-rate)) * 10000) / 100;
        },
    },
    {
        name: 'percent', allowedCallers: 'rendererOrAgent',
        validate(args: JsonObject): boolean { return typeof args.value === 'number' && Number.isFinite(args.value); },
        evaluate(args: JsonObject): Json { return `${Math.round(Number(args.value) * 100) / 100}%`; },
    },
]);
export function defaultCatalog(): Catalog {
    return { id: UI_CATALOG_ID, components: DEFAULT_COMPONENTS, functions: DEFAULT_FUNCTIONS };
}
export class CatalogRegistry {
    private readonly catalogs: Map<string, Catalog> = new Map();
    public constructor(catalogs: readonly Catalog[]) {
        for (const catalog of catalogs) {
            if (!catalog.id || catalog.id.length > 512 || this.catalogs.has(catalog.id))
                throw new TypeError('Invalid or duplicate catalog ID.');
            let names: Set<string> = new Set();
            for (const component of catalog.components) {
                if (!identifier(component.name) || names.has(component.name))
                    throw new TypeError('Invalid or duplicate component registration.');
                names.add(component.name);
            }
            let functions: Set<string> = new Set();
            for (const fn of catalog.functions ?? []) {
                if (!identifier(fn.name) || functions.has(fn.name) || fn.requiresUserActivation === true && fn.allowedCallers !== 'rendererOnly')
                    throw new TypeError('Invalid function registration.');
                functions.add(fn.name);
            }
            this.catalogs.set(catalog.id, Object.freeze({ ...catalog, components: Object.freeze([...catalog.components]), functions: Object.freeze([...(catalog.functions ?? [])]) }));
        }
    }
    /** Serializable agent discovery only, not an upstream JSON Schema catalog. */
    public describe(): JsonObject {
        return {
            protocolVersion: '1.0',
            profile: 'agent-native-ui-bounded-v1',
            catalogs: [...this.catalogs.values()].map((catalog: Catalog): JsonObject => ({
                catalogId: catalog.id,
                components: catalog.components.map((component: ComponentDefinition): JsonObject => ({
                    component: component.name, properties: [...component.properties],
                    required: [...(component.required ?? [])], childFields: [...(component.childFields ?? [])],
                })),
                functions: (catalog.functions ?? []).map((fn: FunctionDefinition): JsonObject => ({
                    name: fn.name, allowedCallers: fn.allowedCallers, requiresUserActivation: fn.requiresUserActivation === true,
                })),
            })),
        };
    }
    public has(id: string): boolean { return this.catalogs.has(id); }
    public ids(): readonly string[] { return [...this.catalogs.keys()]; }
    public definition(catalogId: string, componentName: string): ComponentDefinition | undefined {
        return this.catalogs.get(catalogId)?.components.find((c: ComponentDefinition): boolean => c.name === componentName);
    }
    public function(catalogId: string, name: string): FunctionDefinition | undefined {
        return this.catalogs.get(catalogId)?.functions?.find((fn: FunctionDefinition): boolean => fn.name === name);
    }
    public validate(component: unknown, defaultId: string): component is Component {
        if (!jsonObject(component) || !identifier(component.id) || !identifier(component.component))
            return false;
        const catalogId: string = typeof component['@catalogId'] === 'string' ? component['@catalogId'] : defaultId;
        const definition: ComponentDefinition | undefined = this.definition(catalogId, component.component);
        if (definition === undefined || !onlyKeys(component, [...COMMON, ...definition.properties]))
            return false;
        if (!(definition.required ?? []).every((key: string): boolean => component[key] !== undefined))
            return false;
        if (component['@accessibility'] !== undefined) {
            const a: Json | undefined = component['@accessibility'];
            if (!isObject(a) || !onlyKeys(a, ['label', 'description', 'live', 'hidden']) ||
                a.label !== undefined && !dynamic(a.label) || a.description !== undefined && !dynamic(a.description) ||
                a.hidden !== undefined && !dynamic(a.hidden) || a.live !== undefined && !['off', 'polite', 'assertive'].includes(String(a.live)))
                return false;
        }
        try {
            return definition.validate(component as Component);
        }
        catch {
            return false;
        }
    }
    public children(component: Component, defaultId: string): readonly string[] {
        const catalogId: string = typeof component['@catalogId'] === 'string' ? component['@catalogId'] : defaultId;
        const definition: ComponentDefinition | undefined = this.definition(catalogId, component.component);
        let result: string[] = [];
        for (const key of definition?.childFields ?? []) {
            const value: Json | undefined = component[key];
            if (typeof value === 'string')
                result.push(value);
            else if (Array.isArray(value))
                result.push(...value.filter((item: Json): item is string => typeof item === 'string'));
        }
        return result;
    }
}
