// Markdown content negotiation for a fixture's production Node server. Preload it in front of
// the framework's own server: `node --import ../shared/negotiate.mjs <server entry>`.
// A GET or HEAD for a published canonical route whose Accept header names text/markdown (agents
// and retrieval tools; browsers never send it) receives the approved Markdown mirror from the
// generated asset directory. Every other request reaches the framework unchanged, and responses
// for published routes carry `Vary: Accept` so a shared cache keeps the two representations apart.
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { importPublication } from './sdk.mjs';

const appDir = process.cwd();
const modelFile = path.join(appDir, 'generated/publication.json');
const model = existsSync(modelFile) ? JSON.parse(readFileSync(modelFile, 'utf8')) : null;
const assetRoot = path.join(
  appDir,
  existsSync(path.join(appDir, 'static/agent-native')) ? 'static' : 'public',
);
const { addVary, markdownMirrors, negotiateMarkdown } = await importPublication(appDir);
const mirrors = model?.publicationEnabled ? markdownMirrors(model.pages) : {};

function varyOnAccept(res) {
  const writeHead = res.writeHead;
  res.writeHead = function (status, ...rest) {
    const headers = rest.find((item) => item && typeof item === 'object');
    if (headers && !Array.isArray(headers)) {
      const key = Object.keys(headers).find((name) => name.toLowerCase() === 'vary');
      if (key) headers[key] = addVary(headers[key]);
      else this.setHeader('Vary', addVary(this.getHeader('vary')));
    } else if (!headers) {
      this.setHeader('Vary', addVary(this.getHeader('vary')));
    }
    return writeHead.call(this, status, ...rest);
  };
}

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, res, ...rest) {
  if (event !== 'request') return emit.call(this, event, req, res, ...rest);
  let decision = { mirror: null, vary: false };
  try {
    decision = negotiateMarkdown(
      {
        method: req.method,
        pathname: new URL(req.url ?? '/', 'http://localhost').pathname,
        accept: req.headers.accept,
      },
      mirrors,
    );
  } catch {}
  if (decision.vary) varyOnAccept(res);
  let file = null;
  try {
    if (decision.mirror) file = path.resolve(assetRoot, '.' + decodeURIComponent(decision.mirror));
  } catch {}
  if (!file || !file.startsWith(assetRoot + path.sep))
    return emit.call(this, event, req, res, ...rest);
  readFile(file).then(
    (body) => {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : body);
    },
    () => emit.call(this, event, req, res, ...rest),
  );
  return true;
};
