import type { AuthorizationPort, AuthorizationRequest, ExecutionCaller } from './core/executor.js';

export type TrustedPrincipal = {
  readonly issuer: string;
  readonly subject: string;
  readonly clientId: string;
  readonly tenantId: string;
  readonly audience: string;
  readonly scopes: readonly string[];
  readonly expiresAt: number;
};

export type GrantQuery = {
  readonly issuer: string;
  readonly subject: string;
  readonly clientId: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly audience: string;
  readonly policyRevision: string;
};

export type PersistedGrant = GrantQuery & {
  readonly grantId: string;
  readonly scopes: readonly string[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
};

export interface GrantStorePort {
  find(query: GrantQuery): Promise<readonly PersistedGrant[]>;
  save(grant: PersistedGrant): Promise<void>;
  revoke(grantId: string, revokedAt: number): Promise<boolean>;
}

export type GrantAuthorizationOptions = {
  readonly principal: TrustedPrincipal | null;
  readonly applicationId: string;
  readonly audience: string;
  readonly policyRevision: string;
  readonly store?: GrantStorePort;
  readonly now?: () => number;
  // Must enforce ownership/tenant boundaries for record-scoped calls and all mutations.
  readonly authorizeResource?: (
    request: AuthorizationRequest,
    principal: TrustedPrincipal,
  ) => boolean | Promise<boolean>;
};

function requiredString(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(label + ' must be a non-empty string');
  }
}

function validPrincipal(principal: TrustedPrincipal): boolean {
  return (
    typeof principal === 'object' &&
    principal !== null &&
    typeof principal.issuer === 'string' &&
    principal.issuer.length > 0 &&
    typeof principal.subject === 'string' &&
    principal.subject.length > 0 &&
    typeof principal.clientId === 'string' &&
    principal.clientId.length > 0 &&
    typeof principal.tenantId === 'string' &&
    principal.tenantId.length > 0 &&
    typeof principal.audience === 'string' &&
    principal.audience.length > 0 &&
    Array.isArray(principal.scopes) &&
    principal.scopes.every((scope) => typeof scope === 'string' && scope.length > 0) &&
    Number.isSafeInteger(principal.expiresAt) &&
    principal.expiresAt > 0
  );
}

function authenticatedCaller(
  caller: ExecutionCaller,
): { readonly subject: string; readonly scopes: readonly string[] } | null {
  if (!('subject' in caller) || !('scopes' in caller)) return null;
  return { subject: caller.subject, scopes: caller.scopes };
}

function queryMatches(grant: PersistedGrant, query: GrantQuery): boolean {
  return (
    grant.issuer === query.issuer &&
    grant.subject === query.subject &&
    grant.clientId === query.clientId &&
    grant.tenantId === query.tenantId &&
    grant.applicationId === query.applicationId &&
    grant.audience === query.audience &&
    grant.policyRevision === query.policyRevision
  );
}

export function executionCallerForPrincipal(principal: TrustedPrincipal): ExecutionCaller {
  if (!validPrincipal(principal)) throw new TypeError('trusted principal is invalid');
  return Object.freeze({
    kind: 'authenticated',
    subject: JSON.stringify([principal.issuer, principal.subject, principal.tenantId]),
    scopes: Object.freeze([...principal.scopes]),
  });
}

export async function hasGrantForScopes(options: {
  readonly principal: TrustedPrincipal;
  readonly applicationId: string;
  readonly audience: string;
  readonly policyRevision: string;
  readonly store: GrantStorePort;
  readonly requiredScopes: readonly string[];
  readonly now?: () => number;
}): Promise<boolean> {
  const { principal } = options;
  if (!validPrincipal(principal)) return false;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const currentTime = now();
  if (
    !Number.isSafeInteger(currentTime) ||
    currentTime < 0 ||
    principal.expiresAt <= currentTime ||
    principal.audience !== options.audience ||
    !options.requiredScopes.every((scope) => principal.scopes.includes(scope))
  )
    return false;
  const query: GrantQuery = {
    issuer: principal.issuer,
    subject: principal.subject,
    clientId: principal.clientId,
    tenantId: principal.tenantId,
    applicationId: options.applicationId,
    audience: options.audience,
    policyRevision: options.policyRevision,
  };
  const grants = await options.store.find(query);
  return grants.some(
    (grant) =>
      queryMatches(grant, query) &&
      grant.revokedAt === null &&
      Number.isSafeInteger(grant.expiresAt) &&
      grant.expiresAt > currentTime &&
      Number.isSafeInteger(grant.issuedAt) &&
      grant.issuedAt <= currentTime &&
      Array.isArray(grant.scopes) &&
      options.requiredScopes.every((scope) => grant.scopes.includes(scope)),
  );
}

export function createGrantAuthorization(options: GrantAuthorizationOptions): AuthorizationPort {
  requiredString(options.applicationId, 'applicationId');
  requiredString(options.audience, 'audience');
  requiredString(options.policyRevision, 'policyRevision');
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const principal = options.principal;
  if (principal !== null && !validPrincipal(principal))
    throw new TypeError('trusted principal is invalid');

  return Object.freeze({
    async authorize(request: AuthorizationRequest): Promise<boolean> {
      if (request.access.kind === 'public') return request.risk === 'read';
      if (
        principal === null ||
        options.store === undefined ||
        !validPrincipal(principal) ||
        options.authorizeResource === undefined
      )
        return false;
      const caller = authenticatedCaller(request.caller);
      if (caller === null) return false;
      const expectedSubject = JSON.stringify([
        principal.issuer,
        principal.subject,
        principal.tenantId,
      ]);
      if (
        caller.subject !== expectedSubject ||
        caller.scopes.length !== principal.scopes.length ||
        !principal.scopes.every((scope) => caller.scopes.includes(scope))
      )
        return false;
      const hasGrant = await hasGrantForScopes({
        principal,
        applicationId: options.applicationId,
        audience: options.audience,
        policyRevision: options.policyRevision,
        store: options.store,
        requiredScopes: request.access.scopes,
        now,
      });
      if (!hasGrant) return false;
      return await options.authorizeResource(request, principal);
    },
  });
}
