/**
 * Vite Dev Server Manager
 * Manages multiple project Vite development server processes
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { readFile, writeFile } from 'fs/promises';
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

        // Install new dependency (bun install will add the new package)
        console.log(`[ViteManager] Installing new dependency...`);
        const result = await dependencyManager.ensure(projectPath);
        if (!result.success) {
          console.error(`[ViteManager] Failed to install dependencies:`, result.logs.join('\n'));
        } else {
          console.log(`[ViteManager] Dependencies installed in ${result.duration}ms`);
        }
      }
    } catch (error) {
      console.warn(`[ViteManager] Failed to ensure jsx-tagger dependency:`, error);
    }
  }

  /**
   * Ensure vite.config is properly configured (jsxTaggerPlugin, allowedHosts, base, hmr)
   * This function regenerates vite.config.ts while preserving user's plugins from package.json
   */
  private async ensureViteConfig(projectId: string, projectPath: string): Promise<void> {
    const configPath = join(projectPath, 'vite.config.ts');
    const packageJsonPath = join(projectPath, 'package.json');
    const basePath = `/p/${projectId}/`;
    const idPrefix = projectId.slice(0, 8);
    // fly-server public domain for direct HMR WebSocket connection
    const flyPublicHost = process.env.FLY_PUBLIC_HOST || 'omniflow-preview.fly.dev';
    const isHttps = flyPublicHost.includes('fly.dev') || process.env.FLY_HTTPS === 'true';

    try {
      const originalContent = await readFile(configPath, 'utf-8');

      // Check if config already has correct base and HMR settings
      const hasCorrectBase = originalContent.includes(`base: '${basePath}'`);
      const hasCorrectHmr = originalContent.includes(`path: '/hmr/${projectId}'`);
      const hasJsxTagger = originalContent.includes('jsxTaggerPlugin');

      // If config is already correct, just ensure dependencies are valid
      if (hasCorrectBase && hasCorrectHmr && hasJsxTagger) {
        console.log(`[ViteManager] vite.config.ts already configured correctly, ensuring dependencies...`);
        // Run bun install to fix any broken symlinks (faster than reinstall)
        const result = await dependencyManager.ensure(projectPath);
        if (!result.success) {
          console.error(`[ViteManager] Dependency fix failed:`, result.logs.join('\n'));
        } else {
          console.log(`[ViteManager] Dependencies verified/fixed in ${result.duration}ms`);
        }
        return;
      }

      // Read package.json to see what dependencies are available
      let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
      try {
        const pkgContent = await readFile(packageJsonPath, 'utf-8');
        packageJson = JSON.parse(pkgContent);
      } catch {
        // Ignore if package.json doesn't exist
      }
      const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };

      // Detect additional imports and plugins based on package.json
      const additionalImports: string[] = [];
      const additionalPlugins: string[] = [];

      // Check for @tailwindcss/vite
      if (allDeps['@tailwindcss/vite'] && originalContent.includes('@tailwindcss/vite')) {
        additionalImports.push("import tailwindcss from '@tailwindcss/vite';");
        additionalPlugins.push('tailwindcss()');
      }

      // Check for path (standard node module for resolve.alias)
      const hasPathImport = originalContent.includes("import path") || originalContent.includes("from 'path'") || originalContent.includes('from "path"');
      if (hasPathImport) {
        additionalImports.push("import path from 'path';");
      }

      // Extract resolve.alias if exists
      const aliasMatch = originalContent.match(/resolve:\s*\{[\s\S]*?alias:\s*\{([\s\S]*?)\}/);
      let aliasConfig = '';
      if (aliasMatch) {
        aliasConfig = aliasMatch[1].trim();
      }

      // Build new clean vite.config.ts
      const newConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { jsxTaggerPlugin } from 'vite-plugin-jsx-tagger';
${additionalImports.join('\n')}${additionalImports.length > 0 ? '\n' : ''}
export default defineConfig({
  base: '${basePath}',
  plugins: [
    // JSX Tagger must be before React plugin for visual editing
    jsxTaggerPlugin({
      idPrefix: '${idPrefix}',
      removeInProduction: false,
    }),
    react(),${additionalPlugins.length > 0 ? '\n    ' + additionalPlugins.join(',\n    ') + ',' : ''}
  ],
  server: {
    host: true,
    allowedHosts: 'all',
    hmr: {
      protocol: '${isHttps ? 'wss' : 'ws'}',
      host: '${flyPublicHost}',
      clientPort: ${isHttps ? 443 : 3000},
      path: '/hmr/${projectId}',
      overlay: true,
    },
  },${aliasConfig ? `
  resolve: {
    alias: {
      ${aliasConfig}
    },
  },` : ''}
  build: {
    sourcemap: true,
  },
});
`;

      await writeFile(configPath, newConfig, 'utf-8');
      console.log(`[ViteManager] Regenerated vite.config.ts with base: ${basePath}, HMR config for ${flyPublicHost}`);

      // Ensure dependencies are valid after config update
      console.log(`[ViteManager] Ensuring dependencies after config update...`);
      const result = await dependencyManager.ensure(projectPath);
      if (!result.success) {
        console.error(`[ViteManager] Dependency installation failed:`, result.logs.join('\n'));
      } else {
        console.log(`[ViteManager] Dependencies installed in ${result.duration}ms`);
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
