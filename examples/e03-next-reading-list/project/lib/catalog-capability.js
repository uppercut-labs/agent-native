import { defineCapability } from '@uppercut-labs/agent-native';

const emptyObject = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).length
    )
      throw new TypeError('Expected an empty object');
    return {};
  },
  toJSONSchema() {
    return { type: 'object', properties: {}, additionalProperties: false };
  },
};

const catalogResult = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !Array.isArray(value.items) ||
      value.items.some(
        (book) =>
          typeof book !== 'object' ||
          book === null ||
          !['id', 'title', 'author', 'shelf', 'note'].every(
            (key) => typeof book[key] === 'string',
          ) ||
          typeof book.year !== 'number',
      )
    )
      throw new TypeError('Expected a catalog result');
    return value;
  },
  toJSONSchema() {
    return {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              author: { type: 'string' },
              year: { type: 'number' },
              shelf: { type: 'string' },
              note: { type: 'string' },
            },
            required: ['id', 'title', 'author', 'year', 'shelf', 'note'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    };
  },
};

export const catalogCapability = defineCapability({
  identity: { namespace: 'reading', name: 'catalog.list', majorVersion: 1 },
  description: 'List the public sample reading catalog.',
  input: emptyObject,
  output: catalogResult,
  risk: 'read',
  access: { kind: 'public' },
});
