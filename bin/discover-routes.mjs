import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const filesystem = {
  astro: { roots: ['src/pages'], page: /\.(astro|md|mdx|html)$/ },
  next: { roots: ['app', 'src/app'], page: /^page\.[cm]?[jt]sx?$/ },
  sveltekit: { roots: ['src/routes'], page: /^\+page(?:@[\w-]*)?\.svelte$/ },
  nuxt: { roots: ['app/pages', 'pages'], page: /\.vue$/ },
};
const tableRouters = new Set(['angular', 'react-router', 'react-vite', 'vue-vite']);
const safeName = /^[\p{L}\p{M}\p{N}_.~\-\[\]()+@=:*]+$/u;

// Return private review candidates only. Never parse module code, run loaders or read page bodies.
export async function discoverRoutes(framework, project, tableFile) {
  if (!Object.hasOwn(filesystem, framework) && !tableRouters.has(framework))
    throw Error('unknown-framework');
  const root = await realpath(project);
  const routes = [],
    diagnostics = [];
  let visited = 0;
  function record(raw, source) {
    if (
      typeof raw !== 'string' ||
      raw.split('/').some((segment) => segment === '..' || segment === '.') ||
      raw.includes('\\') ||
      !raw.startsWith('/')
    )
      throw Error('invalid-route-record');
    if (++visited > 20000) throw Error('route-limit');
    const route = raw.replace(/\/+$/, '') || '/';
    const id =
      'route-' +
      createHash('sha256')
        .update(JSON.stringify([framework, source, route]))
        .digest('hex')
        .slice(0, 24);
    routes.push({
      id,
      route,
      source,
      visibility: 'unknown',
      requiresParameters: /[\[\]:*$?]/.test(route),
    });
  }
  async function safeDir(rel) {
    const dir = path.join(root, rel);
    try {
      if (!(await lstat(dir)).isDirectory() || (await realpath(dir)) !== dir) return false;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
    return true;
  }
  const rule = filesystem[framework];
  if (rule) {
    for (const prefix of rule.roots) {
      if (!(await safeDir(prefix))) continue;
      async function visit(folder) {
        for (const entry of await readdir(path.join(root, prefix, folder), {
          withFileTypes: true,
        })) {
          const name = entry.name;
          if (
            !safeName.test(name) ||
            name.startsWith('.') ||
            name.startsWith('_') ||
            name.startsWith('@') ||
            entry.isSymbolicLink()
          )
            continue;
          const rel = path.posix.join(folder, name);
          if (entry.isDirectory()) {
            if (rel.split('/').length > 40) throw Error('route-depth-limit');
            await visit(rel);
          } else if (entry.isFile() && rule.page.test(name)) {
            let parts = rel.split('/');
            if (framework === 'next' || framework === 'sveltekit') parts.pop();
            else {
              parts[parts.length - 1] = name.replace(/\.[^.]+$/, '');
              if (parts.at(-1) === 'index') parts.pop();
            }
            if (framework === 'next' || framework === 'sveltekit')
              parts = parts.filter((part) => !/^\([^()]+\)$/.test(part));
            record('/' + parts.join('/'), prefix + '/' + rel);
          }
        }
      }
      await visit('');
      if (framework === 'next' || framework === 'nuxt') break;
    }
  }
  let table = tableFile;
  if (!table && framework === 'angular' && (await safeDir('dist'))) {
    try {
      if ((await lstat(path.join(root, 'dist/prerendered-routes.json'))).isFile())
        table = 'dist/prerendered-routes.json';
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  if (table) {
    const absolute = path.resolve(root, table),
      relative = path.relative(root, absolute);
    if (
      relative.startsWith('..' + path.sep) ||
      relative === '..' ||
      path.isAbsolute(relative) ||
      absolute !== (await realpath(absolute))
    )
      throw Error('unsafe-route-table');
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw Error('invalid-route-table');
    const value = JSON.parse(await readFile(absolute, 'utf8'));
    const source = relative.split(path.sep).join('/');
    if (Array.isArray(value)) {
      const add = (row, parent, depth) => {
        if (depth > 40) throw Error('route-depth-limit');
        if (typeof row === 'string') {
          record(row.startsWith('/') ? row : parent + '/' + row, source);
          return;
        }
        if (
          !row ||
          typeof row !== 'object' ||
          (row.path !== undefined && typeof row.path !== 'string')
        )
          throw Error('invalid-route-record');
        const route = row.path?.startsWith('/')
          ? row.path
          : [parent, row.path].filter(Boolean).join('/').replace(/^\/?/, '/');
        if (row.path || row.index) record(route || '/', source);
        if (row.children !== undefined) {
          if (!Array.isArray(row.children)) throw Error('invalid-route-record');
          for (const child of row.children) add(child, route === '/' ? '' : route, depth + 1);
        }
      };
      for (const row of value) add(row, '', 0);
    } else if (
      framework === 'angular' &&
      value?.routes &&
      typeof value.routes === 'object' &&
      !Array.isArray(value.routes)
    ) {
      for (const key of Object.keys(value.routes)) record(key, source);
    } else throw Error('invalid-route-table');
  }
  if (!routes.length)
    diagnostics.push(
      tableRouters.has(framework) ? 'supply-exported-route-table' : 'no-conventional-pages',
    );
  const unique = new Map(routes.map((r) => [r.id, r]));
  return {
    status: 'discovered',
    framework,
    routes: [...unique.values()].sort((a, b) =>
      a.route < b.route ? -1 : a.route > b.route ? 1 : a.id.localeCompare(b.id),
    ),
    diagnostics,
  };
}
