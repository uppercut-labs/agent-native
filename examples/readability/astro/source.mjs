import { readFile } from 'node:fs/promises';
const notes = JSON.parse(
  await readFile(new URL('./src/content/notes.json', import.meta.url), 'utf8'),
);
export const advisory = {
  id: 'tide-window',
  revision: '1',
  route: '/advisories/tide-window',
  visibility: 'public',
  title: 'Tide window advisory',
  markdown: 'The east breakwater walkway opens at 10:20 after the morning tide.',
  facts: [{ label: 'Walkway opens after the morning tide', value: '10:20' }],
  category: 'Advisories',
  structuredType: 'Article',
};
export const candidates = [
  ...notes.map(({ id, title, markdown, revision, facts }) => ({
    id,
    title,
    markdown,
    revision,
    facts,
    route: '/field-notes/' + id,
    visibility: 'public',
    category: 'Field notes',
    structuredType: 'Article',
  })),
  advisory,
];
