import { mcpEndpoint } from '../endpoints.mjs';

export const prerender = false;
export const GET = ({ request }) => mcpEndpoint(request);
export const POST = ({ request }) => mcpEndpoint(request);
export const DELETE = ({ request }) => mcpEndpoint(request);
