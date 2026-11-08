import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { z } from 'astro/zod';

export const collections = {
  notes: defineCollection({
    loader: file('src/content/notes.json'),
    schema: z.object({
      title: z.string(),
      markdown: z.string(),
      revision: z.string(),
      facts: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    }),
  }),
};
