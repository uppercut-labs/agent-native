import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked, marked } from 'marked';
import { expandSourceRegions } from './source-regions.mjs';

const siteRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(siteRoot, '..');
const docsRoot = path.join(repositoryRoot, 'docs');
const outputRoot = path.join(siteRoot, 'dist');
const repositoryUrl = 'https://github.com/uppercut-labs/agent-native';

const guideOrder = [
  'getting-started',
  'installation',
  'capabilities-and-bindings',
  'frameworks',
  'static-sites',
  'next',
  'surfaces',
  'browser',
  'mcp',
  'mcp-apps',
  'http',
  'cli',
  'reference',
  'permissions-and-discovery',
  'composition-and-versioning',
  'doctor-and-troubleshooting',
  'compatibility',
  'support-and-limitations',
];

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}

function sourceUrl(file) {
  const relative = path
    .relative(repositoryRoot, file)
    .split(path.sep)
    .map(encodeURIComponent)
    .join('/');
  return `${repositoryUrl}/blob/main/${relative}`;
}

function pageUrl(fromKey, toKey) {
  const relative = path.posix.relative(fromKey || '.', toKey || '.');
  return relative ? `${relative.startsWith('.') ? '' : './'}${relative}/` : './';
}

function assetUrl(pageKey, asset) {
  const up = path.posix.relative(pageKey || '.', '.');
  return `${up ? `${up}/` : './'}${asset}`;
}

async function collectMarkdown(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMarkdown(location)));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(location);
  }
  return files.sort();
}

function cleanText(markdown) {
  return markdown
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*`>|_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function headingId(value, used) {
  const base =
    cleanText(value)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 -]/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'section';
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count ? `${base}-${count}` : base;
}

function metadata(file, markdown) {
  const key = path.relative(docsRoot, file).split(path.sep).join('/').replace(/\.md$/, '');
  const firstHeading = markdown.match(/^#\s+(.+)$/m)?.[1] ?? key;
  const used = new Map();
  const headings = new Set();
  for (const token of marked.lexer(markdown)) {
    if (token.type === 'heading') headings.add(headingId(token.text, used));
  }
  return {
    file,
    key,
    markdown,
    title: cleanText(firstHeading),
    headings,
    summary: cleanText(markdown.replace(/^#\s+.+$/m, '')).slice(0, 180),
    searchText: cleanText(markdown).toLowerCase(),
  };
}

function localHref(href, page, pages) {
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
    throw new Error(`${page.file}: unsupported link scheme: ${href}`);
  }
  const [withoutFragment, fragment] = href.split('#', 2);
  if (withoutFragment.includes('?'))
    throw new Error(`${page.file}: local query links are unsupported: ${href}`);
  const target = withoutFragment
    ? path.resolve(path.dirname(page.file), decodeURIComponent(withoutFragment))
    : page.file;
  const relative = path.relative(repositoryRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(target)) {
    throw new Error(`${page.file}: broken local link: ${href}`);
  }
  const destination = pages.get(target);
  if (fragment && destination && !destination.headings.has(decodeURIComponent(fragment))) {
    throw new Error(`${page.file}: missing heading in ${href}`);
  }
  const suffix = fragment ? `#${encodeURIComponent(decodeURIComponent(fragment))}` : '';
  return destination
    ? `${pageUrl(page.key, destination.key)}${suffix}`
    : `${sourceUrl(target)}${suffix}`;
}

function renderMarkdown(page, pages) {
  const usedHeadings = new Map();
  const renderer = {
    heading({ depth, text, tokens }) {
      const id = headingId(text, usedHeadings);
      return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>`;
    },
    link({ href, title, tokens }) {
      const target = localHref(href, page, pages);
      const extra = /^https?:\/\//.test(target) ? ' rel="noopener noreferrer"' : '';
      const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(target)}"${titleAttribute}${extra}>${this.parser.parseInline(tokens)}</a>`;
    },
    image({ href, text }) {
      const target = localHref(href, page, pages);
      return `<img src="${escapeHtml(target)}" alt="${escapeHtml(text)}" loading="lazy">`;
    },
    html({ text }) {
      return escapeHtml(text);
    },
  };
  return new Marked({ gfm: true, renderer }).parse(page.markdown);
}

function navigation(pageKey, guides, evidence) {
  const items = (pages) =>
    pages
      .map((page) => {
        const current = page.key === pageKey ? ' aria-current="page"' : '';
        return `<li><a href="${escapeHtml(pageUrl(pageKey, page.key))}"${current}>${escapeHtml(page.title)}</a></li>`;
      })
      .join('');
  return `<nav id="site-nav" class="sidebar" aria-label="Documentation">
    <p class="nav-label">Guides</p><ul>${items(guides)}</ul>
    <details class="evidence"><summary>Evidence notes</summary><ul>${items(evidence)}</ul></details>
  </nav>`;
}

