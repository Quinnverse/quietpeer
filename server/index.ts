import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { createSignalingServer, type SignalingServer } from './signaling.js';

export const HOST = '127.0.0.1';

export interface ApplicationServerOptions {
  production?: boolean;
  root?: string;
  port?: number;
}

export interface ApplicationServer {
  server: HttpServer;
  signaling: SignalingServer;
  close: () => Promise<void>;
}

function setSecurityHeaders(response: ServerResponse, development: boolean, port: number): void {
  const scriptSource = development ? "'self' 'unsafe-eval'" : "'self'";
  const styleSource = development ? "'self' 'unsafe-inline'" : "'self'";
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "form-action 'self'",
      `script-src ${scriptSource}`,
      `style-src ${styleSource}`,
      // Explicitly permit only this process's same-origin WebSocket endpoint for Vite HMR and signaling.
      `connect-src 'self' ws://${HOST}:${port}`,
      "img-src 'self' data:",
      "font-src 'self'",
      "frame-src 'self'",
      "frame-ancestors 'self'",
    ].join('; '),
  );
}

function sendFixed(response: ServerResponse, statusCode: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(body);
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': case '.mjs': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.ico': return 'image/x-icon';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

async function sendFile(response: ServerResponse, filePath: string, method: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    response.statusCode = 200;
    response.setHeader('Content-Type', contentTypeFor(filePath));
    response.setHeader('Content-Length', info.size);
    if (method === 'HEAD') response.end();
    else response.end(await readFile(filePath));
    return true;
  } catch {
    return false;
  }
}

function safeDistPath(distDirectory: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relativePath = decoded.replace(/^\/+/, '');
  const candidate = path.resolve(distDirectory, relativePath || 'index.html');
  const root = path.resolve(distDirectory);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

async function serveProduction(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  distDirectory: string,
): Promise<void> {
  const candidate = safeDistPath(distDirectory, pathname);
  if (!candidate) return sendFixed(response, 400, 'BAD_REQUEST');
  if (await sendFile(response, candidate, request.method ?? 'GET')) return;
  // SPA fallback is intentional for application routes; the manifest is handled before this function.
  if (await sendFile(response, path.join(distDirectory, 'index.html'), request.method ?? 'GET')) return;
  sendFixed(response, 404, 'NOT_FOUND');
}

/** Creates, but does not listen on, the project HTTP/WebSocket server. */
export async function createApplicationServer(options: ApplicationServerOptions = {}): Promise<ApplicationServer> {
  const production = options.production ?? false;
  const root = path.resolve(options.root ?? process.cwd());
  const port = options.port ?? Number(process.env.PORT || 3000);
  let vite: ViteDevServer | undefined;

  const server = createServer((request, response) => {
    void (async () => {
      setSecurityHeaders(response, !production, port);
      let pathname: string;
      try {
        pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      } catch {
        sendFixed(response, 400, 'BAD_REQUEST');
        return;
      }

      if (request.method === 'GET' && pathname === '/health') {
        sendFixed(response, 200, 'ok');
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendFixed(response, 405, 'METHOD_NOT_ALLOWED');
        return;
      }

      // This public file is never allowed through the SPA fallback, even in development.
      if (pathname === '/manus-routes.json') {
        const manifestPath = path.join(production ? root : path.join(root, 'public'), production ? 'dist/manus-routes.json' : 'manus-routes.json');
        if (!(await sendFile(response, manifestPath, request.method))) sendFixed(response, 404, 'NOT_FOUND');
        return;
      }

      if (production) {
        await serveProduction(request, response, pathname, path.join(root, 'dist'));
        return;
      }
      if (!vite) {
        sendFixed(response, 503, 'SERVICE_UNAVAILABLE');
        return;
      }
      if (pathname === '/' || pathname === '/index.html') {
        const template = await readFile(path.join(root, 'index.html'), 'utf8');
        const html = await vite.transformIndexHtml('/', template);
        const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
          .filter(match => !/\bsrc\s*=/.test(match[1]) && match[2].trim())
          .map(match => `'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
        const policy = String(response.getHeader('Content-Security-Policy'));
        response.setHeader('Content-Security-Policy', policy.replace("script-src 'self' 'unsafe-eval'", `script-src 'self' ${hashes.join(' ')}`));
        sendFixed(response, 200, html, 'text/html; charset=utf-8');
        return;
      }
      vite.middlewares(request, response, () => {
        if (!response.writableEnded) sendFixed(response, 404, 'NOT_FOUND');
      });
    })().catch(() => {
      // Deliberately fixed: do not include request paths, bodies, SDP, or invitation material.
      if (!response.writableEnded) sendFixed(response, 500, 'INTERNAL_ERROR');
    });
  });

  if (!production) {
    vite = await createViteServer({
      root,
      appType: 'spa',
      mode: process.env.E2E_TEST === '1' ? 'test' : 'development',
      server: { middlewareMode: true, hmr: false },
    });
  }

  const signaling = createSignalingServer({
    server,
    allowedOrigins: [`http://${HOST}:${port}`],
  });

  return {
    server,
    signaling,
    close: async (): Promise<void> => {
      await signaling.close();
      await vite?.close();
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  };
}

async function listen(server: HttpServer, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    // No port retry/fallback: the configured loopback port is the only permitted listener.
    server.listen(port, HOST);
  });
}

async function main(): Promise<void> {
  const production = process.argv.includes('--production');
  const port = Number(process.env.PORT || 3000);
  const application = await createApplicationServer({ production, port });
  await listen(application.server, port);
}

const entrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (entrypoint) {
  void main().catch(() => {
    // Keep operational errors free of client-controlled data.
    process.stderr.write('SERVER_START_FAILED\n');
    process.exitCode = 1;
  });
}
