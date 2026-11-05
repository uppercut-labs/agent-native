export const workshop = {
  slug: 'lanterns',
  title: 'Lantern makers workshop',
  opens: process.env.WORKSHOP_OPENS ?? '10:30',
};
export const showcase = {
  id: 'workshop-lanterns',
  revision: 'workshops-1',
  route: `/events/${workshop.slug}`,
  visibility: 'public',
  title: workshop.title,
  markdown: `Doors open at ${workshop.opens}. Bring one sheet of tracing paper.`,
  category: 'Workshops',
  structuredType: 'WebPage',
};
