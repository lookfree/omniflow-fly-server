/**
 * 项目管理器
 * 统一管理项目的创建、更新、删除和预览
 */

import { mkdir, writeFile, readFile, rm, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { viteManager } from './vite-manager';
import { dependencyManager } from './dependency-manager';
import { generateScaffold, generateDefaultAppTsx } from './scaffolder';
import type {
  ProjectConfig,
  ProjectFile,
  ProjectStatus,
  FileUpdate,
  CreateProjectResult,
  ApiResponse,
} from '../types';

const DATA_DIR = process.env.DATA_DIR || '/data/sites';

export class ProjectManager {
  /**
   * 创建新项目
   */
  async createProject(config: ProjectConfig): Promise<CreateProjectResult> {
    const projectPath = this.getProjectPath(config.projectId);

    // 创建项目目录
    await mkdir(projectPath, { recursive: true });

    // 生成脚手架文件
    const scaffold = generateScaffold(config);
    if (!scaffold.success) {
      throw new Error('Failed to generate scaffold');
    }

    // 写入脚手架文件
    for (const file of scaffold.files) {
      const filePath = join(projectPath, file.path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content, 'utf-8');
    }

    // 写入默认 App.tsx
    const appPath = join(projectPath, 'src', 'App.tsx');
    await writeFile(appPath, generateDefaultAppTsx(config.projectName), 'utf-8');

    console.log(`[ProjectManager] Created project: ${config.projectId}`);

    // 安装依赖
    const installResult = await dependencyManager.install(projectPath);
    if (!installResult.success) {
      console.error(`[ProjectManager] Failed to install dependencies:`, installResult.logs);
      throw new Error('Failed to install dependencies');
    }

    // 启动 Vite Dev Server
    const instance = await viteManager.start(config.projectId, projectPath);

    return {
      projectPath,
      port: instance.port,
      previewUrl: `http://localhost:${instance.port}`,
      hmrUrl: `ws://localhost:${instance.port}`,
    };
  }

  /**
   * 获取项目状态
   */
  async getStatus(projectId: string): Promise<ProjectStatus> {
    const projectPath = this.getProjectPath(projectId);

    try {
      const stats = await stat(projectPath);
      if (!stats.isDirectory()) {
        return {
          exists: false,
          devServerRunning: false,
          fileCount: 0,
        };
      }

      const instance = viteManager.getInstance(projectId);
      const fileCount = await this.countFiles(projectPath);

      return {
        exists: true,
        devServerRunning: instance?.status === 'running',
        port: instance?.port,
        fileCount,
        lastModified: stats.mtime,
      };
    } catch {
      return {
        exists: false,
        devServerRunning: false,
        fileCount: 0,
      };
    }
  }

  /**
   * 更新项目文件
   */
  async updateFiles(projectId: string, updates: FileUpdate[]): Promise<void> {
    const projectPath = this.getProjectPath(projectId);

    for (const update of updates) {
      const filePath = join(projectPath, update.path);
      // 默认为 'update' 操作（兼容后端不传 operation 字段的情况）
      const operation = update.operation || 'update';

      switch (operation) {
        case 'create':
        case 'update':
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, update.content, 'utf-8');
          console.log(`[ProjectManager] ${operation}: ${update.path}`);
          break;

        case 'delete':
          try {
            await rm(filePath);
            console.log(`[ProjectManager] Deleted: ${update.path}`);
          } catch {
            // 文件可能不存在
          }
          break;
      }
    }

    // 标记项目活跃
    viteManager.markActive(projectId);
  }

  /**
   * 读取项目文件
   */
  async readFile(projectId: string, filePath: string): Promise<string | null> {
    const fullPath = join(this.getProjectPath(projectId), filePath);
    try {
      return await readFile(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * 列出项目文件
   */
  async listFiles(projectId: string, subPath = ''): Promise<string[]> {
    const dirPath = join(this.getProjectPath(projectId), subPath);
    const files: string[] = [];

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const relativePath = subPath ? `${subPath}/${entry.name}` : entry.name;

        // 跳过 node_modules 和 .git
        if (entry.name === 'node_modules' || entry.name === '.git') continue;

        if (entry.isDirectory()) {
          const subFiles = await this.listFiles(projectId, relativePath);
          files.push(...subFiles);
        } else {
          files.push(relativePath);
        }
      }
    } catch {
      // 目录可能不存在
    }

    return files;
  }

  /**
   * 启动项目预览
   */
  async startPreview(projectId: string): Promise<{ port: number; url: string }> {
    const projectPath = this.getProjectPath(projectId);

    // 确保依赖已安装
    await dependencyManager.install(projectPath);

    // 启动 Vite
    const instance = await viteManager.start(projectId, projectPath);

    return {
      port: instance.port,
      url: `http://localhost:${instance.port}`,
    };
  }

  /**
   * 停止项目预览
   */
  async stopPreview(projectId: string): Promise<void> {
    await viteManager.stop(projectId);
  }

  /**
   * 删除项目
   */
  async deleteProject(projectId: string): Promise<void> {
    // 停止 Vite
    await viteManager.stop(projectId);

    // 删除项目目录
    const projectPath = this.getProjectPath(projectId);
    try {
      await rm(projectPath, { recursive: true, force: true });
      console.log(`[ProjectManager] Deleted project: ${projectId}`);
    } catch (error) {
      console.error(`[ProjectManager] Failed to delete project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Reinstall dependencies (force)
   * Deletes node_modules and runs bun install
   */
  async reinstallDependencies(projectId: string): Promise<void> {
    const projectPath = this.getProjectPath(projectId);

    // Stop Vite before reinstalling
    await viteManager.stop(projectId);

    // Force reinstall
    const result = await dependencyManager.reinstall(projectPath);
    if (!result.success) {
      console.error(`[ProjectManager] Reinstall failed:`, result.logs);
      throw new Error('Failed to reinstall dependencies');
    }

    // Restart Vite
    await viteManager.start(projectId, projectPath);
    console.log(`[ProjectManager] Reinstalled and restarted: ${projectId}`);
  }

  /**
   * 添加依赖
   */
  async addDependency(projectId: string, packageName: string, isDev = false): Promise<void> {
    const projectPath = this.getProjectPath(projectId);
    const result = await dependencyManager.addPackage(projectPath, packageName, isDev);

    if (!result.success) {
      throw new Error(`Failed to add package: ${packageName}`);
    }
  }

  /**
   * 移除依赖
   */
  async removeDependency(projectId: string, packageName: string): Promise<void> {
    const projectPath = this.getProjectPath(projectId);
    const result = await dependencyManager.removePackage(projectPath, packageName);

    if (!result.success) {
      throw new Error(`Failed to remove package: ${packageName}`);
    }
  }

  /**
   * 获取项目路径
   */
  getProjectPath(projectId: string): string {
    // 安全检查：防止路径遍历
    const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '');
    return join(DATA_DIR, safeId);
  }

  /**
   * 统计文件数量
   */
  private async countFiles(dirPath: string): Promise<number> {
    let count = 0;

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;

        if (entry.isDirectory()) {
          count += await this.countFiles(join(dirPath, entry.name));
        } else {
          count++;
        }
      }
    } catch {
      // 忽略错误
    }

    return count;
  }
}

export const projectManager = new ProjectManager();
