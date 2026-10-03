import { createNextHttpRoute } from '@uppercut-labs/agent-native/next';
import { serverRegistry } from '../../../lib/server-registry.js';

export const runtime = 'nodejs';

export const { GET, POST } = createNextHttpRoute(serverRegistry);
