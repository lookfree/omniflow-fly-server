/**
 * HMR WebSocket Proxy
 * Proxies client HMR connections to corresponding project Vite Dev Server
 *
 * Supports two connection paths:
 * 1. /hmr?projectId=xxx - External HMR clients (e.g., PreviewFrame)
 * 2. /p/{projectId}/ - Vite internal HMR clients (/@vite/client inside iframe)
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
    // Use noServer mode, manually handle upgrade requests
    this.wss = new WebSocketServer({ noServer: true });
    this.setupServer();
    this.setupUpgradeHandler(path);
    console.log(`[HMR Proxy] WebSocket server started on path: ${path} and /p/:projectId/`);
  }

  /**
   * Handle HTTP upgrade to WebSocket requests
   */
  private setupUpgradeHandler(hmrPath: string): void {
    this.server.on('upgrade', (request: IncomingMessage, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      const pathname = url.pathname;

      // Path 1: /hmr?projectId=xxx - External HMR clients
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

      // Path 2: Any path containing /hmr/{projectId}
      // Supports multiple formats:
      //   - /hmr/{projectId} - Direct access
      //   - /p/{projectId}/hmr/{projectId} - Direct to fly-server (base + hmr.path)
      //   - /api/proxy/{projectId}/hmr/{projectId} - Via backend proxy (proxy base + hmr.path)
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

      // Path 3: /p/{projectId}/ - Vite internal HMR clients (legacy path, backward compatible)
      // Matches /p/{projectId}/@vite/client or /p/{projectId}/__vite_hmr and other Vite HMR paths
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

        // Directly proxy to Vite's WebSocket
        // Vite HMR WebSocket listens on root path
        const viteWsUrl = `ws://localhost:${instance.port}`;
        console.log(`[HMR Proxy] Proxying Vite HMR: ${projectId} (client: ${pathname}) -> Vite WS at port ${instance.port}`);

        this.proxyViteWebSocket(request, socket, head, viteWsUrl, projectId);
        return;
      }

      // Other paths not handled
    });
  }

  /**
   * Proxy WebSocket connection to Vite Dev Server (using raw socket passthrough)
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

    // Create raw TCP connection to Vite
    const viteSocket: Socket = createConnection({ host, port }, () => {
      console.log(`[HMR Proxy] TCP connected to Vite: ${projectId}`);

      // Build WebSocket upgrade request, forward to Vite
      // Note: Vite HMR WebSocket listens on root path /, not the client request path
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

    // Bidirectional pipe
    viteSocket.on('connect', () => {
      // Connection successful, clear timeout
      viteSocket.setTimeout(0);
      // When receiving Vite's response, forward to client
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

    // 5 second timeout
    viteSocket.setTimeout(5000, () => {
      console.error(`[HMR Proxy] Vite connection timeout: ${projectId}`);
      viteSocket.destroy();
      clientSocket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
      clientSocket.destroy();
    });
  }

  /**
   * Handle external HMR client connection (e.g., PreviewFrame)
   */
  private handleExternalClient(ws: WebSocket, projectId: string): void {
    console.log(`[HMR Proxy] External client connected: ${projectId}`);
    this.addClient(projectId, ws);

    // Immediately send connected message to notify client connection successful
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

    // Ensure connected to Vite
    this.ensureViteConnection(projectId);

    // Mark project as active
    viteManager.markActive(projectId);
  }

  private removeClient(projectId: string, ws: WebSocket): void {
    const clients = this.clients.get(projectId);
    if (clients) {
      clients.delete(ws);

      // If no clients left, disconnect Vite connection
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

    // Vite HMR WebSocket listens on root path /, not /__vite_hmr
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
   * Actively push HMR updates
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
   * Get connected client count
   */
  getClientCount(projectId: string): number {
    return this.clients.get(projectId)?.size ?? 0;
  }

  /**
   * Get all connected projects
   */
  getConnectedProjects(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Close proxy
   */
  close(): void {
    // Close all Vite connections
    for (const ws of this.viteConnections.values()) {
      ws.close();
    }
    this.viteConnections.clear();

    // Close all client connections
    for (const clients of this.clients.values()) {
      for (const client of clients) {
        client.close();
      }
    }
    this.clients.clear();

    // Close WebSocket server
    this.wss.close();
    console.log('[HMR Proxy] Closed');
  }
}
