// Minimal static server that mirrors GitHub Pages project-site hosting:
// the repository root is served under /<base>/ (default /hisability/).
//
//   node tools/serve.mjs [--port 8080] [--base /hisability/]
//
// Also importable: `const { url, close } = await startServer({ port: 0 })`.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

export function startServer({ port = 0, base = '/hisability/', root = ROOT, quiet = true } = {}) {
  if (!base.endsWith('/')) base += '/';
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let path = decodeURIComponent(url.pathname);
    if (path === base.slice(0, -1)) {
      res.writeHead(301, { Location: base });
      return res.end();
    }
    if (!path.startsWith(base)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found (outside base path)');
    }
    let rel = path.slice(base.length) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(root, rel));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end();
    }
    try {
      const s = await stat(file);
      if (s.isDirectory()) {
        res.writeHead(301, { Location: path + '/' });
        return res.end();
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      if (!quiet) console.log(200, path);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      if (!quiet) console.log(404, path);
    }
  });
  return new Promise((ok) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      ok({
        url: `http://127.0.0.1:${actual}${base}`,
        port: actual,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, def) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : def;
  };
  const { url } = await startServer({ port: Number(arg('--port', 8080)), base: arg('--base', '/hisability/'), quiet: false });
  console.log(`His Ability preview: ${url}`);
}
