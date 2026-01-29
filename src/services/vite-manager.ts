/**
 * Vite Dev Server 管理器
 * 管理多个项目的 Vite 开发服务器进程
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
  idleTimeout: 30 * 60 * 1000,  // 30 分钟
  startupTimeout: 60 * 1000,    // 60 秒
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

    // 初始化端口池
    for (let i = 0; i < this.config.maxInstances; i++) {
      this.portPool.add(this.config.basePort + i);
    }

    // 启动空闲清理定时器
    this.cleanupTimer = setInterval(() => this.cleanupIdle(), 60 * 1000);
  }

  /**
   * 启动项目的 Vite Dev Server
   */
  async start(projectId: string, projectPath: string): Promise<ViteInstance> {
    // 如果已运行，更新活跃时间并返回
    const existing = this.instances.get(projectId);
    if (existing && existing.status === 'running') {
      existing.lastActive = new Date();
      return existing;
    }

    // 分配端口
    const port = this.allocatePort();
    if (port === null) {
      throw new Error('No available ports. Max instances reached.');
    }

    // 创建实例
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
      // 确保 jsx-tagger 依赖已安装
      await this.ensureJsxTaggerDependency(projectPath);

      // 确保 vite.config 配置正确 (jsxTaggerPlugin, allowedHosts, base, hmr)
      await this.ensureViteConfig(projectId, projectPath);

      // 启动 Vite 进程
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

      // 监听输出
      this.setupProcessListeners(instance);

      // 等待服务器就绪
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
   * 停止项目的 Vite Dev Server
   */
  async stop(projectId: string): Promise<void> {
    const instance = this.instances.get(projectId);
    if (!instance) return;

    instance.status = 'stopping';

    // 优雅关闭
    instance.process.kill('SIGTERM');

    // 等待进程退出 (最多 5 秒)
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
   * 确保 jsx-tagger 依赖已安装
   */
  private async ensureJsxTaggerDependency(projectPath: string): Promise<void> {
    const packageJsonPath = join(projectPath, 'package.json');
    const jsxTaggerDep = process.env.JSX_TAGGER_DEP || 'file:/app/packages/vite-plugin-jsx-tagger';

    try {
      const content = await readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      // 检查是否已有 vite-plugin-jsx-tagger 依赖
      const hasDep = packageJson.dependencies?.['vite-plugin-jsx-tagger'] ||
                     packageJson.devDependencies?.['vite-plugin-jsx-tagger'];

      if (!hasDep) {
        console.log(`[ViteManager] Adding vite-plugin-jsx-tagger dependency to package.json`);

        // 添加到 devDependencies
        if (!packageJson.devDependencies) {
          packageJson.devDependencies = {};
        }
        packageJson.devDependencies['vite-plugin-jsx-tagger'] = jsxTaggerDep;

        await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8');

        // 删除 node_modules 并重新安装
        console.log(`[ViteManager] Reinstalling dependencies...`);
        const nodeModulesPath = join(projectPath, 'node_modules');
        try {
          await rm(nodeModulesPath, { recursive: true, force: true });
        } catch {
          // node_modules 可能不存在
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
   * 确保 vite.config 配置正确 (jsxTaggerPlugin, allowedHosts, base, hmr)
   */
  private async ensureViteConfig(projectId: string, projectPath: string): Promise<void> {
    const configPath = join(projectPath, 'vite.config.ts');
    const basePath = `/p/${projectId}/`;
    const idPrefix = projectId.slice(0, 8);
    // fly-server 的公共域名，用于 HMR WebSocket 直连
    const flyPublicHost = process.env.FLY_PUBLIC_HOST || 'ai-site-preview.fly.dev';
    const isHttps = flyPublicHost.includes('fly.dev') || process.env.FLY_HTTPS === 'true';

    try {
      let content = await readFile(configPath, 'utf-8');
      let modified = false;

      // 0. 确保 jsxTaggerPlugin 被导入和使用 (用于可视化编辑)
      if (!content.includes('jsxTaggerPlugin')) {
        // 添加 import
        if (content.includes("from 'vite'")) {
          content = content.replace(
            /import\s*\{[^}]*\}\s*from\s*['"]vite['"]/,
            match => `${match}\nimport { jsxTaggerPlugin } from 'vite-plugin-jsx-tagger';`
          );
        } else {
          // 在文件开头添加 import
          content = `import { jsxTaggerPlugin } from 'vite-plugin-jsx-tagger';\n${content}`;
        }

        // 添加插件到 plugins 数组 (必须在 react() 之前)
        const jsxTaggerPluginConfig = `jsxTaggerPlugin({
      idPrefix: '${idPrefix}',
      removeInProduction: false,
    }),`;

        if (content.includes('plugins:')) {
          // 在 plugins 数组开头添加
          content = content.replace(
            /plugins:\s*\[/,
            `plugins: [\n    // JSX Tagger 必须在 React 插件之前\n    ${jsxTaggerPluginConfig}`
          );
        }
        modified = true;
        console.log(`[ViteManager] Added jsxTaggerPlugin to vite.config.ts for visual editing`);
      }

      // 1. 添加或更新 base 配置
      if (content.includes('base:')) {
        // 更新现有的 base 配置
        content = content.replace(/base:\s*['"][^'"]*['"]/, `base: '${basePath}'`);
        modified = true;
      } else if (content.includes('defineConfig({')) {
        // 在 defineConfig 后添加 base
        content = content.replace(
          /defineConfig\(\{/,
          `defineConfig({\n  base: '${basePath}',`
        );
        modified = true;
      }

      // 2. 添加或更新 server 配置 (包括 allowedHosts 和 hmr)
      // HMR 配置让 Vite client 直接连接到 fly-server，绕过 backend proxy
      // 注意：path 使用完整路径，Vite 会直接使用这个路径（不会与 base 叠加）
      const hmrConfig = `hmr: {
      protocol: '${isHttps ? 'wss' : 'ws'}',
      host: '${flyPublicHost}',
      clientPort: ${isHttps ? 443 : 3000},
      path: '/hmr/${projectId}',
      overlay: true,
    },`;

      if (content.includes('server:')) {
        // server 配置已存在
        if (!content.includes('allowedHosts')) {
          content = content.replace(
            /server:\s*\{/,
            "server: {\n    allowedHosts: 'all',"
          );
          modified = true;
        }
        // 更新或添加 hmr 配置
        if (content.includes('hmr:')) {
          // 替换现有的 hmr 配置 (使用更健壮的正则，匹配嵌套大括号)
          // 匹配 hmr: { ... } 包括多行和嵌套对象
          content = content.replace(
            /hmr:\s*\{[\s\S]*?overlay:\s*true,?\s*\},?[\s\n]*/,
            hmrConfig + '\n    '
          );
          modified = true;
        } else {
          // 在 allowedHosts 后添加 hmr
          content = content.replace(
            /(allowedHosts:\s*['"][^'"]*['"],?)\s*/,
            `$1\n    ${hmrConfig}\n    `
          );
          modified = true;
        }
      } else if (content.includes('defineConfig({')) {
        // 添加完整的 server 配置
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
      // 不阻止启动，继续尝试
    }
  }

  /**
   * 获取实例信息
   */
  getInstance(projectId: string): ViteInstance | undefined {
    return this.instances.get(projectId);
  }

  /**
   * 获取预览 URL
   */
  getPreviewUrl(projectId: string): string | null {
    const instance = this.instances.get(projectId);
    if (!instance || instance.status !== 'running') return null;
    return `http://localhost:${instance.port}`;
  }

  /**
   * 获取 HMR WebSocket URL
   */
  getHmrUrl(projectId: string): string | null {
    const instance = this.instances.get(projectId);
    if (!instance || instance.status !== 'running') return null;
    return `ws://localhost:${instance.port}`;
  }

  /**
   * 标记活跃 (防止被清理)
   */
  markActive(projectId: string): void {
    const instance = this.instances.get(projectId);
    if (instance) {
      instance.lastActive = new Date();
    }
  }

  /**
   * 获取运行中的实例数
   */
  getRunningCount(): number {
    return Array.from(this.instances.values())
      .filter(i => i.status === 'running')
      .length;
  }

  /**
   * 获取所有实例的状态
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
   * 销毁管理器
   */
  async destroy(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // 停止所有实例
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
        // 非正常退出
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
        // Vite 可能返回 200 或 404 (当没有 index.html 时)
        if (response.ok || response.status === 404) {
          return;
        }
      } catch {
        // 服务器尚未就绪，继续等待
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

// 导出单例
export const viteManager = new ViteDevServerManager();
