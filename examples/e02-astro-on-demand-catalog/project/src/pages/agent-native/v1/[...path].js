import { httpEndpoint } from '../../../endpoints.mjs';

export const prerender = false;
export const ALL = ({ request }) => httpEndpoint(request);
