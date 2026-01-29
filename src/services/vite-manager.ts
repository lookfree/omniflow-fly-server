/**
 * Vite Dev Server Manager
 * Manages multiple project Vite development server processes
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { readFile, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import type { ViteInstance, ViteManagerConfig, ViteStatus, LogEvent, ExitEvent } from '../types';
import { dependencyManager } from './dependency-manager';

const DEFAULT_CONFIG: ViteManagerConfig = {
  basePort: 5200,
  maxInstances: 20,
  idleTimeout: 30 * 60 * 1000,  // 30 minutes
  startupTimeout: 60 * 1000,    // 60 seconds
};

export class ViteDevServerManager extends EventEmitter {
  private instances: Map<string, ViteInstance> = new Map();
  private portPool: Set<number> = new Set();
  private config: ViteManagerConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private bunBinary = process.env.BUN_BINARY || process.execPath;

  constructor(config: Partial<ViteManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize port pool
    for (let i = 0; i < this.config.maxInstances; i++) {
      this.portPool.add(this.config.basePort + i);
    }

    // Start idle cleanup timer
    this.cleanupTimer = setInterval(() => this.cleanupIdle(), 60 * 1000);
  }

  /**
   * Start Vite Dev Server for a project
   */
  async start(projectId: string, projectPath: string): Promise<ViteInstance> {
    // If already running, update active time and return
    const existing = this.instances.get(projectId);
    if (existing && existing.status === 'running') {
      existing.lastActive = new Date();
      return existing;
    }

    // Allocate port
    const port = this.allocatePort();
    if (port === null) {
      throw new Error('No available ports. Max instances reached.');
    }

    // Create instance
    const instance: ViteInstance = {
      projectId,
      port,
      process: null as unknown as ChildProcess,
      startedAt: new Date(),
      lastActive: new Date(),
      status: 'starting',
    };

    this.instances.set(projectId, instance);

    try {
      // Ensure jsx-tagger dependency is installed
      await this.ensureJsxTaggerDependency(projectPath);

      // Ensure vite.config is properly configured (jsxTaggerPlugin, allowedHosts, base, hmr)
      await this.ensureViteConfig(projectId, projectPath);

      // Start Vite process
      const proc = spawn(this.bunBinary, [
        'run', 'vite',
        '--host', '0.0.0.0',
        '--port', String(port),
        '--strictPort',
      ], {
        cwd: projectPath,
        env: { ...process.env, NODE_ENV: 'development' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      instance.process = proc;

      // Listen to output
      this.setupProcessListeners(instance);

      // Wait for server to be ready
      await this.waitForReady(port);

      instance.status = 'running';
      this.emit('started', { projectId, port });

      console.log(`[ViteManager] Started: ${projectId} on port ${port}`);

      return instance;
    } catch (error) {
      instance.status = 'error';
      this.releasePort(port);
      this.instances.delete(projectId);
      console.error(`[ViteManager] Failed to start ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Stop Vite Dev Server for a project
   */
  async stop(projectId: string): Promise<void> {
    const instance = this.instances.get(projectId);
    if (!instance) return;

    instance.status = 'stopping';

    // Graceful shutdown
    instance.process.kill('SIGTERM');

    // Wait for process to exit (max 5 seconds)
    await Promise.race([
      new Promise<void>(resolve => {
        instance.process.on('exit', () => resolve());
      }),
      new Promise<void>(resolve => {
        setTimeout(() => {
          if (instance.process.killed === false) {
            instance.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);
      }),
    ]);

    instance.status = 'stopped';
    this.releasePort(instance.port);
    this.instances.delete(projectId);
    this.emit('stopped', { projectId });

    console.log(`[ViteManager] Stopped: ${projectId}`);
  }

  /**
   * Ensure jsx-tagger dependency is installed
   */
  private async ensureJsxTaggerDependency(projectPath: string): Promise<void> {
    const packageJsonPath = join(projectPath, 'package.json');
    const jsxTaggerDep = process.env.JSX_TAGGER_DEP || 'file:/app/packages/vite-plugin-jsx-tagger';

    try {
      const content = await readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      // Check if vite-plugin-jsx-tagger dependency already exists
      const hasDep = packageJson.dependencies?.['vite-plugin-jsx-tagger'] ||
                     packageJson.devDependencies?.['vite-plugin-jsx-tagger'];

      if (!hasDep) {
        console.log(`[ViteManager] Adding vite-plugin-jsx-tagger dependency to package.json`);

        // Add to devDependencies
        if (!packageJson.devDependencies) {
          packageJson.devDependencies = {};
        }
        packageJson.devDependencies['vite-plugin-jsx-tagger'] = jsxTaggerDep;

        await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8');

        // Delete node_modules and reinstall
        console.log(`[ViteManager] Reinstalling dependencies...`);
        const nodeModulesPath = join(projectPath, 'node_modules');
        try {
          await rm(nodeModulesPath, { recursive: true, force: true });
        } catch {
          // node_modules may not exist
        }

        const result = await dependencyManager.install(projectPath);
        if (!result.success) {
          console.error(`[ViteManager] Failed to install dependencies:`, result.logs.join('\n'));
        } else {
          console.log(`[ViteManager] Dependencies installed successfully`);
        }
      }
    } catch (error) {
      console.warn(`[ViteManager] Failed to ensure jsx-tagger dependency:`, error);
    }
  }

  /**
   * Ensure vite.config is properly configured (jsxTaggerPlugin, allowedHosts, base, hmr)
   */
  private async ensureViteConfig(projectId: string, projectPath: string): Promise<void> {
    const configPath = join(projectPath, 'vite.config.ts');
    const basePath = `/p/${projectId}/`;
    const idPrefix = projectId.slice(0, 8);
    // fly-server public domain for direct HMR WebSocket connection
    const flyPublicHost = process.env.FLY_PUBLIC_HOST || 'ai-site-preview.fly.dev';
    const isHttps = flyPublicHost.includes('fly.dev') || process.env.FLY_HTTPS === 'true';

    try {
      let content = await readFile(configPath, 'utf-8');
      let modified = false;

      // 0. Ensure jsxTaggerPlugin is imported and used (for visual editing)
      if (!content.includes('jsxTaggerPlugin')) {
        // Add import
        if (content.includes("from 'vite'")) {
          content = content.replace(
            /import\s*\{[^}]*\}\s*from\s*['"]vite['"]/,
            match => `${match}\nimport { jsxTaggerPlugin } from 'vite-plugin-jsx-tagger';`
          );
        } else {
          // Add import at the beginning of the file
          content = `import { jsxTaggerPlugin } from 'vite-plugin-jsx-tagger';\n${content}`;
        }

        // Add plugin to plugins array (must be before react())
        const jsxTaggerPluginConfig = `jsxTaggerPlugin({
      idPrefix: '${idPrefix}',
      removeInProduction: false,
    }),`;

        if (content.includes('plugins:')) {
          // Add at the beginning of plugins array
          content = content.replace(
            /plugins:\s*\[/,
            `plugins: [\n    // JSX Tagger must be before React plugin\n    ${jsxTaggerPluginConfig}`
          );
        }
        modified = true;
        console.log(`[ViteManager] Added jsxTaggerPlugin to vite.config.ts for visual editing`);
      }

      // 1. Add or update base configuration
      if (content.includes('base:')) {
        // Update existing base configuration
        content = content.replace(/base:\s*['"][^'"]*['"]/, `base: '${basePath}'`);
        modified = true;
      } else if (content.includes('defineConfig({')) {
        // Add base after defineConfig
        content = content.replace(
          /defineConfig\(\{/,
          `defineConfig({\n  base: '${basePath}',`
        );
        modified = true;
      }

      // 2. Add or update server configuration (including allowedHosts and hmr)
      // HMR configuration lets Vite client connect directly to fly-server, bypassing backend proxy
      // Note: path uses full path, Vite will use this path directly (won't combine with base)
      const hmrConfig = `hmr: {
      protocol: '${isHttps ? 'wss' : 'ws'}',
      host: '${flyPublicHost}',
      clientPort: ${isHttps ? 443 : 3000},
      path: '/hmr/${projectId}',
      overlay: true,
    },`;

      if (content.includes('server:')) {
        // server configuration exists
        if (!content.includes('allowedHosts')) {
          content = content.replace(
            /server:\s*\{/,
            "server: {\n    allowedHosts: 'all',"
          );
          modified = true;
        }
        // Update or add hmr configuration
        if (content.includes('hmr:')) {
          // Replace existing hmr configuration (use more robust regex, match nested braces)
          // Match hmr: { ... } including multiline and nested objects
          content = content.replace(
            /hmr:\s*\{[\s\S]*?overlay:\s*true,?\s*\},?[\s\n]*/,
            hmrConfig + '\n    '
          );
          modified = true;
        } else {
          // Add hmr after allowedHosts
          content = content.replace(
            /(allowedHosts:\s*['"][^'"]*['"],?)\s*/,
            `$1\n    ${hmrConfig}\n    `
          );
          modified = true;
        }
      } else if (content.includes('defineConfig({')) {
        // Add complete server configuration
        content = content.replace(
          /defineConfig\(\{/,
          `defineConfig({\n  server: {\n    allowedHosts: 'all',\n    ${hmrConfig}\n  },`
        );
        modified = true;
      }

      if (modified) {
        await writeFile(configPath, content, 'utf-8');
        console.log(`[ViteManager] Updated vite.config.ts with base: ${basePath}, allowedHosts, and HMR config for ${flyPublicHost}`);
      }
    } catch (error) {
      console.warn(`[ViteManager] Failed to update vite.config.ts:`, error);
      // Don't block startup, continue trying
    }
  }

  /**
   * Get instance information
   */
  getInstance(projectId: string): ViteInstance | undefined {
    return this.instances.get(projectId);
  }

  /**
   * Get preview URL
   */
  getPreviewUrl(projectId: string): string | null {
    const instance = this.instances.get(projectId);
    if (!instance || instance.status !== 'running') return null;
    return `http://localhost:${instance.port}`;
  }

  /**
   * Get HMR WebSocket URL
   */
  getHmrUrl(projectId: string): string | null {
    const instance = this.instances.get(projectId);
    if (!instance || instance.status !== 'running') return null;
    return `ws://localhost:${instance.port}`;
  }

  /**
   * Mark as active (prevent cleanup)
   */
  markActive(projectId: string): void {
    const instance = this.instances.get(projectId);
    if (instance) {
      instance.lastActive = new Date();
    }
  }

  /**
   * Get count of running instances
   */
  getRunningCount(): number {
    return Array.from(this.instances.values())
      .filter(i => i.status === 'running')
      .length;
  }

  /**
   * Get status of all instances
   */
  getAllInstances(): Array<{ projectId: string; port: number; status: ViteStatus; lastActive: Date }> {
    return Array.from(this.instances.values()).map(i => ({
      projectId: i.projectId,
      port: i.port,
      status: i.status,
      lastActive: i.lastActive,
    }));
  }

  /**
   * Destroy manager
   */
  async destroy(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Stop all instances
    const stopPromises = Array.from(this.instances.keys()).map(id => this.stop(id));
    await Promise.all(stopPromises);
  }

  private allocatePort(): number | null {
    const iterator = this.portPool.values();
    const result = iterator.next();
    if (!result.done) {
      this.portPool.delete(result.value);
      return result.value;
    }
    return null;
  }

  private releasePort(port: number): void {
    this.portPool.add(port);
  }

  private setupProcessListeners(instance: ViteInstance): void {
    const { process: proc, projectId } = instance;

    proc.stdout?.on('data', (data: Buffer) => {
      const message = data.toString();
      console.log(`[Vite:${projectId.slice(0, 8)}] ${message.trim()}`);
      const event: LogEvent = {
        projectId,
        type: 'stdout',
        message
      };
      this.emit('log', event);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const message = data.toString();
      console.error(`[Vite:${projectId.slice(0, 8)}:ERR] ${message.trim()}`);
      const event: LogEvent = {
        projectId,
        type: 'stderr',
        message
      };
      this.emit('log', event);
    });

    proc.on('exit', (code: number | null) => {
      const event: ExitEvent = { projectId, code };
      this.emit('exit', event);

      if (instance.status !== 'stopping' && instance.status !== 'stopped') {
        // Abnormal exit
        console.error(`[ViteManager] Process exited unexpectedly: ${projectId}, code: ${code}`);
        this.releasePort(instance.port);
        this.instances.delete(projectId);
      }
    });

    proc.on('error', (error: Error) => {
      console.error(`[ViteManager] Process error: ${projectId}`, error);
      instance.status = 'error';
    });
  }

  private async waitForReady(port: number): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < this.config.startupTimeout) {
      try {
        const response = await fetch(`http://localhost:${port}`, {
          method: 'HEAD',
        });
        // Vite may return 200 or 404 (when there's no index.html)
        if (response.ok || response.status === 404) {
          return;
        }
      } catch {
        // Server not ready yet, continue waiting
      }
      await new Promise(r => setTimeout(r, 200));
    }

    throw new Error(`Vite startup timeout after ${this.config.startupTimeout}ms`);
  }

  private cleanupIdle(): void {
    const now = Date.now();

    for (const [projectId, instance] of this.instances) {
      if (instance.status === 'running') {
        const idleTime = now - instance.lastActive.getTime();
        if (idleTime > this.config.idleTimeout) {
          console.log(`[ViteManager] Stopping idle instance: ${projectId} (idle for ${Math.round(idleTime / 1000)}s)`);
          this.stop(projectId).catch(err => {
            console.error(`[ViteManager] Failed to stop idle instance ${projectId}:`, err);
          });
        }
      }
    }
  }
}

// Export singleton
export const viteManager = new ViteDevServerManager();
