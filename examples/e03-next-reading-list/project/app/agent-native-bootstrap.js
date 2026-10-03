'use client';

import { createNextBrowserBootstrap } from '@uppercut-labs/agent-native/next/browser';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { browserRegistry } from '../lib/browser-registry.js';

export function AgentNativeBootstrap() {
  const pathname = usePathname();
  const bootstrap = useRef(null);
  const [supported, setSupported] = useState(null);

  useEffect(() => {
    bootstrap.current = createNextBrowserBootstrap(document, browserRegistry);
    setSupported(bootstrap.current.supported);
    return () => bootstrap.current?.dispose();
  }, []);

  useEffect(() => {
    if (pathname.length > 0) void bootstrap.current?.sync();
  }, [pathname]);

  return (
    <p className="tool-status" role="status">
      {supported === true
        ? 'Browser catalog tool available.'
        : 'The reading list works normally without browser tool support.'}
    </p>
  );
}
