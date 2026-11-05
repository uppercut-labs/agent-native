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
  category: 'Advisories',
  structuredType: 'Article',
};
export const candidates = [
  ...notes.map(({ id, title, markdown, revision }) => ({
    id,
    title,
    markdown,
    revision,
    route: '/field-notes/' + id,
    visibility: 'public',
    category: 'Field notes',
    structuredType: 'Article',
  })),
  advisory,
];
