/** Portable, JSON-only contracts. No renderer, model provider or authorization SDK. */
export type Json = null | boolean | number | string | readonly Json[] | JsonObject;
export type JsonObject = {
    readonly [key: string]: Json;
};
export type DataBinding = {
    readonly '@path': string;
};
export type FunctionCall = {
    readonly '@call': string;
    readonly catalogId?: string;
    readonly args?: JsonObject;
};
export type Component = JsonObject & {
    readonly id: string;
    readonly component: string;
};
export type UiAction = {
    readonly name: string;
    readonly surfaceId: string;
    readonly sourceComponentId: string;
    readonly timestamp: string;
    readonly context: JsonObject;
};
export type ActionRequest = {
    readonly kind: 'capability-action';
    readonly requestId: string;
    readonly capabilityId: string;
    readonly surfaceId: string;
    readonly revision: number;
    readonly action: UiAction;
};
export type ActionOutcome = {
    readonly kind: 'success';
    readonly value: Json;
    readonly messages?: readonly JsonObject[];
} | {
    readonly kind: 'denied';
    readonly message: string;
} | {
    readonly kind: 'error';
    readonly message: string;
} | {
    readonly kind: 'uncertain';
    readonly message: string;
};
export type ActionReceipt = {
    readonly requestId: string;
    readonly kind: 'pending' | 'success' | 'denied' | 'error' | 'uncertain';
    readonly message: string;
};
export interface ActionPort {
    /** Application adapter MUST use the existing server-side authorization/executor. */
    execute(request: ActionRequest): Promise<ActionOutcome>;
}
export type ActionDefinition = {
    readonly name: string;
    readonly capabilityId: string;
    readonly risk: 'read' | 'write' | 'destructive';
    readonly validate: (context: JsonObject) => boolean;
};
export type FunctionDefinition = {
    readonly name: string;
    readonly allowedCallers: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';
    readonly requiresUserActivation?: boolean;
    readonly validate: (args: JsonObject) => boolean;
    readonly evaluate: (args: JsonObject) => Json;
};
export type ComponentDefinition = {
    readonly name: string;
    readonly properties: readonly string[];
    readonly required?: readonly string[];
    readonly childFields?: readonly string[];
    readonly validate: (component: Component) => boolean;
};
export type Catalog = {
    readonly id: string;
    readonly components: readonly ComponentDefinition[];
    readonly functions?: readonly FunctionDefinition[];
};
export type Draft = {
    readonly path: string;
    readonly value: Json;
    readonly baseValue: Json | undefined;
    readonly conflicted: boolean;
};
export type SurfaceSnapshot = {
    readonly id: string;
    readonly catalogId: string;
    readonly revision: number;
    readonly components: ReadonlyMap<string, Component>;
    readonly data: JsonObject;
    readonly drafts: ReadonlyMap<string, Draft>;
    readonly receipts: ReadonlyMap<string, ActionReceipt>;
    readonly sendDataModel: boolean;
};
export type UiIssue = {
    readonly kind: 'invalid-message' | 'unsupported' | 'integrity' | 'limit' | 'invalid-action';
    readonly message: string;
};
export type ApplyResult = {
    readonly kind: 'applied';
    readonly surfaceId?: string;
    readonly response?: JsonObject;
} | {
    readonly kind: 'rejected';
    readonly issue: UiIssue;
};
export type UiLimits = {
    readonly maxMessageBytes: number;
    readonly maxComponents: number;
    readonly maxSurfaces: number;
    readonly maxDepth: number;
    readonly maxDataBytes: number;
};
