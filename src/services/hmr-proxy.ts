/**
 * HMR WebSocket 代理
 * 将客户端 HMR 连接代理到对应项目的 Vite Dev Server
 *
 * 支持两种连接路径:
 * 1. /hmr?projectId=xxx - 外部 HMR 客户端 (如 PreviewFrame)
 * 2. /p/{projectId}/ - Vite 内部 HMR 客户端 (iframe 内的 /@vite/client)
 */

import { WebSocket, WebSocketServer } from 'ws';
import type { Server, IncomingMessage } from 'http';
import { createConnection, type Socket } from 'net';
import { viteManager } from './vite-manager';
import type { HmrMessage } from '../types';

export class HmrWebSocketProxy {
  private wss: WebSocketServer;
  private clients: Map<string, Set<WebSocket>> = new Map();
  private viteConnections: Map<string, WebSocket> = new Map();
  private server: Server;

  constructor(server: Server, path: string = '/hmr') {
    this.server = server;
    // 使用 noServer 模式，手动处理升级请求
    this.wss = new WebSocketServer({ noServer: true });
    this.setupServer();
    this.setupUpgradeHandler(path);
    console.log(`[HMR Proxy] WebSocket server started on path: ${path} and /p/:projectId/`);
  }

  /**
   * 处理 HTTP 升级为 WebSocket 请求
   */
  private setupUpgradeHandler(hmrPath: string): void {
    this.server.on('upgrade', (request: IncomingMessage, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      const pathname = url.pathname;

      // 路径 1: /hmr?projectId=xxx - 外部 HMR 客户端
      if (pathname === hmrPath) {
        const projectId = url.searchParams.get('projectId');
        if (!projectId) {
          console.warn('[HMR Proxy] Upgrade rejected: missing projectId');
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
          return;
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.handleExternalClient(ws, projectId);
        });
        return;
      }

      // 路径 2: 任何包含 /hmr/{projectId} 的路径
      // 支持多种格式:
      //   - /hmr/{projectId} - 直接访问
      //   - /p/{projectId}/hmr/{projectId} - 直连 fly-server (base + hmr.path)
      //   - /api/proxy/{projectId}/hmr/{projectId} - 通过 backend proxy (proxy base + hmr.path)
      const hmrPathMatch = pathname.match(/\/hmr\/([0-9a-f-]{36})/);
      if (hmrPathMatch) {
        const projectId = hmrPathMatch[1];
        const instance = viteManager.getInstance(projectId);

        if (!instance || instance.status !== 'running') {
          console.warn(`[HMR Proxy] Vite not running for project: ${projectId}`);
          socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
          socket.destroy();
          return;
        }

        const viteWsUrl = `ws://localhost:${instance.port}`;
        console.log(`[HMR Proxy] Proxying Vite HMR: ${projectId} (client: ${pathname}) -> Vite WS at port ${instance.port}`);

        this.proxyViteWebSocket(request, socket, head, viteWsUrl, projectId);
        return;
      }

      // 路径 3: /p/{projectId}/ - Vite 内部 HMR 客户端（旧路径，保持向后兼容）
      // 匹配 /p/{projectId}/@vite/client 或 /p/{projectId}/__vite_hmr 等 Vite HMR 路径
      const projectMatch = pathname.match(/^\/p\/([^/]+)\//);
      if (projectMatch) {
        const projectId = projectMatch[1];
        const instance = viteManager.getInstance(projectId);

        if (!instance || instance.status !== 'running') {
          console.warn(`[HMR Proxy] Vite not running for project: ${projectId}`);
          socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
          socket.destroy();
          return;
        }

        // 直接代理到 Vite 的 WebSocket
        // Vite HMR WebSocket 监听在根路径
        const viteWsUrl = `ws://localhost:${instance.port}`;
        console.log(`[HMR Proxy] Proxying Vite HMR: ${projectId} (client: ${pathname}) -> Vite WS at port ${instance.port}`);

        this.proxyViteWebSocket(request, socket, head, viteWsUrl, projectId);
        return;
      }

      // 其他路径不处理
    });
  }

  /**
   * 代理 WebSocket 连接到 Vite Dev Server (使用原始 socket 透传)
   */
  private proxyViteWebSocket(
    request: IncomingMessage,
    clientSocket: import('stream').Duplex,
    head: Buffer,
    viteWsUrl: string,
    projectId: string
  ): void {
    const url = new URL(viteWsUrl);
    const port = parseInt(url.port) || 80;
    const host = url.hostname || 'localhost';

    console.log(`[HMR Proxy] Creating TCP connection to Vite: ${host}:${port}`);

    // 创建到 Vite 的原始 TCP 连接
    const viteSocket: Socket = createConnection({ host, port }, () => {
      console.log(`[HMR Proxy] TCP connected to Vite: ${projectId}`);

      // 构建 WebSocket 升级请求，转发给 Vite
      // 注意：Vite HMR WebSocket 监听在根路径 /，不是客户端请求的路径
      const upgradeRequest = [
        `GET / HTTP/1.1`,
        `Host: ${host}:${port}`,
        `Upgrade: websocket`,
        `Connection: Upgrade`,
        `Sec-WebSocket-Key: ${request.headers['sec-websocket-key']}`,
        `Sec-WebSocket-Version: ${request.headers['sec-websocket-version'] || '13'}`,
        `Origin: http://${host}:${port}`,
        '',
        ''
      ].join('\r\n');

      viteSocket.write(upgradeRequest);
      if (head.length > 0) {
        viteSocket.write(head);
      }
    });

    // 双向管道
    viteSocket.on('connect', () => {
      // 连接成功，清除超时
      viteSocket.setTimeout(0);
      // 当收到 Vite 的响应时，转发给客户端
      viteSocket.pipe(clientSocket);
      clientSocket.pipe(viteSocket);
      console.log(`[HMR Proxy] WebSocket proxy established: ${projectId}`);
      viteManager.markActive(projectId);
    });

    viteSocket.on('error', (error) => {
      console.error(`[HMR Proxy] Vite socket error for ${projectId}:`, error.message);
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.destroy();
    });

    viteSocket.on('close', () => {
      console.log(`[HMR Proxy] Vite socket closed: ${projectId}`);
      clientSocket.destroy();
    });

    clientSocket.on('error', (error) => {
      console.error(`[HMR Proxy] Client socket error for ${projectId}:`, error.message);
      viteSocket.destroy();
    });

    clientSocket.on('close', () => {
      console.log(`[HMR Proxy] Client socket closed: ${projectId}`);
      viteSocket.destroy();
    });

    // 5 秒超时
    viteSocket.setTimeout(5000, () => {
      console.error(`[HMR Proxy] Vite connection timeout: ${projectId}`);
      viteSocket.destroy();
      clientSocket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
      clientSocket.destroy();
    });
  }

