import { isAbsolute } from 'node:path';
import type { AstroIntegration } from 'astro';

export type AgentNativeAstroOptions = {
  /** Absolute path to an application-owned browser entry module. */
  readonly browserEntry: string;
};

/**
 * Injects an application-owned browser entry through Astro's supported Vite page-script hook.
 * This integration only supports static output and never installs an Astro server adapter.
 */
export function agentNativeAstro(options: AgentNativeAstroOptions): AstroIntegration {
  if (!isAbsolute(options.browserEntry)) {
    throw new TypeError('browserEntry must be an absolute filesystem path');
  }

  return {
    name: '@uppercut-labs/agent-native',
    hooks: {
      'astro:config:setup': ({ config, injectScript, logger }) => {
        if (config.output === 'server') {
          logger.warn(
            'Agent Native Astro integration supports static output only; browser bootstrap was not injected.',
          );
          return;
        }

        injectScript('page', `import ${JSON.stringify(options.browserEntry)};`);
        logger.info('Agent Native browser bootstrap enabled for static output.');
      },
      'astro:config:done': ({ buildOutput, logger }) => {
        if (buildOutput !== 'static') {
          logger.warn(
            'Agent Native Astro integration is static-only; no server adapter or server capability endpoint is installed.',
          );
          throw new Error(
            'Agent Native Astro integration requires output: "static". Remove the server adapter or use a static Astro build.',
          );
        }

        logger.info(
          'Agent Native Astro integration verified static output; no server adapter is installed.',
        );
      },
    },
  };
}