function shell({ pageKey, title, content, guides, evidence, source }) {
  const home = pageUrl(pageKey, '');
  const raw = source?.startsWith(docsRoot)
    ? assetUrl(pageKey, `raw/${path.relative(docsRoot, source).split(path.sep).join('/')}`)
    : undefined;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${escapeHtml(title)} · Agent Native docs</title>
<link rel="stylesheet" href="${escapeHtml(assetUrl(pageKey, 'assets/site.css'))}">
<script type="module" src="${escapeHtml(assetUrl(pageKey, 'assets/site.js'))}"></script></head>
<body><a class="skip" href="#main">Skip to content</a>
<header class="masthead"><a class="brand" href="${escapeHtml(home)}"><span class="mark" aria-hidden="true">/</span> Agent Native <span class="brand-small">docs</span></a>
<span class="release-tag">Unreleased preview · 0.0.0</span><button class="menu-button" type="button" aria-controls="site-nav" aria-expanded="false">Menu</button></header>
<div class="layout">${navigation(pageKey, guides, evidence)}
<div class="main-column"><form class="search" role="search"><label for="site-search">Search documentation</label><input id="site-search" type="search" autocomplete="off" placeholder="Search guides and evidence" aria-controls="search-results"><span class="search-hint">Press / to search</span><ul id="search-results" class="search-results" aria-live="polite" hidden></ul></form>
<main id="main"><div class="eyebrow">Uppercut Labs / Agent Native</div><article class="prose">${content}</article>
${source ? `<div class="source-links"><a href="${escapeHtml(sourceUrl(source))}">View source on GitHub</a>${raw ? `<a href="${escapeHtml(raw)}">Raw Markdown</a>` : ''}</div>` : ''}</main>
<footer>Experimental package documentation. <a href="${escapeHtml(pageUrl(pageKey, 'support-and-limitations'))}">Read support and limitations</a>.</footer></div></div></body></html>`;
}

async function writePage(key, html) {
  const directory = path.join(outputRoot, key);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'index.html'), html);
}

async function build() {
  const files = await collectMarkdown(docsRoot);
  const pages = new Map();
  for (const file of files) {
    const markdown = await expandSourceRegions(await readFile(file, 'utf8'), file, repositoryRoot);
    pages.set(file, metadata(file, markdown));
  }
  const byKey = new Map([...pages.values()].map((page) => [page.key, page]));
  for (const key of guideOrder) {
    if (!byKey.has(key)) throw new Error(`Missing navigation page: docs/${key}.md`);
  }
  const guides = guideOrder.map((key) => byKey.get(key));
  const evidence = [...byKey.values()].filter((page) => page.key.startsWith('evidence/'));
  const other = [...byKey.values()].filter(
    (page) => !guideOrder.includes(page.key) && !page.key.startsWith('evidence/'),
  );
  guides.push(...other);

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(path.join(outputRoot, 'assets'), { recursive: true });
  await mkdir(path.join(outputRoot, 'raw'), { recursive: true });
  for (const asset of ['site.css', 'site.js'])
    await copyFile(path.join(siteRoot, asset), path.join(outputRoot, 'assets', asset));

  for (const page of pages.values()) {
    const content = renderMarkdown(page, pages);
    await writePage(
      page.key,
      shell({ pageKey: page.key, title: page.title, content, guides, evidence, source: page.file }),
    );
    const rawFile = path.join(outputRoot, 'raw', `${page.key}.md`);
    await mkdir(path.dirname(rawFile), { recursive: true });
    await writeFile(rawFile, page.markdown);
  }

  const intro = `<h1>Typed capabilities for the sites you already run.</h1>
    <p class="lead">Agent Native is an experimental package for defining one capability contract and binding it to local, browser, CLI, HTTP, and MCP surfaces.</p>
    <div class="notice"><strong>Unreleased preview.</strong> The package is private at version 0.0.0. These pages document source and fixture-tested behavior; they are not npm installation instructions or production host certification.</div>
    <div class="cards"><a href="${pageUrl('', 'getting-started')}"><span>01 / Start</span><strong>Existing Astro site</strong><span>Plan a narrow retrofit and inspect the E01 fixture.</span></a>
    <a href="${pageUrl('', 'capabilities-and-bindings')}"><span>02 / Model</span><strong>Capabilities and bindings</strong><span>Learn the contract, runtime and authorization boundaries.</span></a>
    <a href="${pageUrl('', 'support-and-limitations')}"><span>03 / Verify</span><strong>Support and limitations</strong><span>See what current fixtures prove and what remains open.</span></a></div>
    <p>All pages are available as <a href="${pageUrl('', 'getting-started')}" >HTML</a> and raw Markdown. The site works without an account or runtime service.</p>`;
  await writePage(
    '',
    shell({
      pageKey: '',
      title: 'Documentation',
      content: intro,
      guides,
      evidence,
      source: path.join(repositoryRoot, 'README.md'),
    }),
  );

  const index = [...pages.values()].map(({ key, title, summary, searchText }) => ({
    title,
    summary,
    text: searchText,
    url: pageUrl('', key),
    category: key.startsWith('evidence/') ? 'Evidence' : 'Guide',
  }));
  await writeFile(path.join(outputRoot, 'search-index.json'), JSON.stringify(index));
  const totalFiles = await readdir(outputRoot);
  if (!totalFiles.includes('search-index.json')) throw new Error('Search index was not generated');
  console.log(
    `Built ${pages.size} documentation pages with validated local links in ${outputRoot}`,
  );
}

await build();