  /**
   * 处理外部 HMR 客户端连接 (如 PreviewFrame)
   */
  private handleExternalClient(ws: WebSocket, projectId: string): void {
    console.log(`[HMR Proxy] External client connected: ${projectId}`);
    this.addClient(projectId, ws);

    // 立即发送 connected 消息，告知客户端连接成功
    ws.send(JSON.stringify({ type: 'connected' }));

    ws.on('message', (data) => {
      this.forwardToVite(projectId, data);
    });

    ws.on('close', () => {
      console.log(`[HMR Proxy] External client disconnected: ${projectId}`);
      this.removeClient(projectId, ws);
    });

    ws.on('error', (error) => {
      console.error(`[HMR Proxy] External client error for ${projectId}:`, error.message);
    });
  }

  private setupServer(): void {
    this.wss.on('error', (error) => {
      console.error('[HMR Proxy] Server error:', error);
    });
  }

  private addClient(projectId: string, ws: WebSocket): void {
    if (!this.clients.has(projectId)) {
      this.clients.set(projectId, new Set());
    }
    this.clients.get(projectId)!.add(ws);

    // 确保连接到 Vite
    this.ensureViteConnection(projectId);

    // 标记项目活跃
    viteManager.markActive(projectId);
  }

  private removeClient(projectId: string, ws: WebSocket): void {
    const clients = this.clients.get(projectId);
    if (clients) {
      clients.delete(ws);

      // 如果没有客户端了，断开 Vite 连接
      if (clients.size === 0) {
        this.clients.delete(projectId);
        this.disconnectVite(projectId);
      }
    }
  }

  private ensureViteConnection(projectId: string): void {
    if (this.viteConnections.has(projectId)) {
      return;
    }

    const hmrUrl = viteManager.getHmrUrl(projectId);
    if (!hmrUrl) {
      console.warn(`[HMR Proxy] No Vite HMR URL for ${projectId}`);
      return;
    }

    // Vite HMR WebSocket 监听在根路径 /，不是 /__vite_hmr
    const viteWsUrl = hmrUrl;

    try {
      const viteWs = new WebSocket(viteWsUrl);

      viteWs.on('open', () => {
        console.log(`[HMR Proxy] Connected to Vite: ${projectId}`);
        this.viteConnections.set(projectId, viteWs);
      });

      viteWs.on('message', (data) => {
        this.broadcastToClients(projectId, data);
      });

      viteWs.on('close', () => {
        console.log(`[HMR Proxy] Disconnected from Vite: ${projectId}`);
        this.viteConnections.delete(projectId);
      });

      viteWs.on('error', (error) => {
        console.error(`[HMR Proxy] Vite connection error for ${projectId}:`, error.message);
        this.viteConnections.delete(projectId);
      });
    } catch (error) {
      console.error(`[HMR Proxy] Failed to connect to Vite for ${projectId}:`, error);
    }
  }

  private disconnectVite(projectId: string): void {
    const viteWs = this.viteConnections.get(projectId);
    if (viteWs) {
      viteWs.close();
      this.viteConnections.delete(projectId);
      console.log(`[HMR Proxy] Disconnected Vite connection: ${projectId}`);
    }
  }

  private forwardToVite(projectId: string, data: WebSocket.RawData): void {
    const viteWs = this.viteConnections.get(projectId);
    if (viteWs && viteWs.readyState === WebSocket.OPEN) {
      viteWs.send(data);
    }
  }

  private broadcastToClients(projectId: string, data: WebSocket.RawData): void {
    const clients = this.clients.get(projectId);
    if (!clients) return;

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * 主动推送 HMR 更新
   */
  pushUpdate(projectId: string, message: HmrMessage): void {
    const data = JSON.stringify(message);
    const clients = this.clients.get(projectId);
    if (!clients) return;

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * 获取连接的客户端数
   */
  getClientCount(projectId: string): number {
    return this.clients.get(projectId)?.size ?? 0;
  }

  /**
   * 获取所有连接的项目
   */
  getConnectedProjects(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * 关闭代理
   */
  close(): void {
    // 关闭所有 Vite 连接
    for (const ws of this.viteConnections.values()) {
      ws.close();
    }
    this.viteConnections.clear();

    // 关闭所有客户端连接
    for (const clients of this.clients.values()) {
      for (const client of clients) {
        client.close();
      }
    }
    this.clients.clear();

    // 关闭 WebSocket 服务器
    this.wss.close();
    console.log('[HMR Proxy] Closed');
  }
}
