import type { ActionDefinition, ActionOutcome, ActionPort, ActionReceipt, ActionRequest, ApplyResult, Component, Draft, FunctionDefinition, Json, JsonObject, SurfaceSnapshot, UiAction, UiLimits } from './types.js';
import { CatalogRegistry, defaultCatalog } from './catalog.js';
import { boundedString, byteLength, clone, freezeJson, identifier, isObject, jsonObject, jsonValue, onlyKeys, own, pointer, readAt, same, writeAt } from './json.js';
type MutableSurface = {
    id: string;
    catalogId: string;
    revision: number;
    generation: number;
    components: Map<string, Component>;
    data: JsonObject;
    drafts: Map<string, Draft>;
    receipts: Map<string, ActionReceipt>;
    sendDataModel: boolean;
};
export type StoreOptions = {
    readonly catalogs?: CatalogRegistry;
    readonly actions?: readonly ActionDefinition[];
    readonly actionPort?: ActionPort;
    readonly limits?: Partial<UiLimits>;
    readonly requestId?: () => string;
};
const DEFAULT_LIMITS: UiLimits = Object.freeze({ maxMessageBytes: 262144, maxComponents: 512, maxSurfaces: 8, maxDepth: 32, maxDataBytes: 262144 });
const CAPABILITY: RegExp = /^[A-Za-z0-9._-]+:[A-Za-z0-9._-]+@[1-9][0-9]*$/;
function reject(message: string, kind: 'invalid-message' | 'unsupported' | 'integrity' | 'limit' | 'invalid-action' = 'invalid-message'): ApplyResult {
    return { kind: 'rejected', issue: { kind, message } };
}
export class UiStore {
    public readonly catalogs: CatalogRegistry;
    public readonly limits: UiLimits;
    private readonly surfaces: Map<string, MutableSurface> = new Map();
    private readonly actions: Map<string, ActionDefinition> = new Map();
    private readonly listeners: Set<() => void> = new Set();
    private readonly options: StoreOptions;
    private sequence: number = 0;
    private generation: number = 0;
    private version: number = 0;
    public constructor(options: StoreOptions = {}) {
        this.options = options;
        this.catalogs = options.catalogs ?? new CatalogRegistry([defaultCatalog()]);
        this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...options.limits });
        for (const value of Object.values(this.limits))
            if (!Number.isSafeInteger(value) || value < 1)
                throw new TypeError('Limits must be positive integers.');
        for (const definition of options.actions ?? []) {
            if (!identifier(definition.name) || !CAPABILITY.test(definition.capabilityId) || this.actions.has(definition.name))
                throw new TypeError('Invalid or duplicate action registration.');
            if (definition.risk !== 'read' && options.requestId === undefined)
                throw new TypeError('Writes require an application-supplied globally unique requestId factory.');
            this.actions.set(definition.name, Object.freeze({ ...definition }));
        }
    }
    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return (): void => { this.listeners.delete(listener); };
    }
    public getVersion(): number { return this.version; }
    public ids(): readonly string[] { return [...this.surfaces.keys()]; }
    private notify(): void {
        this.version += 1;
        for (const listener of this.listeners) {
            try {
                listener();
            }
            catch { /* A view failure cannot roll back an accepted update. */ }
        }
    }
    public snapshot(id: string): SurfaceSnapshot | undefined {
        const s: MutableSurface | undefined = this.surfaces.get(id);
        if (s === undefined)
            return undefined;
        return { id: s.id, catalogId: s.catalogId, revision: s.revision, components: new Map(s.components), data: s.data, drafts: new Map(s.drafts), receipts: new Map(s.receipts), sendDataModel: s.sendDataModel };
    }
    public data(id: string): JsonObject {
        const s: MutableSurface | undefined = this.surfaces.get(id);
        if (s === undefined)
            return {};
        let data: JsonObject = clone(s.data);
        for (const draft of s.drafts.values()) {
            try {
                data = writeAt(data, draft.path, draft.value);
            }
            catch { /* Keep conflicting edits for explicit recovery. */ }
        }
        return freezeJson(data);
    }
    public read(id: string, path: string): Json | undefined { return readAt(this.data(id), path); }
    public edit(id: string, path: string, value: unknown): void {
        const s: MutableSurface | undefined = this.surfaces.get(id);
        if (s === undefined || !pointer(path) || path === '' || path === '/' || !jsonValue(value, this.limits.maxDepth))
            throw new TypeError('Invalid local edit.');
        const before: Json | undefined = readAt(s.data, path);
        // Drafts may not overlap: parent and child edits would have ambiguous precedence.
        for (const existing of s.drafts.keys())
            if (existing !== path && (existing.startsWith(`${path}/`) || path.startsWith(`${existing}/`)))
                throw new TypeError('Overlapping draft paths are not allowed.');
        const result: JsonObject = writeAt(this.data(id), path, value);
        if (byteLength(JSON.stringify(result)) > this.limits.maxDataBytes)
            throw new TypeError('Edited data exceeds the configured limit.');
        if (same(before, value))
            s.drafts.delete(path);
        else
            s.drafts.set(path, Object.freeze({ path, value: freezeJson(clone(value)), baseValue: s.drafts.get(path)?.baseValue ?? before, conflicted: s.drafts.get(path)?.conflicted ?? false }));
        s.revision += 1;
        this.notify();
    }
    public discard(id: string, path?: string): void {
        const s: MutableSurface | undefined = this.surfaces.get(id);
        if (s === undefined)
            return;
        if (path === undefined)
            s.drafts.clear();
        else
            s.drafts.delete(path);
        s.revision += 1;
        this.notify();
    }
    public keepDraft(id: string, path: string): void {
        const s: MutableSurface | undefined = this.surfaces.get(id);
        const draft: Draft | undefined = s?.drafts.get(path);
        if (s === undefined || draft === undefined)
            return;
        s.drafts.set(path, Object.freeze({ ...draft, baseValue: readAt(s.data, path), conflicted: false }));
        s.revision += 1;
        this.notify();
    }
    private validateComponents(components: unknown, s: MutableSurface): Map<string, Component> {
        if (!Array.isArray(components) || components.length > this.limits.maxComponents)
            throw new TypeError('Invalid component list.');
        let next: Map<string, Component> = new Map(s.components);
        let seen: Set<string> = new Set();
        for (const candidate of components) {
            if (!this.catalogs.validate(candidate, s.catalogId) || seen.has(candidate.id))
                throw new TypeError('Invalid, unknown or duplicate component.');
            seen.add(candidate.id);
            next.set(candidate.id, freezeJson(clone(candidate)));
        }
        if (next.size > this.limits.maxComponents)
            throw new TypeError('Surface component limit exceeded.');
        let active: Set<string> = new Set();
        let heights: Map<string, number> = new Map();
        const height = (id: string): number => {
            const cached: number | undefined = heights.get(id);
            if (cached !== undefined)
                return cached;
            if (active.has(id))
                throw new TypeError('Cyclic component graph.');
            if (active.size > this.limits.maxDepth)
                throw new TypeError('Component depth exceeded.');
            const c: Component | undefined = next.get(id);
            if (c === undefined)
                return 0;
            active.add(id);
            let result: number = 1;
            for (const child of this.catalogs.children(c, s.catalogId))
                result = Math.max(result, 1 + height(child));
            active.delete(id);
            if (result > this.limits.maxDepth)
                throw new TypeError('Component depth exceeded.');
            heights.set(id, result);
            return result;
        };
        for (const id of next.keys())
            height(id);
        return next;
    }
    public apply(input: unknown): ApplyResult {
        if (!jsonObject(input) || byteLength(JSON.stringify(input)) > this.limits.maxMessageBytes)
            return reject('Message must be bounded JSON.', 'limit');
        if (input.version !== '1.0')
            return reject('Only the documented A2UI 1.0 profile is supported.', 'unsupported');
        const keys: string[] = Object.keys(input).filter((key: string): boolean => key !== 'version');
        if (keys.length !== 1)
            return reject('Expected exactly one A2UI message operation.');
        const kind: string = keys[0] ?? '';
        const body: Json | undefined = input[kind];
        if (!jsonObject(body))
            return reject('Expected a message object.');
        if (kind === 'callRendererFunction')
            return this.callRendererFunction(body);
        if (!['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'].includes(kind))
            return reject('Unsupported A2UI message type.', 'unsupported');
        if (!boundedString(body.surfaceId, 256))
            return reject('Invalid surface ID.');
        const id: string = body.surfaceId;
        try {
            if (kind === 'createSurface') {
                if (!onlyKeys(body, ['surfaceId', 'catalogId', 'components', 'dataModel', 'sendDataModel']))
                    return reject('Unsupported createSurface property.');
                if (this.surfaces.has(id))
                    return reject('Surface already exists.', 'integrity');
                if (this.surfaces.size >= this.limits.maxSurfaces)
                    return reject('Surface limit exceeded.', 'limit');
                if (typeof body.catalogId !== 'string' || !this.catalogs.has(body.catalogId))
                    return reject('A registered default catalog is required by this profile.', 'unsupported');
                if (body.sendDataModel !== undefined && typeof body.sendDataModel !== 'boolean')
                    return reject('sendDataModel must be boolean.');
                if (body.sendDataModel === true)
                    return reject('Automatic full-model transport metadata is not supported by this profile; use explicit allowlisted context.', 'unsupported');
                const data: Json | undefined = body.dataModel ?? {};
                if (!jsonObject(data) || byteLength(JSON.stringify(data)) > this.limits.maxDataBytes)
                    return reject('Invalid data model.', 'limit');
                let s: MutableSurface = { id, catalogId: body.catalogId, revision: 0, generation: ++this.generation, components: new Map(), data: freezeJson(clone(data)), drafts: new Map(), receipts: new Map(), sendDataModel: false };
                s.components = this.validateComponents(body.components ?? [], s);
                this.surfaces.set(id, s);
            }
            else {
                const s: MutableSurface | undefined = this.surfaces.get(id);
                if (s === undefined)
                    return reject('Surface does not exist.', 'integrity');
                if (kind === 'deleteSurface') {
                    if (!onlyKeys(body, ['surfaceId']))
                        return reject('Unexpected deleteSurface property.');
                    this.surfaces.delete(id);
                }
                else if (kind === 'updateComponents') {
                    if (!onlyKeys(body, ['surfaceId', 'components']))
                        return reject('Unexpected updateComponents property.');
                    s.components = this.validateComponents(body.components, s);
                    s.revision += 1;
                }
                else {
                    if (!onlyKeys(body, ['surfaceId', 'path', 'value']) || body.path !== undefined && !pointer(body.path))
                        return reject('Invalid data-model update.');
                    const path: string = typeof body.path === 'string' ? body.path : '';
                    if (!own(body, 'value'))
                        return reject('updateDataModel requires value; null explicitly deletes.');
                    const isRoot: boolean = path === '' || path === '/';
                    const data: JsonObject = body.value === null && isRoot ? {} : writeAt(s.data, path, body.value === null ? undefined : body.value);
                    if (byteLength(JSON.stringify(data)) > this.limits.maxDataBytes)
                        return reject('Data model limit exceeded.', 'limit');
                    s.data = freezeJson(data);
                    for (const [key, draft] of s.drafts) {
                        const remote: Json | undefined = readAt(data, key);
                        s.drafts.set(key, Object.freeze({ ...draft, conflicted: !same(remote, draft.baseValue) && !same(remote, draft.value) }));
                    }
                    s.revision += 1;
                }
            }
            this.notify();
            return { kind: 'applied', surfaceId: id };
        }
        catch {
            return reject('Message failed validation; previous state was preserved.');
        }
    }
    public resolve(id: string, value: Json | undefined, catalogId?: string, depth: number = 0): Json | undefined {
        if (depth > this.limits.maxDepth)
            throw new TypeError('Expression depth exceeded.');
        if (isObject(value) && own(value, '@path')) {
            if (!onlyKeys(value, ['@path']) || !pointer(value['@path']))
                throw new TypeError('Invalid binding.');
            return this.read(id, value['@path']);
        }
        if (isObject(value) && own(value, '@call')) {
            const call: JsonObject = value as JsonObject;
            const resolvedCatalog: string = typeof call.catalogId === 'string' ? call.catalogId : catalogId ?? this.surfaces.get(id)?.catalogId ?? '';
            const fn: FunctionDefinition | undefined = this.catalogs.function(resolvedCatalog, String(call['@call']));
            if (fn === undefined || fn.allowedCallers === 'agentOnly' || fn.requiresUserActivation === true)
                throw new TypeError('Function is not available in passive bindings.');
            const args: JsonObject = this.resolveObject(id, jsonObject(call.args) ? call.args : {}, resolvedCatalog, depth + 1);
            if (!fn.validate(args))
                throw new TypeError('Invalid function arguments.');
            const result: Json = fn.evaluate(args);
            if (!jsonValue(result))
                throw new TypeError('Invalid function result.');
            return result;
        }
        return value;
    }
    private resolveObject(id: string, object: JsonObject, catalogId: string, depth: number = 0): JsonObject {
        if (depth > this.limits.maxDepth)
            throw new TypeError('Expression depth exceeded.');
        let result: Record<string, Json> = {};
        for (const [key, value] of Object.entries(object)) {
            if (isObject(value) && !own(value, '@call') && !own(value, '@path'))
                result[key] = this.resolveObject(id, value as JsonObject, catalogId, depth + 1);
            else if (Array.isArray(value))
                result[key] = value.map((entry: Json): Json => this.resolve(id, entry, catalogId, depth + 1) ?? null);
            else
                result[key] = this.resolve(id, value, catalogId, depth + 1) ?? null;
        }
        return result;
    }
    private callRendererFunction(body: JsonObject): ApplyResult {
        if (!onlyKeys(body, ['surfaceId', 'functionCallId', 'callFunction']) || !boundedString(body.functionCallId, 128) || !jsonObject(body.callFunction))
            return reject('Malformed function invocation.');
        const callId: string = body.functionCallId;
        const call: JsonObject = body.callFunction;
        const fail = (): ApplyResult => ({ kind: 'applied', response: { version: '1.0', rendererFunctionResponse: { functionCallId: callId, error: { code: 'INVALID_FUNCTION_CALL', message: 'Function is not permitted or arguments are invalid.' } } } });
        if (!onlyKeys(call, ['@call', 'catalogId', 'args']) || !identifier(call['@call']) || typeof call.catalogId !== 'string' || call.args !== undefined && !jsonObject(call.args))
            return fail();
        if (body.surfaceId !== undefined && (typeof body.surfaceId !== 'string' || !this.surfaces.has(body.surfaceId)))
            return fail();
        const fn: FunctionDefinition | undefined = this.catalogs.function(call.catalogId, call['@call']);
        if (fn === undefined || fn.allowedCallers === 'rendererOnly' || fn.requiresUserActivation === true)
            return fail();
        try {
            const args: JsonObject = this.resolveObject(typeof body.surfaceId === 'string' ? body.surfaceId : '', jsonObject(call.args) ? call.args : {}, call.catalogId);
            if (!fn.validate(args))
                return fail();
            const value: Json = fn.evaluate(args);
            if (!jsonValue(value) || byteLength(JSON.stringify(value)) > this.limits.maxMessageBytes)
                return fail();
            return { kind: 'applied', response: { version: '1.0', rendererFunctionResponse: { functionCallId: callId, value } } };
        }
        catch {
            return fail();
        }
    }
    public actionAvailable(name: string): boolean { return this.actions.has(name) && this.options.actionPort !== undefined; }
    public async dispatch(id: string, componentId: string): Promise<ActionOutcome> {
        const s: MutableSurface | undefined = this.surfaces.get(id);
        const component: Component | undefined = s?.components.get(componentId);
        if (s === undefined || component === undefined || !jsonObject(component.action) || !jsonObject(component.action.event))
            return { kind: 'denied', message: 'No registered action on this component.' };
        const event: JsonObject = component.action.event;
        const name: string = String(event.name);
        const definition: ActionDefinition | undefined = this.actions.get(name);
        if (definition === undefined || this.options.actionPort === undefined)
            return { kind: 'denied', message: 'No authorized action adapter is configured.' };
        const previous: ActionReceipt | undefined = s.receipts.get(name);
        if (previous?.kind === 'pending' || previous?.kind === 'uncertain')
            return { kind: 'uncertain', message: 'Resolve the existing operation before retrying.' };
        let context: JsonObject;
        try {
            if (this.resolve(id, component.disabled) === true)
                return { kind: 'denied', message: 'Action is disabled.' };
            if ([...s.drafts.values()].some((draft: Draft): boolean => draft.conflicted))
                return { kind: 'denied', message: 'Resolve conflicting edits before submitting.' };
            context = this.resolveObject(id, jsonObject(event.context) ? event.context : {}, s.catalogId);
            if (!definition.validate(context))
                return { kind: 'denied', message: 'Action input is invalid.' };
        }
        catch {
            return { kind: 'denied', message: 'Action input is invalid.' };
        }
        const requestId: string = this.options.requestId?.() ?? `ui_${s.generation}_${++this.sequence}`;
        if (!boundedString(requestId, 128))
            return { kind: 'error', message: 'Invalid request identity.' };
        const action: UiAction = Object.freeze({ name, surfaceId: id, sourceComponentId: componentId, timestamp: new Date().toISOString(), context: freezeJson(clone(context)) });
        const request: ActionRequest = Object.freeze({ kind: 'capability-action', requestId, capabilityId: definition.capabilityId, surfaceId: id, revision: s.revision, action });
        const submitted: Map<string, Draft> = new Map(s.drafts);
        s.receipts.set(name, Object.freeze({ requestId, kind: 'pending', message: 'Awaiting authoritative result.' }));
        this.notify();
        let outcome: ActionOutcome;
        try {
            outcome = await this.options.actionPort.execute(request);
        }
        catch {
            outcome = definition.risk === 'read' ? { kind: 'error', message: 'Request failed.' } : { kind: 'uncertain', message: 'The operation may have completed. Check server state before retrying.' };
        }
        if (!jsonObject(outcome) || !['success', 'denied', 'error', 'uncertain'].includes(outcome.kind) || outcome.kind === 'success' && (!jsonValue(outcome.value) || outcome.messages !== undefined && (!Array.isArray(outcome.messages) || outcome.messages.length > 64 || !outcome.messages.every((m: unknown): boolean => jsonObject(m) && ((jsonObject(m.updateDataModel) && m.updateDataModel.surfaceId === id) || (jsonObject(m.updateComponents) && m.updateComponents.surfaceId === id))))))
            outcome = { kind: 'uncertain', message: 'The adapter returned an invalid result. Check server state.' };
        if (this.surfaces.get(id) !== s)
            return outcome; // A deleted/recreated surface cannot receive a stale completion.
        if (outcome.kind === 'success') {
            for (const message of outcome.messages ?? []) {
                const result: ApplyResult = this.apply(message);
                if (result.kind === 'rejected') {
                    outcome = { kind: 'uncertain', message: 'The operation succeeded but its snapshot was invalid. Refresh authoritative state.' };
                    break;
                }
            }
            if (outcome.kind === 'success')
                for (const [path, sent] of submitted) {
                    const now: Draft | undefined = s.drafts.get(path);
                    if (now !== undefined && same(now.value, sent.value) && same(readAt(s.data, path), sent.value))
                        s.drafts.delete(path);
                }
        }
        const message: string = outcome.kind === 'success' ? 'Completed.' : typeof outcome.message === 'string' ? outcome.message.slice(0, 400) : 'Operation did not complete.';
        s.receipts.set(name, Object.freeze({ requestId, kind: outcome.kind, message }));
        this.notify();
        return outcome;
    }
    /** Only call after the application has reconciled this request with authoritative state. */
    public reconcile(id: string, actionName: string, requestId: string, outcome: ActionReceipt['kind'], message: string): void {
        const s: MutableSurface | undefined = this.surfaces.get(id);
        const receipt: ActionReceipt | undefined = s?.receipts.get(actionName);
        if (s === undefined || receipt === undefined || receipt.requestId !== requestId || receipt.kind !== 'uncertain' || outcome === 'pending')
            throw new TypeError('No matching uncertain operation.');
        s.receipts.set(actionName, Object.freeze({ requestId, kind: outcome, message: message.slice(0, 400) }));
        this.notify();
    }
}
