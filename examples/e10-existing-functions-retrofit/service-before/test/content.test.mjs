import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getContent, searchContent } from '../src/content.mjs';

test('the existing search function returns deterministic public content', () => {
  assert.deepEqual(
    searchContent({ query: 'night' }).results.map(({ slug }) => slug),
    ['night-drive', 'night-market'],
  );
  assert.deepEqual(
    searchContent({ query: 'night', limit: 1 }).results.map(({ slug }) => slug),
    ['night-drive'],
  );
  assert.equal(getContent('city-map').title, 'City Map');
});

test('invalid search input fails rather than returning an empty success', () => {
  assert.throws(() => searchContent({ query: '' }), /query must be/);
  assert.throws(() => searchContent({ query: 'night', limit: 0 }), /limit must be/);
});
