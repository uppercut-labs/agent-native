export const quay = { line: 'river', stop: 'quay', minutes: process.env.STOP_INTERVAL ?? '12' };
export const showcase = {
  id: 'river-quay',
  revision: 'service-1',
  route: `/lines/${quay.line}/stops/${quay.stop}`,
  visibility: 'public',
  title: 'Quay stop',
  markdown: `River line trams call every ${quay.minutes} minutes at Quay.`,
  category: 'Transit stops',
  structuredType: 'WebPage',
};
