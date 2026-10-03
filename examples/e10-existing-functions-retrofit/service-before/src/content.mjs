import { readFileSync } from 'node:fs';

const content = JSON.parse(readFileSync(new URL('../data/content.json', import.meta.url), 'utf8'));

export function searchContent({ query, limit = 5 }) {
  if (typeof query !== 'string' || query.trim().length === 0 || query.length > 80) {
    throw new TypeError('query must be a non-empty string of at most 80 characters');
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new RangeError('limit must be an integer from 1 to 10');
  }

  const needle = query.trim().toLowerCase();
  const results = content
    .filter(({ title, summary }) => [title, summary].join(' ').toLowerCase().includes(needle))
    .slice(0, limit);

  return { query: query.trim(), results };
}

export function getContent(slug) {
  return content.find((item) => item.slug === slug) ?? null;
}
