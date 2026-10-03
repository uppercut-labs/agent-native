import catalog from '../../../public/catalog.json' with { type: 'json' };

export function GET() {
  return Response.json({ items: catalog });
}
