import { defineCapability } from '@uppercut-labs/agent-native/contracts';
import {
  defineCapabilityLifecyclePolicy,
  defineCapabilityMigration,
  defineCapabilityPack,
} from '@uppercut-labs/agent-native/composition';

function objectSchema(parse, jsonSchema) {
  return Object.freeze({ parse, toJSONSchema: () => jsonSchema });
}

const slugProperty = { type: 'string', minLength: 1 };
const localeProperty = { type: 'string', pattern: '^[a-z]{2}-[A-Z]{2}$' };

const lookupV1Input = objectSchema(
  (value) => {
    if (typeof value !== 'object' || value === null || typeof value.slug !== 'string') {
      throw new TypeError('invalid v1 album lookup input');
    }
    return { slug: value.slug };
  },
  {
    type: 'object',
    properties: { slug: slugProperty },
    required: ['slug'],
    additionalProperties: false,
  },
);

const lookupV1Output = objectSchema(
  (value) => {
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof value.slug !== 'string' ||
      typeof value.title !== 'string'
    ) {
      throw new TypeError('invalid v1 album lookup output');
    }
    return { slug: value.slug, title: value.title };
  },
  {
    type: 'object',
    properties: { slug: slugProperty, title: { type: 'string' } },
    required: ['slug', 'title'],
    additionalProperties: false,
  },
);

const lookupV2Input = objectSchema(
  (value) => {
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof value.slug !== 'string' ||
      typeof value.locale !== 'string' ||
      !/^[a-z]{2}-[A-Z]{2}$/.test(value.locale)
    ) {
      throw new TypeError('invalid v2 album lookup input');
    }
    return { slug: value.slug, locale: value.locale };
  },
  {
    type: 'object',
    properties: { slug: slugProperty, locale: localeProperty },
    required: ['slug', 'locale'],
    additionalProperties: false,
  },
);

const lookupV2Output = objectSchema(
  (value) => {
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof value.slug !== 'string' ||
      typeof value.locale !== 'string' ||
      typeof value.titles !== 'object' ||
      value.titles === null ||
      Array.isArray(value.titles) ||
      Object.values(value.titles).some((title) => typeof title !== 'string')
    ) {
      throw new TypeError('invalid v2 album lookup output');
    }
    return { slug: value.slug, locale: value.locale, titles: { ...value.titles } };
  },
  {
    type: 'object',
    properties: {
      slug: slugProperty,
      locale: localeProperty,
      titles: { type: 'object', additionalProperties: { type: 'string' } },
    },
    required: ['slug', 'locale', 'titles'],
    additionalProperties: false,
  },
);

export const albumLookupV1 = defineCapability({
  identity: { namespace: 'example.org.catalog', name: 'album.lookup', majorVersion: 1 },
  description: 'Look up the legacy English title for an album.',
  input: lookupV1Input,
  output: lookupV1Output,
  risk: 'read',
  access: { kind: 'public' },
});

export const albumLookupV2 = defineCapability({
  identity: { namespace: 'example.org.catalog', name: 'album.lookup', majorVersion: 2 },
  description: 'Look up localized album titles for an explicitly selected locale.',
  input: lookupV2Input,
  output: lookupV2Output,
  risk: 'read',
  access: { kind: 'public' },
});

export const albumLookupV1ToV2 = defineCapabilityMigration({
  previous: albumLookupV1,
  next: albumLookupV2,
  semanticReview: {
    note: 'V2 requires locale and returns the complete localized title map; v1 remains unchanged.',
    reviewedBy: 'catalog-contract-owner',
  },
});

export const catalogLifecycle = defineCapabilityLifecyclePolicy([
  {
    capabilityId: 'example.org.catalog:album.lookup@1',
    state: 'deprecated',
    note: 'Supported for legacy consumers while they migrate to localized titles.',
  },
  { capabilityId: 'example.org.catalog:album.lookup@2', state: 'supported' },
]);

export const catalogPack = defineCapabilityPack({
  identity: { authority: 'example.org', namespace: 'catalog' },
  source: '@example/e08-album-contracts@2.0.0',
  definitions: [albumLookupV1, albumLookupV2],
  migrations: [albumLookupV1ToV2],
  lifecycle: catalogLifecycle,
});
