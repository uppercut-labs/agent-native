import { useState } from 'react';
import { redirect } from 'react-router';
import { readPage } from '../catalog.server.js';
import { metadata, Page } from '../page.jsx';
export function loader({ params }) {
  if (params.line === 'river' && params.stop === 'old-wharf')
    throw redirect('/lines/river/stops/quay', 301);
  return readPage(`/lines/${params.line}/stops/${params.stop}`);
}
export const meta = ({ loaderData }) => metadata(loaderData);
export default function Stop({ loaderData }) {
  const [saved, setSaved] = useState(false);
  return (
    <Page page={loaderData}>
      <button type="button" onClick={() => setSaved(!saved)}>
        {saved ? 'Stop saved' : 'Save stop'}
      </button>
    </Page>
  );
}
