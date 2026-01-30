/**
 * Fly-Server - Dynamic Build Server
 * Supports Vite Dev Server process management and HMR proxy
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import { mkdir, readdir, readFile } from 'fs/promises';
import { join } from 'path';
import type { Server } from 'http';

import projectRoutes from './routes/projects';
import healthRoutes from './routes/health';
import { HmrWebSocketProxy } from './services/hmr-proxy';
import { viteManager } from './services/vite-manager';
import { projectManager } from './services/project-manager';
import { templateManager } from './services/template-manager';
import { authMiddleware } from './middleware/auth';

const DATA_DIR = process.env.DATA_DIR || '/data/sites';
const PORT = parseInt(process.env.PORT || '3000', 10);

// Create Hono app
const app = new Hono();

// Middleware
app.use('*', cors());
app.use('*', logger());

// Routes
// Apply auth middleware to /projects routes (requires API Key + HMAC signature)
app.use('/projects/*', authMiddleware);
app.route('/projects', projectRoutes);
// Health routes are public (no auth required)
app.route('/health', healthRoutes);
app.get('/metrics', (c) => c.redirect('/health/metrics'));

// Static file server - visual-edit-script (local copy from packages/visual-editor)
// Before deployment, run: cp ../packages/visual-editor/dist/injection/visual-edit-script.js static/injection/
app.use('/static/visual-edit-script.js', serveStatic({
  root: './static/injection',
  rewriteRequestPath: () => '/visual-edit-script.js',
}));

// HMR HTTP route - Handle non-WebSocket HMR path requests
// Vite client may first send HTTP request to check if HMR endpoint is available
// If returns 404, Vite will trigger full page reload
// Supports multiple path formats:
//   - /hmr/{projectId}
//   - /p/{projectId}/hmr/{projectId}
//   - /api/proxy/{projectId}/hmr/{projectId}
// Note: Must skip WebSocket upgrade requests, let hmr-proxy handle them
app.get('*', async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  const hmrMatch = pathname.match(/\/hmr\/([0-9a-f-]{36})/);

  if (hmrMatch) {
    // Check if this is a WebSocket upgrade request
    const upgradeHeader = c.req.header('Upgrade');
    if (upgradeHeader?.toLowerCase() === 'websocket') {
      // WebSocket upgrade request, skip HTTP handling, let server.on('upgrade') handle it
      console.log(`[Server] HMR WebSocket upgrade request: ${pathname} (skipping HTTP handler)`);
      return next();
    }

    const projectId = hmrMatch[1];
    console.log(`[Server] HMR HTTP request: ${pathname} (projectId: ${projectId})`);

    // Return empty response for non-WebSocket HTTP requests
    return c.text('', 200);
  }

  return next();
});

// Handle project preview route without trailing slash - redirect to version with slash
// Must be placed before wildcard route
app.get('/p/:projectId', (c) => {
  const projectId = c.req.param('projectId');
  return c.redirect(`/p/${projectId}/`);
});

// Project preview proxy - Forward /p/{projectId}/* to corresponding Vite Dev Server
app.all('/p/:projectId/*', async (c) => {
  const projectId = c.req.param('projectId');
  let instance = viteManager.getInstance(projectId);

  // If Vite is not running, try to auto-start it
  if (!instance || instance.status !== 'running') {
    const status = await projectManager.getStatus(projectId);

    if (!status.exists) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    // Project exists but Vite is not running, auto-start it
    console.log(`[Server] Auto-starting Vite for project: ${projectId}`);
    try {
      await projectManager.startPreview(projectId);
      instance = viteManager.getInstance(projectId);

      if (!instance || instance.status !== 'running') {
        return c.json({ success: false, error: 'Failed to start project preview' }, 500);
      }
    } catch (error) {
      console.error(`[Server] Failed to auto-start project ${projectId}:`, error);
      return c.json({ success: false, error: 'Failed to start project' }, 500);
    }
  }

  // Get full path - Vite is configured with base: '/p/{projectId}/', need to forward full path
  const fullPath = c.req.path;
  const queryString = new URL(c.req.url).search;

  // For Vite middleware API paths (like /__jsx-locate, /__jsx-by-file),
  // strip the /p/{projectId} prefix since middlewares are registered without it
  const pathAfterBase = fullPath.replace(`/p/${projectId}`, '') || '/';
  const isViteMiddlewareApi = pathAfterBase.startsWith('/__jsx-');

  // Proxy request to Vite Dev Server
  // - For middleware APIs: use path without base prefix
  // - For other requests: preserve full path (Vite expects base prefix)
  const proxyPath = isViteMiddlewareApi ? pathAfterBase : fullPath;
  const targetUrl = `http://localhost:${instance.port}${proxyPath}${queryString}`;

  if (isViteMiddlewareApi) {
    console.log(`[Proxy] Vite middleware API: ${fullPath} -> ${proxyPath}`);
  }

  try {
    // Create new request headers, set Host to localhost to bypass Vite's allowedHosts check
    const proxyHeaders = new Headers();
    proxyHeaders.set('Host', `localhost:${instance.port}`);
    proxyHeaders.set('Origin', `http://localhost:${instance.port}`);
    // Copy other important headers
    const accept = c.req.header('Accept');
    if (accept) proxyHeaders.set('Accept', accept);
    const acceptEncoding = c.req.header('Accept-Encoding');
    if (acceptEncoding) proxyHeaders.set('Accept-Encoding', acceptEncoding);

    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers: proxyHeaders,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
    });

    // For root path HTML requests, inject scripts
    const pathAfterProject = fullPath.replace(`/p/${projectId}`, '') || '/';
    if (pathAfterProject === '/' || pathAfterProject === '/index.html') {
      return await injectScripts(response, projectId);
    }

    // Forward response
    const responseHeaders = new Headers(response.headers);
    // Remove headers that may cause issues
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(`[Proxy] Error proxying to ${targetUrl}:`, error);
    return c.json({ success: false, error: 'Proxy error' }, 502);
  }
});

// Helper function: Inject <base> tag and visual-edit-script into HTML response
async function injectScripts(response: Response, projectId: string): Promise<Response> {
  const contentType = response.headers.get('content-type') || '';

  // Only process HTML responses
  if (!contentType.includes('text/html')) {
    return response;
  }

  let html = await response.text();
  const baseHref = `/p/${projectId}/`;

  // Inject content: base tag + visual-edit-script (theme listener is integrated in visual-edit-script)
  const injectedContent = `
    <base href="${baseHref}">
    <script type="module" src="/static/visual-edit-script.js"></script>`;

  // Inject after <head> tag
  if (html.includes('<head>')) {
    html = html.replace('<head>', `<head>${injectedContent}`);
  } else if (html.includes('<HEAD>')) {
    html = html.replace('<HEAD>', `<HEAD>${injectedContent}`);
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');

  return new Response(html, {
    status: response.status,
    headers: responseHeaders,
  });
}

// Root route - Welcome page
app.get('/', async (c) => {
  const projectCount = await countProjects();

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Site Generator - Fly Server</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
        }
        .container {
            text-align: center;
            padding: 40px;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 500px;
        }
        h1 { color: #2d3748; margin-bottom: 16px; }
        p { color: #718096; margin: 8px 0; }
        code { background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-size: 14px; }
        .status { margin-top: 20px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
        .stat { display: inline-block; margin: 0 15px; }
        .stat-value { font-size: 24px; font-weight: bold; color: #667eea; }
        .stat-label { font-size: 12px; color: #a0aec0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>AI Site Generator</h1>
        <p>Dynamic Build Server with HMR</p>
        <div class="status">
            <div class="stat">
                <div class="stat-value">${projectCount}</div>
                <div class="stat-label">Projects</div>
            </div>
            <div class="stat">
                <div class="stat-value">${viteManager.getRunningCount()}</div>
                <div class="stat-label">Running</div>
            </div>
        </div>
        <p style="margin-top: 20px;">
            API: <code>/projects</code> | Health: <code>/health</code> | Metrics: <code>/metrics</code>
        </p>
    </div>
</body>
</html>`);
});

// Helper function: Count projects
async function countProjects(): Promise<number> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const entries = await readdir(DATA_DIR, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

// HMR proxy instance
let hmrProxy: HmrWebSocketProxy | null = null;

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log('\n[Server] Shutting down...');

  // Close HMR proxy
  if (hmrProxy) {
    hmrProxy.close();
  }

  // Close all Vite instances
  await viteManager.destroy();

  console.log('[Server] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
async function start(): Promise<void> {
  // Ensure data directory exists
  await mkdir(DATA_DIR, { recursive: true });

  // Initialize template project in background (speeds up subsequent project creation)
  // Does not block server startup, but will be ready for first project creation
  templateManager.initialize().then(() => {
    console.log('[Server] Template project initialized (fast project creation enabled)');
  }).catch((err) => {
    console.error('[Server] Failed to initialize template (will use slow path):', err.message);
  });

  const projectCount = await countProjects();

  // Use Hono's Node.js adapter
  const server = serve({
    fetch: app.fetch,
    port: PORT,
    hostname: '0.0.0.0',
  }, (info) => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║        AI Site Generator - Fly Server (Dynamic Build)      ║
╠════════════════════════════════════════════════════════════╣
║  HTTP Server:    http://0.0.0.0:${String(info.port).padEnd(27)}║
║  HMR WebSocket:  ws://0.0.0.0:${String(info.port).padEnd(28)}/hmr ║
║  Data Dir:       ${DATA_DIR.padEnd(40)}║
║  Projects:       ${String(projectCount).padEnd(40)}║
╚════════════════════════════════════════════════════════════╝
    `);
  });

  // Initialize HMR WebSocket proxy
  hmrProxy = new HmrWebSocketProxy(server as Server, '/hmr');
}

start().catch((error) => {
  console.error('[Server] Failed to start:', error);
  process.exit(1);
});
