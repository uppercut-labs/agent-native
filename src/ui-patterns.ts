import type { Component, JsonObject } from './ui/types.js';
import { UI_CATALOG_ID } from './ui/catalog.js';
import { identifier, jsonObject } from './ui/json.js';
function bind(path: string): JsonObject { return { '@path': path }; }
function surface(id: string, components: readonly Component[], dataModel: JsonObject): JsonObject {
    return { version: '1.0', createSurface: { surfaceId: id, catalogId: UI_CATALOG_ID, components, dataModel } };
}
export type ReviewRecord = {
    readonly id: string;
    readonly title: string;
    readonly category: string;
    readonly before: string;
    readonly draft: string;
};
export function reviewQueue(records: readonly ReviewRecord[], actionName: string = 'saveReview', surfaceId: string = 'review'): JsonObject {
    if (records.length > 50 || !identifier(actionName) || new Set(records.map((r: ReviewRecord): string => r.id)).size !== records.length || records.some((r: ReviewRecord): boolean => !identifier(r.id)))
        throw new TypeError('Review records need unique identifiers and a maximum of 50 entries.');
    let recordData: Record<string, JsonObject> = {};
    let components: Component[] = [
        { id: 'root', component: 'Column', children: ['header', 'table', ...records.map((record: ReviewRecord): string => `card_${record.id}`), 'save', 'result'] },
        { id: 'header', component: 'Text', text: 'Review queue', variant: 'heading' },
        { id: 'table', component: 'Table', label: 'Records', rows: bind('/rows'), selection: bind('/selected'), sort: bind('/sort'), columns: [{ key: 'title', label: 'Title' }, { key: 'category', label: 'Category' }], emptyText: 'No records to review.' },
        { id: 'save', component: 'Button', label: 'Save selected', action: { event: { name: actionName, context: { selected: bind('/selected'), records: bind('/records') } } }, variant: 'primary' },
        { id: 'result', component: 'ActionResult', actionName },
    ];
    for (const record of records) {
        recordData[record.id] = { title: record.title, before: record.before, draft: record.draft };
        components.push({ id: `card_${record.id}`, component: 'Card', title: record.title, children: [`edit_${record.id}`, `diff_${record.id}`] }, { id: `edit_${record.id}`, component: 'TextField', label: `Edit ${record.title}`, multiline: true, value: bind(`/records/${record.id}/draft`) }, { id: `diff_${record.id}`, component: 'Diff', before: bind(`/records/${record.id}/before`), after: bind(`/records/${record.id}/draft`) });
    }
    return surface(surfaceId, components, { records: recordData, rows: records.map((r: ReviewRecord): JsonObject => ({ id: r.id, title: r.title, category: r.category })), selected: [], sort: 'title' });
}
export function parameterExplorer(surfaceId: string = 'explore'): JsonObject {
    let components: Component[] = [
        { id: 'root', component: 'Column', children: ['heading', 'description', 'controls', 'answer', 'chart'] },
        { id: 'heading', component: 'Text', text: 'Probability explorer', variant: 'heading' },
        { id: 'description', component: 'Text', text: 'Adjust independent attempts and the per-attempt success rate. The result is calculated locally.' },
        { id: 'controls', component: 'Row', children: ['attempts', 'rate'] },
        { id: 'attempts', component: 'Slider', label: 'Attempts', value: bind('/attempts'), min: 0, max: 30, step: 1 },
        { id: 'rate', component: 'Slider', label: 'Success rate', value: bind('/rate'), min: 0, max: 1, step: 0.01 },
        { id: 'answer', component: 'Output', label: 'Chance of at least one success', value: { '@call': 'probability', args: { attempts: bind('/attempts'), rate: bind('/rate') } }, suffix: '%' },
        { id: 'chart', component: 'Chart', label: 'Chance by attempt count', points: bind('/points'), max: 100 },
    ];
    // Chart points use the same trusted local function as the headline; no network or model call.
    const points: readonly JsonObject[] = [1, 3, 5, 10, 20, 30].map((attempts: number): JsonObject => ({ label: String(attempts), value: { '@call': 'probability', args: { attempts, rate: bind('/rate') } } }));
    return surface(surfaceId, components, { attempts: 3, rate: 0.07, points });
}
export type TranscriptLine = {
    readonly id: string;
    readonly start: number;
    readonly text: string;
};
export type MediaSource = {
    readonly kind: 'audio' | 'video';
    readonly source: string;
    readonly duration: number;
    readonly lines: readonly TranscriptLine[];
};
export function mediaAnnotation(media: MediaSource, actionName: string = 'saveAnnotations', surfaceId: string = 'media'): JsonObject {
    if (!Number.isFinite(media.duration) || media.duration < 0 || !identifier(actionName) || media.lines.length > 500 || media.lines.some((line: TranscriptLine): boolean => !identifier(line.id) || !Number.isFinite(line.start) || line.start < 0 || line.start > media.duration))
        throw new TypeError('Media duration and transcript timestamps must be valid.');
    return surface(surfaceId, [
        { id: 'root', component: 'Column', children: ['heading', 'player', 'timeline', 'transcript', 'annotations', 'save', 'result'] },
        { id: 'heading', component: 'Text', text: 'Media annotation', variant: 'heading' },
        { id: 'player', component: media.kind === 'audio' ? 'Audio' : 'Video', source: bind('/source'), label: 'Reference media' },
        { id: 'timeline', component: 'Timeline', label: 'Playhead', value: bind('/position'), end: bind('/end'), duration: bind('/duration'), mediaId: 'player' },
        { id: 'transcript', component: 'Transcript', label: 'Transcript', lines: bind('/lines'), position: bind('/position'), mediaId: 'player' },
        { id: 'annotations', component: 'Annotations', label: 'Annotations', items: bind('/annotations'), position: bind('/position'), duration: bind('/duration') },
        { id: 'save', component: 'Button', label: 'Save annotations', action: { event: { name: actionName, context: { annotations: bind('/annotations'), duration: bind('/duration') } } }, variant: 'primary' },
        { id: 'result', component: 'ActionResult', actionName },
    ], { source: media.source, duration: media.duration, position: 0, end: media.duration, lines: media.lines.map((line: TranscriptLine): JsonObject => ({ ...line })), annotations: [] });
}
export function validReviewInput(context: JsonObject): boolean {
    return Array.isArray(context.selected) && context.selected.length > 0 && context.selected.length <= 50 &&
        jsonObject(context.records) && context.selected.every((id: unknown): boolean => typeof id === 'string' && jsonObject(context.records) && jsonObject(context.records[id]));
}
export function validAnnotationInput(context: JsonObject): boolean {
    return typeof context.duration === 'number' && Number.isFinite(context.duration) && context.duration >= 0 && Array.isArray(context.annotations) && context.annotations.length <= 500 &&
        context.annotations.every((value: unknown): boolean => jsonObject(value) && typeof value.time === 'number' && value.time >= 0 && typeof context.duration === 'number' && value.time <= context.duration && typeof value.text === 'string' && value.text.length <= 5000);
}
