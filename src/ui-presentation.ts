import type { Json, JsonObject } from './ui/types.js';
import { boundedString, byteLength, jsonObject, jsonValue } from './ui/json.js';
/** Presentation registration is not authorization. The existing executor owns all effects. */
export type CapabilityPresentation = {
  readonly capabilityId: string;
  readonly catalogId: string;
  readonly resourceUri: string;
  readonly name: string;
};
export type UiResource = {
  readonly capabilityId: string;
  readonly uri: string;
  readonly name: string;
  readonly html: string;
};
export class PresentationRegistry {
  private readonly entries: Map<string, CapabilityPresentation> = new Map();
  public constructor(
    knownCapabilityIds: readonly string[],
    presentations: readonly CapabilityPresentation[],
  ) {
    const known: ReadonlySet<string> = new Set(knownCapabilityIds);
    let uris: Set<string> = new Set();
    for (const presentation of presentations) {
      if (
        !known.has(presentation.capabilityId) ||
        this.entries.has(presentation.capabilityId) ||
        uris.has(presentation.resourceUri) ||
        !boundedString(presentation.name, 120) ||
        !boundedString(presentation.catalogId, 512) ||
        !/^ui:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\/[A-Za-z0-9._~/-]+$/.test(
          presentation.resourceUri,
        ) ||
        presentation.resourceUri.length > 256 ||
        presentation.resourceUri
          .split('/')
          .some((part: string): boolean => part === '.' || part === '..')
      ) {
        throw new TypeError(
          'Presentation must identify a known capability and a unique bounded ui:// resource.',
        );
      }
      this.entries.set(presentation.capabilityId, Object.freeze({ ...presentation }));
      uris.add(presentation.resourceUri);
    }
  }
  public get(capabilityId: string): CapabilityPresentation | undefined {
    return this.entries.get(capabilityId);
  }
  /** Pass these to existing createMcpAppsHandler. Its authorization and CSP checks remain required. */
  public resources(
    htmlFor: (presentation: CapabilityPresentation) => string,
  ): readonly UiResource[] {
    return [...this.entries.values()].map((presentation: CapabilityPresentation): UiResource => {
      const html: string = htmlFor(presentation);
      if (!boundedString(html, 1048576) || byteLength(html) > 1048576)
        throw new TypeError('UI resource exceeds its byte limit.');
      return Object.freeze({
        capabilityId: presentation.capabilityId,
        uri: presentation.resourceUri,
        name: presentation.name,
        html,
      });
    });
  }
}
export type PresentationValue = {
  readonly summary: string;
  readonly data: Json;
  readonly a2ui: readonly JsonObject[];
};
/** Use only when this value is part of the capability's declared, validated output schema. */
export function presentationValue(
  summary: string,
  data: Json,
  a2ui: readonly JsonObject[],
): PresentationValue {
  if (
    !summary.trim() ||
    summary.length > 16000 ||
    !jsonValue(data) ||
    !a2ui.every(jsonObject) ||
    byteLength(JSON.stringify(a2ui)) > 262144
  )
    throw new TypeError('Invalid presentation value.');
  return { summary, data, a2ui };
}
