import { isAbsolute } from 'node:path';
import type { AstroIntegration } from 'astro';

export type AgentNativeAstroOptions = {
  /** Absolute path to an application-owned browser entry module. */
  readonly browserEntry: string;
  /** Allow Astro's server build mode when the project owns on-demand routes and an adapter. */
  readonly mode?: 'static' | 'on-demand';
};

/**
 * Injects an application-owned browser entry through Astro's supported Vite page-script hook.
 * The application remains responsible for endpoint routes and an Astro server adapter.
 */
export function agentNativeAstro(options: AgentNativeAstroOptions): AstroIntegration {
  if (!isAbsolute(options.browserEntry)) {
    throw new TypeError('browserEntry must be an absolute filesystem path');
  }
  if (options.mode !== undefined && options.mode !== 'static' && options.mode !== 'on-demand') {
    throw new TypeError('mode must be "static" or "on-demand"');
  }

  return {
    name: '@uppercut-labs/agent-native',
    hooks: {
      'astro:config:setup': ({ config, injectScript, logger }) => {
        if (config.output === 'server' && options.mode !== 'on-demand') {
          logger.warn(
            'Agent Native Astro integration supports static output only; browser bootstrap was not injected.',
          );
          return;
        }

        injectScript('page', `import ${JSON.stringify(options.browserEntry)};`);
        logger.info(
          options.mode === 'on-demand'
            ? 'Agent Native browser bootstrap enabled for an on-demand Astro application.'
            : 'Agent Native browser bootstrap enabled for static output.',
        );
      },
      'astro:config:done': ({ buildOutput, logger }) => {
        if (buildOutput !== 'static' && options.mode !== 'on-demand') {
          logger.warn(
            'Agent Native Astro integration is static-only; this integration does not provide a server adapter or server capability endpoint.',
          );
          throw new Error(
            'Use output: "static", or set mode: "on-demand" and provide an application-owned adapter.',
          );
        }

        if (buildOutput === 'server') {
          logger.info(
            'Agent Native allows on-demand output; application-owned routes and adapter configuration remain in control.',
          );
        } else {
          logger.info(
            'Agent Native Astro integration verified static output; this integration does not install a server adapter or create server endpoints.',
          );
        }
      },
    },
  };
}
