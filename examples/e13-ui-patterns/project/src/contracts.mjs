// Capability contracts for the three Agent Native UI fixture patterns. Synthetic data only.
import { defineCapability } from '@uppercut-labs/agent-native';
import { fromZod } from '@uppercut-labs/agent-native/schema/zod';
import * as z from 'zod';
import { identities } from './identities.mjs';

export const WRITE_SCOPE = 'fixture:write';
const id = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const requestId = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const record = z.object({
  id,
  title: z.string().max(120),
  category: z.string().max(60),
  before: z.string().max(2000),
  draft: z.string().max(2000),
});
const annotation = z.object({
  id: z.string().regex(/^[A-Za-z0-9_]{1,64}$/),
  time: z.number().min(0).max(3600),
  text: z.string().max(500),
});

export const reviewOpen = defineCapability({
  identity: identities.reviewOpen,
  description:
    'Open the sample review queue: synthetic records with a current and a proposed text, shown as an editable review view.',
  input: fromZod(z.object({})),
  output: fromZod(
    z.object({
      revision: z.number().int().min(0),
      records: z.array(record),
      canSave: z.boolean(),
    }),
  ),
  risk: 'read',
  access: { kind: 'public' },
});

export const exploreOpen = defineCapability({
  identity: identities.exploreOpen,
  description:
    'Open the probability explorer: chance of at least one success over independent attempts, with sliders that recalculate in the view.',
  input: fromZod(
    z.object({
      attempts: z.number().int().min(0).max(30).optional(),
      rate: z.number().min(0).max(1).optional(),
    }),
  ),
  output: fromZod(
    z.object({
      attempts: z.number().int().min(0).max(30),
      rate: z.number().min(0).max(1),
      chancePercent: z.number().min(0).max(100),
    }),
  ),
  risk: 'read',
  access: { kind: 'public' },
});

export const mediaOpen = defineCapability({
  identity: identities.mediaOpen,
  description:
    'Open the media annotation view for a generated 12-second test tone with a transcript and saved annotations.',
  input: fromZod(z.object({})),
  output: fromZod(
    z.object({
      duration: z.number().min(0),
      lines: z.array(z.object({ id, start: z.number().min(0), text: z.string().max(200) })),
      annotations: z.array(annotation),
      canSave: z.boolean(),
    }),
  ),
  risk: 'read',
  access: { kind: 'public' },
});

export const reviewSave = defineCapability({
  identity: identities.reviewSave,
  description: 'Save edited drafts for selected review records. Requires a signed-in fixture user.',
  input: fromZod(
    z.object({
      requestId,
      drafts: z
        .array(z.object({ id, draft: z.string().max(2000) }))
        .min(1)
        .max(50),
    }),
  ),
  output: fromZod(
    z.object({ saved: z.array(id), revision: z.number().int().min(0), replayed: z.boolean() }),
  ),
  risk: 'write',
  access: { kind: 'protected', scopes: [WRITE_SCOPE] },
});

export const annotationsSave = defineCapability({
  identity: identities.annotationsSave,
  description:
    'Replace the saved annotations for the test tone. Requires a signed-in fixture user.',
  input: fromZod(z.object({ requestId, annotations: z.array(annotation).max(500) })),
  output: fromZod(z.object({ count: z.number().int().min(0), replayed: z.boolean() })),
  risk: 'write',
  access: { kind: 'protected', scopes: [WRITE_SCOPE] },
});

/** True when the caller is signed in with the write scope; the save itself is still authorized. */
export function canSave(caller) {
  return caller.kind === 'authenticated' && caller.scopes.includes(WRITE_SCOPE);
}

export const capabilities = [reviewOpen, exploreOpen, mediaOpen, reviewSave, annotationsSave];

export function chancePercent(attempts, rate) {
  if (attempts === 0) return 0;
  if (rate === 1) return 100;
  return Math.round(-Math.expm1(attempts * Math.log1p(-rate)) * 10000) / 100;
}
