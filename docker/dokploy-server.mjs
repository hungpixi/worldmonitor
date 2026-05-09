import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.env.STATIC_ROOT || (existsSync('/usr/share/nginx/html') ? '/usr/share/nginx/html' : 'dist');
const port = Number(process.env.PORT || 8080);
const apiPort = Number(process.env.LOCAL_API_PORT || 46123);

const api = spawn(process.execPath, ['/app/local-api-server.mjs'], {
  cwd: '/app',
  stdio: 'inherit',
  env: {
    ...process.env,
    LOCAL_API_PORT: String(apiPort),
    LOCAL_API_MODE: process.env.LOCAL_API_MODE || 'docker',
    LOCAL_API_CLOUD_FALLBACK: process.env.LOCAL_API_CLOUD_FALLBACK || 'false',
  },
});

api.on('exit', (code, signal) => {
  console.error(`[dokploy-server] api exited code=${code} signal=${signal}`);
  process.exit(code || 1);
});

const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith('/api/')) {
      await proxyApi(req, res);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    console.error('[dokploy-server] request failed', error);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[dokploy-server] listening on http://0.0.0.0:${port}`);
});

async function proxyApi(req, res) {
  const upstream = await fetch(`http://127.0.0.1:${apiPort}${req.url}`, {
    method: req.method,
    headers: {
      ...Object.fromEntries(Object.entries(req.headers).filter(([, value]) => value !== undefined)),
      origin: 'http://localhost',
    },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
    duplex: 'half',
  });

  res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
  if (upstream.body) {
    for await (const chunk of upstream.body) res.write(chunk);
  }
  res.end();
}

function serveStatic(req, res) {
  const rawPath = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(root, safePath);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, 'index.html');
  }

  res.writeHead(200, {
    'content-type': contentType(filePath),
    'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(res);
}

function contentType(filePath) {
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }[extname(filePath)] || 'application/octet-stream';
}
