import { readPage } from '../catalog.server.js';
import { metadata, Page } from '../page.jsx';
export function loader({ request }) {
  return readPage(new URL(request.url).pathname);
}
export const meta = ({ loaderData }) => metadata(loaderData);
export default function Reference({ loaderData }) {
  return <Page page={loaderData} />;
}
