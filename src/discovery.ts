import { canonicalCapabilityId, type CapabilityDefinition } from './core/contracts.js';

export type CapabilitySurface = 'browser' | 'cli' | 'http' | 'mcp';

export type CapabilitySurfaceExposure = Partial<
  Readonly<
    Record<
      CapabilitySurface,
      {
        readonly destructive?: readonly string[];
      }
    >
  >
>;

export type DiscoveryDenialReason =
  | 'authorization-unavailable'
  | 'authorization-denied'
  | 'surface-not-exposed';

export type DiscoveryDecision =
  | { readonly visible: true }
  | { readonly visible: false; readonly reason: DiscoveryDenialReason };

export type CapabilityDiscoveryAuthorizer = (
  definition: CapabilityDefinition<unknown, unknown>,
) => boolean | Promise<boolean>;

export function isDestructiveCapabilityExposed(
  definition: CapabilityDefinition<unknown, unknown>,
  surface: CapabilitySurface,
  exposure?: CapabilitySurfaceExposure,
): boolean {
  return (
    definition.risk !== 'destructive' ||
    exposure?.[surface]?.destructive?.includes(canonicalCapabilityId(definition.identity)) === true
  );
}

export async function evaluateCapabilityDiscovery(
  definition: CapabilityDefinition<unknown, unknown>,
  surface: CapabilitySurface,
  exposure?: CapabilitySurfaceExposure,
  authorize?: CapabilityDiscoveryAuthorizer,
): Promise<DiscoveryDecision> {
  if (!isDestructiveCapabilityExposed(definition, surface, exposure)) {
    return { visible: false, reason: 'surface-not-exposed' };
  }

  const publicRead = definition.risk === 'read' && definition.access.kind === 'public';
  if (authorize === undefined) {
    return publicRead ? { visible: true } : { visible: false, reason: 'authorization-unavailable' };
  }

  try {
    if (await authorize(definition)) return { visible: true };
  } catch {
    return { visible: false, reason: 'authorization-denied' };
  }
  return { visible: false, reason: 'authorization-denied' };
}
