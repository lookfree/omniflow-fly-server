/**
 * Fly-Server - 动态构建服务器
 * 支持 Vite Dev Server 进程管理和 HMR 代理
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

const DATA_DIR = process.env.DATA_DIR || '/data/sites';
const PORT = parseInt(process.env.PORT || '3000', 10);

// 创建 Hono 应用
const app = new Hono();

// 中间件
app.use('*', cors());
app.use('*', logger());

// 路由
app.route('/projects', projectRoutes);
app.route('/health', healthRoutes);
app.get('/metrics', (c) => c.redirect('/health/metrics'));

// 静态文件服务 - visual-edit-script (本地副本，从 packages/visual-editor 复制)
// 部署前需要运行: cp ../packages/visual-editor/dist/injection/visual-edit-script.js static/injection/
app.use('/static/visual-edit-script.js', serveStatic({
  root: './static/injection',
  rewriteRequestPath: () => '/visual-edit-script.js',
}));

// HMR HTTP 路由 - 处理非 WebSocket 的 HMR 路径请求
// Vite 客户端可能会先发送 HTTP 请求检测 HMR 端点是否可用
// 如果返回 404，Vite 会触发全页刷新
// 支持多种路径格式：
//   - /hmr/{projectId}
//   - /p/{projectId}/hmr/{projectId}
//   - /api/proxy/{projectId}/hmr/{projectId}
// 注意：必须跳过 WebSocket 升级请求，让 hmr-proxy 处理
app.get('*', async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  const hmrMatch = pathname.match(/\/hmr\/([0-9a-f-]{36})/);

  if (hmrMatch) {
    // 检查是否是 WebSocket 升级请求
    const upgradeHeader = c.req.header('Upgrade');
    if (upgradeHeader?.toLowerCase() === 'websocket') {
      // WebSocket 升级请求，跳过 HTTP 处理，让 server.on('upgrade') 处理
      console.log(`[Server] HMR WebSocket upgrade request: ${pathname} (skipping HTTP handler)`);
      return next();
    }

    const projectId = hmrMatch[1];
    console.log(`[Server] HMR HTTP request: ${pathname} (projectId: ${projectId})`);

    // 返回空响应，非 WebSocket 的 HTTP 请求
    return c.text('', 200);
  }

  return next();
});

// 处理不带尾随斜杠的项目预览路由 - 重定向到带斜杠的版本
// 必须放在 wildcard 路由之前
app.get('/p/:projectId', (c) => {
  const projectId = c.req.param('projectId');
  return c.redirect(`/p/${projectId}/`);
});

// 项目预览代理 - 将 /p/{projectId}/* 转发到对应的 Vite Dev Server
app.all('/p/:projectId/*', async (c) => {
  const projectId = c.req.param('projectId');
  let instance = viteManager.getInstance(projectId);

  // 如果 Vite 没有运行，尝试自动启动
  if (!instance || instance.status !== 'running') {
    const status = await projectManager.getStatus(projectId);

    if (!status.exists) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    // 项目存在但 Vite 没有运行，自动启动
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

  // 获取完整路径 - Vite 配置了 base: '/p/{projectId}/'，需要转发完整路径
  const fullPath = c.req.path;
  const queryString = new URL(c.req.url).search;

  // 代理请求到 Vite Dev Server (保留完整路径)
  const targetUrl = `http://localhost:${instance.port}${fullPath}${queryString}`;

  try {
    // 创建新的请求头，设置 Host 为 localhost 以绕过 Vite 的 allowedHosts 检查
    const proxyHeaders = new Headers();
    proxyHeaders.set('Host', `localhost:${instance.port}`);
    proxyHeaders.set('Origin', `http://localhost:${instance.port}`);
    // 复制其他重要头部
    const accept = c.req.header('Accept');
    if (accept) proxyHeaders.set('Accept', accept);
    const acceptEncoding = c.req.header('Accept-Encoding');
    if (acceptEncoding) proxyHeaders.set('Accept-Encoding', acceptEncoding);

    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers: proxyHeaders,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
    });

    // 对于根路径的 HTML 请求，注入脚本
    const pathAfterProject = fullPath.replace(`/p/${projectId}`, '') || '/';
    if (pathAfterProject === '/' || pathAfterProject === '/index.html') {
      return await injectScripts(response, projectId);
    }

    // 转发响应
    const responseHeaders = new Headers(response.headers);
    // 移除可能导致问题的头部
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

// 辅助函数：注入 <base> 标签和 visual-edit-script 到 HTML 响应
async function injectScripts(response: Response, projectId: string): Promise<Response> {
  const contentType = response.headers.get('content-type') || '';

  // 只处理 HTML 响应
  if (!contentType.includes('text/html')) {
    return response;
  }

  let html = await response.text();
  const baseHref = `/p/${projectId}/`;

  // 注入内容：base 标签 + visual-edit-script（主题监听已集成在 visual-edit-script 中）
  const injectedContent = `
    <base href="${baseHref}">
    <script type="module" src="/static/visual-edit-script.js"></script>`;

  // 在 <head> 标签后注入
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

// 根路由 - 欢迎页面
app.get('/', async (c) => {
  const projectCount = await countProjects();

  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
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

// 辅助函数：统计项目数量
async function countProjects(): Promise<number> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const entries = await readdir(DATA_DIR, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

// HMR 代理实例
let hmrProxy: HmrWebSocketProxy | null = null;

// 优雅关闭
async function shutdown(): Promise<void> {
  console.log('\n[Server] Shutting down...');

  // 关闭 HMR 代理
  if (hmrProxy) {
    hmrProxy.close();
  }

  // 关闭所有 Vite 实例
  await viteManager.destroy();

  console.log('[Server] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// 启动服务器
async function start(): Promise<void> {
  // 确保数据目录存在
  await mkdir(DATA_DIR, { recursive: true });

  const projectCount = await countProjects();

  // 使用 Hono 的 Node.js 适配器
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

  // 初始化 HMR WebSocket 代理
  hmrProxy = new HmrWebSocketProxy(server as Server, '/hmr');
}

start().catch((error) => {
  console.error('[Server] Failed to start:', error);
  process.exit(1);
});
